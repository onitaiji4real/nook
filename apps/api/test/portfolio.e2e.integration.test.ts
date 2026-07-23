import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  IDENTITY_TOKEN_VERIFIER,
  IdentityTokenVerificationError,
  type AuthenticatedPrincipal,
  type IdentityTokenVerifier,
} from '@nook/auth';
import type { RuntimeConfig } from '@nook/config';
import type {
  PortfolioResponse,
  PortfolioUploadCompleteResponse,
  PortfolioUploadIntentResponse,
  ProblemDetails,
} from '@nook/contracts';
import { disconnectPrismaClient, getPrismaClient } from '@nook/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import type {
  MediaUploadSigner,
  MediaVerificationQueue,
  SignedUploadPolicy,
} from '../src/modules/portfolio/media-gateways';
import {
  MEDIA_UPLOAD_SIGNER,
  MEDIA_VERIFICATION_QUEUE,
} from '../src/modules/portfolio/portfolio.tokens';
import { requestContextMiddleware } from '../src/request-context.middleware';
import { RUNTIME_CONFIG } from '../src/runtime-config.token';

class TestIdentityVerifier implements IdentityTokenVerifier {
  readonly identities = new Map<string, string>();
  verify(token: string): Promise<AuthenticatedPrincipal> {
    const userId = this.identities.get(token);
    if (userId === undefined) {
      return Promise.reject(new IdentityTokenVerificationError('invalid_token', 'Rejected.'));
    }
    return Promise.resolve({ userId });
  }
}

class TestSigner implements MediaUploadSigner {
  lastObjectKey: string | undefined;
  sign(input: { readonly objectKey: string }): Promise<SignedUploadPolicy> {
    this.lastObjectKey = input.objectKey;
    return Promise.resolve({
      method: 'POST',
      url: 'https://storage.example.test/upload',
      fields: { key: input.objectKey, policy: 'synthetic-not-a-secret' },
    });
  }
}

class TestQueue implements MediaVerificationQueue {
  readonly tasks: Array<{ readonly tenantId: string; readonly mediaAssetId: string }> = [];
  enqueue(input: { readonly tenantId: string; readonly mediaAssetId: string }): Promise<void> {
    this.tasks.push(input);
    return Promise.resolve();
  }
}

const config: RuntimeConfig = {
  nodeEnv: 'test',
  port: 8080,
  appVersion: 'test',
  databaseUrl: 'postgresql://synthetic:not-used@localhost/synthetic',
  apiCorsAllowedOrigins: [],
  appointmentConfirmationEnabled: true,
  bookingPolicyV2WritesEnabled: true,
  appointmentLifecycleEnabled: true,
  lineAuthRateLimit: { globalLimit: 120, tokenLimit: 5, windowSeconds: 60, bucketTtlSeconds: 600 },
  identity: { mode: 'disabled' },
  media: {
    mode: 'gcp',
    projectId: 'synthetic-project',
    region: 'asia-east1',
    bucket: 'synthetic-private-bucket',
    taskQueue: 'synthetic-media',
    workerUrl: 'https://worker.example.test',
    taskInvokerServiceAccount: 'tasks@example.iam.gserviceaccount.com',
  },
  notification: { mode: 'disabled' },
};

