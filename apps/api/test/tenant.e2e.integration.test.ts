import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  IDENTITY_TOKEN_VERIFIER,
  IdentityTokenVerificationError,
  type AuthenticatedPrincipal,
  type IdentityTokenVerifier,
} from '@nook/auth';
import type { ProblemDetails, TenantResponse } from '@nook/contracts';
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

  it('returns the authenticated user memberships without tenant headers', async () => {
    const tenant = await createTenant('token-a', 'Me Studio', 'me-studio');

    const response = await request(httpServer)
      .get('/v1/me')
      .set('authorization', 'Bearer token-a')
      .expect(200);

    expect(response.body as unknown).toEqual({
      id: userAId,
      memberships: [{ tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE' }],
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
