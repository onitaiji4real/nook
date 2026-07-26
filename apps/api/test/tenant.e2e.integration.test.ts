import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  IDENTITY_TOKEN_VERIFIER,
  IdentityTokenVerificationError,
  type AuthenticatedPrincipal,
  type IdentityTokenVerifier,
} from '@nook/auth';
import {
  resolveStudioNavigation,
  studioRouteKeySchema,
  type ProblemDetails,
  type TenantResponse,
} from '@nook/contracts';
import { disconnectPrismaClient, getPrismaClient, PrismaTenantRepository } from '@nook/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { requestContextMiddleware } from '../src/request-context.middleware';

class SyntheticIdentityTokenVerifier implements IdentityTokenVerifier {
  readonly identities = new Map<string, string>();

  verify(token: string): Promise<AuthenticatedPrincipal> {
    const userId = this.identities.get(token);
    if (userId === undefined) {
      return Promise.reject(
        new IdentityTokenVerificationError('invalid_token', 'Synthetic token rejected.'),
      );
    }

    return Promise.resolve({ userId });
  }
}

describe('tenant onboarding and RBAC', () => {
  const prisma = getPrismaClient();
  const verifier = new SyntheticIdentityTokenVerifier();
  let app: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_TOKEN_VERIFIER)
      .useValue(verifier)
      .compile();
    app = module.createNestApplication();
    app.use(requestContextMiddleware);
    await app.init();
    httpServer = app.getHttpServer() as unknown as Parameters<typeof request>[0];
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.userIdentity.deleteMany();
    await prisma.tenant.deleteMany();
    await prisma.user.deleteMany();

    const [userA, userB] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Synthetic User A' } }),
      prisma.user.create({ data: { displayName: 'Synthetic User B' } }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    verifier.identities.clear();
    verifier.identities.set('token-a', userAId);
    verifier.identities.set('token-b', userBId);
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrismaClient();
  });

  it('creates a tenant, OWNER membership, and safe audit event atomically', async () => {
    const response = await request(httpServer)
      .post('/v1/tenants')
      .set('authorization', 'Bearer token-a')
      .set('x-request-id', 'create-tenant-test')
      .send({ name: 'Synthetic Studio', slug: 'synthetic-studio' })
      .expect(201);

    const body = response.body as unknown as TenantResponse;
    expect(body).toMatchObject({
      name: 'Synthetic Studio',
      slug: 'synthetic-studio',
      membership: { role: 'OWNER', status: 'ACTIVE' },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId: body.id, action: 'tenant.created' },
    });
    expect(audit).toMatchObject({
      actorUserId: userAId,
      resourceType: 'tenant',
      resourceId: body.id,
      requestId: 'create-tenant-test',
      beforeJson: null,
      afterJson: null,
    });
  });

  it('returns stable Problem Details for a duplicate slug', async () => {
    await createTenant('token-a', 'First Studio', 'shared-slug');

    const response = await request(httpServer)
      .post('/v1/tenants')
      .set('authorization', 'Bearer token-b')
      .set('x-request-id', 'duplicate-slug-test')
      .send({ name: 'Second Studio', slug: 'shared-slug' })
      .expect('content-type', /application\/problem\+json/)
      .expect(409);

    expect(response.body as unknown as ProblemDetails).toMatchObject({
      status: 409,
      code: 'duplicate_slug',
      requestId: 'duplicate-slug-test',
    });
  });

  it('denies cross-tenant reads and records a PII-free denial', async () => {
    const tenant = await createTenant('token-b', 'Tenant B Name', 'tenant-b');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const response = await request(httpServer)
      .get(`/v1/tenants/${tenant.id}`)
      .set('authorization', 'Bearer token-a')
      .set('x-request-id', 'cross-tenant-test')
      .expect(403);

    expect(response.body as unknown as ProblemDetails).toMatchObject({
      code: 'tenant_access_denied',
      requestId: 'cross-tenant-test',
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId: tenant.id, action: 'authorization.denied' },
    });
    expect(audit).toMatchObject({
      actorUserId: userAId,
      resourceId: tenant.id,
      requestId: 'cross-tenant-test',
      beforeJson: null,
      afterJson: null,
    });

    const capturedLogs = writeSpy.mock.calls.flat().join('');
    writeSpy.mockRestore();
    expect(capturedLogs).not.toContain('Tenant B Name');
    expect(capturedLogs).not.toContain('Synthetic User A');
    expect(capturedLogs).toContain('authorization.denied');
  });

  it('revokes tenant reads immediately when membership is suspended', async () => {
    const tenant = await createTenant('token-a', 'Revoked Studio', 'revoked-studio');
    await prisma.membership.update({
      where: { tenantId_userId: { tenantId: tenant.id, userId: userAId } },
      data: { status: 'SUSPENDED' },
    });

    await request(httpServer)
      .get(`/v1/tenants/${tenant.id}`)
      .set('authorization', 'Bearer token-a')
      .expect(403);
  });

  it.each(['SUSPENDED', 'DELETED'] as const)(
    'revokes all tenant access when the local user is %s',
    async (status) => {
      const tenant = await createTenant(
        'token-a',
        `${status} Studio`,
        `${status.toLowerCase()}-studio`,
      );
      await prisma.user.update({ where: { id: userAId }, data: { status } });

      const responses = [
        await request(httpServer)
          .get(`/v1/tenants/${tenant.id}`)
          .set('authorization', 'Bearer token-a')
          .expect(403),
        await request(httpServer).get('/v1/me').set('authorization', 'Bearer token-a').expect(403),
        await request(httpServer)
          .post('/v1/tenants')
          .set('authorization', 'Bearer token-a')
          .send({ name: 'Blocked Studio', slug: `blocked-${status.toLowerCase()}` })
          .expect(403),
      ];

      for (const result of responses) {
        expect(result.body as unknown as ProblemDetails).toMatchObject({
          status: 403,
          code: 'account_inactive',
        });
      }

      await expect(
        prisma.tenant.count({ where: { slug: `blocked-${status.toLowerCase()}` } }),
      ).resolves.toBe(0);
    },
  );

  it('rejects a verified bearer principal that has no local user', async () => {
    verifier.identities.set('unknown-user-token', '00000000-0000-4000-8000-000000000123');

    const response = await request(httpServer)
      .get('/v1/me')
      .set('authorization', 'Bearer unknown-user-token')
      .expect(403);
    expect(response.body as unknown as ProblemDetails).toMatchObject({
      status: 403,
      code: 'account_inactive',
    });
  });

  it('returns the authenticated user memberships without tenant headers', async () => {
    const tenant = await createTenant('token-a', 'Me Studio', 'me-studio');
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId: tenant.id, userId: userAId } },
      select: { id: true },
    });

    const response = await request(httpServer)
      .get('/v1/me')
      .set('authorization', 'Bearer token-a')
      .expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');

    expect(response.body as unknown).toEqual({
      id: userAId,
      memberships: [
        {
          membershipId: membership.id,
          tenantId: tenant.id,
          tenantName: 'Me Studio',
          tenantSlug: 'me-studio',
          tenantStatus: 'ACTIVE',
          tenantTimezone: 'Asia/Taipei',
          role: 'OWNER',
          status: 'ACTIVE',
        },
      ],
    });
  });

  it('returns only ACTIVE memberships for ACTIVE tenants in stable creation order', async () => {
    const first = await createTenant('token-a', 'First Active', 'first-active');
    const revoked = await createTenant('token-a', 'Revoked Membership', 'revoked-membership');
    const suspended = await createTenant('token-a', 'Suspended Tenant', 'suspended-tenant');
    const second = await createTenant('token-a', 'Second Active', 'second-active');
    await prisma.membership.update({
      where: { tenantId_userId: { tenantId: revoked.id, userId: userAId } },
      data: { status: 'SUSPENDED' },
    });
    await prisma.tenant.update({
      where: { id: suspended.id },
      data: { status: 'SUSPENDED' },
    });

    const response = await request(httpServer)
      .get('/v1/me')
      .set('authorization', 'Bearer token-a')
      .expect(200);
    const body = response.body as unknown as {
      readonly memberships: ReadonlyArray<{ readonly tenantId: string }>;
    };

    expect(body.memberships.map(({ tenantId }) => tenantId)).toEqual([first.id, second.id]);
  });

  it.each(['OWNER', 'MANAGER', 'VIEWER', 'STAFF'] as const)(
    'accepts all bounded LINE Studio routes for an authorized %s and derives safe outcomes',
    async (role) => {
      const tenant = await createTenant('token-a', `${role} Studio`, `${role.toLowerCase()}-entry`);
      await prisma.membership.update({
        where: { tenantId_userId: { tenantId: tenant.id, userId: userAId } },
        data: { role },
      });
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      for (const routeKey of studioRouteKeySchema.options) {
        const response = await request(httpServer)
          .post('/v1/line/studio-entry-events')
          .set('authorization', 'Bearer token-a')
          .set('x-request-id', `line-entry-${role.toLowerCase()}-${routeKey}`)
          .send({ tenantId: tenant.id, routeKey })
          .expect(200);
        expect(response.body).toEqual(resolveStudioNavigation({ routeKey, role }));
      }

      const logs = writeSpy.mock.calls.flat().join('');
      writeSpy.mockRestore();
      expect(logs).toContain('"operation":"line.merchant_entry"');
      expect(logs).toContain(`"tenantId":"${tenant.id}"`);
      expect(logs).not.toContain('Synthetic User A');
      expect(logs).not.toMatch(/idToken|accessToken|returnUrl|email|phone|lineSubject/);
      if (role === 'VIEWER' || role === 'STAFF') {
        expect(logs).toContain('"outcome":"fallback"');
      } else {
        expect(logs).not.toContain('"outcome":"fallback"');
      }
    },
  );

  it('denies foreign or revoked LINE Studio tenant selection without logging tenant authority', async () => {
    const tenant = await createTenant('token-b', 'Private Studio', 'private-line-entry');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await request(httpServer)
      .post('/v1/line/studio-entry-events')
      .set('authorization', 'Bearer token-a')
      .set('x-request-id', 'foreign-line-entry')
      .send({ tenantId: tenant.id, routeKey: 'appointments' })
      .expect(403);

    const logs = writeSpy.mock.calls.flat().join('');
    writeSpy.mockRestore();
    expect(logs).toContain('"outcome":"denied"');
    expect(logs).not.toContain(tenant.id);
    expect(logs).not.toContain('Private Studio');
  });

  it('rejects route and return URL manipulation before recording analytics', async () => {
    const tenant = await createTenant('token-a', 'Safe Studio', 'safe-line-entry');
    const response = await request(httpServer)
      .post('/v1/line/studio-entry-events')
      .set('authorization', 'Bearer token-a')
      .send({
        tenantId: tenant.id,
        routeKey: 'https://evil.example',
        returnUrl: 'https://evil.example',
      })
      .expect(400);

    expect(response.body as unknown as ProblemDetails).toMatchObject({
      code: 'invalid_line_studio_entry_event',
    });
  });

  it('rolls back a tenant when OWNER membership creation fails', async () => {
    const repository = new PrismaTenantRepository(prisma);
    await expect(
      repository.createTenantWithOwner({
        ownerUserId: '00000000-0000-4000-8000-000000000000',
        name: 'Rollback Studio',
        slug: 'rollback-studio',
        requestId: 'rollback-test',
      }),
    ).rejects.toMatchObject({ code: 'P2003' });

    await expect(prisma.tenant.count({ where: { slug: 'rollback-studio' } })).resolves.toBe(0);
  });

  it('fails closed when authentication is missing', async () => {
    const response = await request(httpServer)
      .get('/v1/me')
      .set('x-request-id', 'missing-auth-test')
      .expect(401);

    expect(response.body as unknown as ProblemDetails).toMatchObject({
      code: 'authentication_required',
      requestId: 'missing-auth-test',
    });
  });

  async function createTenant(token: string, name: string, slug: string) {
    const response = await request(httpServer)
      .post('/v1/tenants')
      .set('authorization', `Bearer ${token}`)
      .send({ name, slug })
      .expect(201);
    return response.body as unknown as { readonly id: string };
  }
});