describe('portfolio controlled upload API', () => {
  const prisma = getPrismaClient();
  const verifier = new TestIdentityVerifier();
  const signer = new TestSigner();
  const queue = new TestQueue();
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let ownerId: string;
  let memberId: string;
  let tenantId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_TOKEN_VERIFIER)
      .useValue(verifier)
      .overrideProvider(RUNTIME_CONFIG)
      .useValue(config)
      .overrideProvider(MEDIA_UPLOAD_SIGNER)
      .useValue(signer)
      .overrideProvider(MEDIA_VERIFICATION_QUEUE)
      .useValue(queue)
      .compile();
    app = module.createNestApplication();
    app.use(requestContextMiddleware);
    await app.init();
    server = app.getHttpServer() as unknown as Parameters<typeof request>[0];
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.tenant.deleteMany();
    await prisma.user.deleteMany();
    const plan = await prisma.plan.findFirstOrThrow({ where: { isDefault: true } });
    await prisma.planEntitlement.update({
      where: {
        planId_entitlementCode: {
          planId: plan.id,
          entitlementCode: 'MAX_PORTFOLIO_IMAGES',
        },
      },
      data: { valueJson: 20 },
    });
    const [owner, member] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Portfolio Owner' } }),
      prisma.user.create({ data: { displayName: 'Portfolio Member' } }),
    ]);
    const tenant = await prisma.tenant.create({
      data: { name: 'Portfolio Studio', slug: 'portfolio-api-test', planId: plan.id },
    });
    ownerId = owner.id;
    memberId = member.id;
    tenantId = tenant.id;
    await prisma.membership.create({
      data: { tenantId, userId: ownerId, role: 'OWNER', status: 'ACTIVE' },
    });
    verifier.identities.clear();
    verifier.identities.set('owner-token', ownerId);
    verifier.identities.set('member-token', memberId);
    queue.tasks.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrismaClient();
  });

  it('creates an exact server-controlled upload intent and enqueues verification', async () => {
    const body = uploadBody('1');
    const created = await request(server)
      .post(`/v1/tenants/${tenantId}/portfolio/upload-intents`)
      .set('authorization', 'Bearer owner-token')
      .send(body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body as unknown as PortfolioUploadIntentResponse).toMatchObject({
      portfolio: {
        tenantId,
        entitlement: { code: 'MAX_PORTFOLIO_IMAGES', limit: 20, used: 1, remaining: 19 },
      },
      upload: { method: 'POST', maxBytes: 15_728_640 },
    });
    const expectedKey = `tenants/${tenantId}/portfolio/${body.mediaAssetId}/upload`;
    expect(signer.lastObjectKey).toBe(expectedKey);
    await expect(
      prisma.mediaAsset.findUniqueOrThrow({ where: { id: body.mediaAssetId } }),
    ).resolves.toMatchObject({ bucket: 'synthetic-private-bucket', uploadObjectKey: expectedKey });

    await request(server)
      .post(`/v1/tenants/${tenantId}/portfolio/upload-intents`)
      .set('authorization', 'Bearer owner-token')
      .send(body)
      .expect(201);
    await expect(prisma.mediaAsset.count({ where: { tenantId } })).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({ where: { tenantId, action: 'portfolio.created' } }),
    ).resolves.toBe(1);

    const completed = await request(server)
      .post(`/v1/tenants/${tenantId}/portfolio/media/${body.mediaAssetId}/complete`)
      .set('authorization', 'Bearer owner-token')
      .send({})
      .expect(201);
    expect(completed.body as unknown as PortfolioUploadCompleteResponse).toEqual({
      mediaAssetId: body.mediaAssetId,
      status: 'PENDING',
    });
    expect(queue.tasks).toEqual([{ tenantId, mediaAssetId: body.mediaAssetId }]);
  });

  it('allows STAFF uploads but denies VIEWER writes with an audit', async () => {
    await prisma.membership.create({
      data: { tenantId, userId: memberId, role: 'STAFF', status: 'ACTIVE' },
    });
    await request(server)
      .post(`/v1/tenants/${tenantId}/portfolio/upload-intents`)
      .set('authorization', 'Bearer member-token')
      .send(uploadBody('2'))
      .expect(201);
    await prisma.membership.update({
      where: { tenantId_userId: { tenantId, userId: memberId } },
      data: { role: 'VIEWER' },
    });
    const denied = await request(server)
      .post(`/v1/tenants/${tenantId}/portfolio/upload-intents`)
      .set('authorization', 'Bearer member-token')
      .send(uploadBody('3'))
      .expect(403);
    expect(denied.body as unknown as ProblemDetails).toMatchObject({
      code: 'tenant_access_denied',
    });
    await expect(
      prisma.auditLog.count({ where: { tenantId, action: 'authorization.denied' } }),
    ).resolves.toBe(1);
  });

  it('updates, reorders and soft-deletes only owned portfolio items', async () => {
    const first = uploadBody('4');
    const second = uploadBody('5');
    for (const body of [first, second]) {
      await request(server)
        .post(`/v1/tenants/${tenantId}/portfolio/upload-intents`)
        .set('authorization', 'Bearer owner-token')
        .send(body)
        .expect(201);
    }
    await request(server)
      .patch(`/v1/tenants/${tenantId}/portfolio/${first.portfolioItemId}`)
      .set('authorization', 'Bearer owner-token')
      .send({ title: '更新作品', tags: ['法式'] })
      .expect(200);
    const reordered = await request(server)
      .put(`/v1/tenants/${tenantId}/portfolio/order`)
      .set('authorization', 'Bearer owner-token')
      .send({ portfolioItemIds: [second.portfolioItemId, first.portfolioItemId] })
      .expect(200);
    expect((reordered.body as unknown as PortfolioResponse).items.map(({ id }) => id)).toEqual([
      second.portfolioItemId,
      first.portfolioItemId,
    ]);
    const removed = await request(server)
      .delete(`/v1/tenants/${tenantId}/portfolio/${first.portfolioItemId}`)
      .set('authorization', 'Bearer owner-token')
      .expect(200);
    expect((removed.body as unknown as PortfolioResponse).items).toHaveLength(1);
    await expect(
      prisma.mediaAsset.findUniqueOrThrow({ where: { id: first.mediaAssetId } }),
    ).resolves.toMatchObject({ status: 'DELETED' });
  });

  it('does not expose another tenant portfolio through a guessed ID', async () => {
    const body = uploadBody('6');
    await request(server)
      .post(`/v1/tenants/${tenantId}/portfolio/upload-intents`)
      .set('authorization', 'Bearer owner-token')
      .send(body)
      .expect(201);
    const plan = await prisma.plan.findFirstOrThrow({ where: { isDefault: true } });
    const foreign = await prisma.tenant.create({
      data: { name: 'Foreign', slug: 'portfolio-api-foreign', planId: plan.id },
    });
    await prisma.membership.create({
      data: { tenantId: foreign.id, userId: ownerId, role: 'OWNER', status: 'ACTIVE' },
    });
    const response = await request(server)
      .patch(`/v1/tenants/${foreign.id}/portfolio/${body.portfolioItemId}`)
      .set('authorization', 'Bearer owner-token')
      .send({ title: '跨店更新' })
      .expect(404);
    expect(response.body as unknown as ProblemDetails).toMatchObject({
      code: 'portfolio_not_found',
    });
  });
});

function uploadBody(suffix: string) {
  const serial = suffix.padStart(12, '0');
  return {
    portfolioItemId: `30000000-0000-4000-8000-${serial}`,
    mediaAssetId: `40000000-0000-4000-8000-${serial}`,
    title: `作品 ${suffix}`,
    tags: ['霧面'],
    mimeType: 'image/jpeg',
    byteSize: 2048,
  };
}
