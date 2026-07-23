import type { RuntimeConfig } from '@nook/config';
import type {
  CompleteMediaVerificationInput,
  MediaVerificationRecord,
  PortfolioMediaRecord,
  PortfolioMediaRepository,
} from '@nook/database';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  MediaObjectStore,
  StoredObjectMetadata,
} from '../src/modules/media/media-object-store';
import {
  MediaVerificationRequestError,
  MediaVerificationService,
} from '../src/modules/media/media-verification.service';

const config: RuntimeConfig = {
  nodeEnv: 'test',
  port: 8081,
  appVersion: 'test',
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
    bucket: 'synthetic-bucket',
    taskQueue: 'synthetic-media',
    workerUrl: 'https://worker.example.test',
    taskInvokerServiceAccount: 'tasks@example.iam.gserviceaccount.com',
  },
  notification: { mode: 'disabled' },
};

const pending: MediaVerificationRecord = {
  id: '10000000-0000-4000-8000-000000000002',
  tenantId: '10000000-0000-4000-8000-000000000001',
  bucket: 'synthetic-bucket',
  uploadObjectKey:
    'tenants/10000000-0000-4000-8000-000000000001/portfolio/10000000-0000-4000-8000-000000000002/upload',
  objectKey: null,
  thumbnailObjectKey: null,
  declaredMimeType: 'image/png',
  declaredByteSize: 0,
  uploadExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
  status: 'PENDING',
};

class FakeRepository implements PortfolioMediaRepository {
  record: MediaVerificationRecord = pending;
  ready: CompleteMediaVerificationInput | undefined;
  rejected: string | undefined;

  list(): Promise<PortfolioMediaRecord> {
    throw new Error('not used');
  }
  create(): Promise<PortfolioMediaRecord> {
    throw new Error('not used');
  }
  update(): Promise<PortfolioMediaRecord> {
    throw new Error('not used');
  }
  reorder(): Promise<PortfolioMediaRecord> {
    throw new Error('not used');
  }
  softDelete(): Promise<PortfolioMediaRecord> {
    throw new Error('not used');
  }
  requirePending(): Promise<MediaVerificationRecord> {
    return Promise.resolve(this.record);
  }
  findForVerification(): Promise<MediaVerificationRecord> {
    return Promise.resolve(this.record);
  }
  markReady(input: CompleteMediaVerificationInput): Promise<void> {
    this.ready = input;
    return Promise.resolve();
  }
  markRejected(_tenantId: string, _mediaAssetId: string, code: string): Promise<void> {
    this.rejected = code;
    return Promise.resolve();
  }
}

class FakeObjectStore implements MediaObjectStore {
  source = Buffer.alloc(0);
  contentType = 'image/png';
  readonly saved = new Map<string, Buffer>();
  readonly deleted: string[] = [];

  metadata(): Promise<StoredObjectMetadata> {
    return Promise.resolve({ contentType: this.contentType, byteSize: this.source.byteLength });
  }
  download(): Promise<Buffer> {
    return Promise.resolve(this.source);
  }
  saveWebp(_bucket: string, objectKey: string, contents: Buffer): Promise<void> {
    this.saved.set(objectKey, contents);
    return Promise.resolve();
  }
  deleteIfExists(_bucket: string, objectKey: string): Promise<void> {
    this.deleted.push(objectKey);
    return Promise.resolve();
  }
}

describe('MediaVerificationService', () => {
  let repository: FakeRepository;
  let objects: FakeObjectStore;
  let service: MediaVerificationService;

  beforeEach(() => {
    repository = new FakeRepository();
    objects = new FakeObjectStore();
    service = new MediaVerificationService(repository, objects, config);
  });

  it('normalizes a valid single-frame image and only then marks it READY', async () => {
    objects.source = await sharp({
      create: { width: 1800, height: 1200, channels: 3, background: '#c64b3f' },
    })
      .png()
      .toBuffer();
    repository.record = { ...pending, declaredByteSize: objects.source.byteLength };
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const result = await service.verify({
      tenantId: pending.tenantId,
      mediaAssetId: pending.id,
      requestId: 'media-valid',
    });
    writeSpy.mockRestore();

    expect(result).toEqual({ mediaAssetId: pending.id, status: 'READY', idempotent: false });
    expect(repository.ready).toMatchObject({
      mimeType: 'image/webp',
      width: 1600,
      height: 1067,
    });
    expect(repository.ready?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(objects.saved.size).toBe(2);
    expect(objects.deleted).toContain(pending.uploadObjectKey);
  });

  it('rejects a metadata mismatch and removes all fixed object keys', async () => {
    objects.source = Buffer.from('not-an-image');
    repository.record = { ...pending, declaredByteSize: objects.source.byteLength + 1 };
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(
      service.verify({
        tenantId: pending.tenantId,
        mediaAssetId: pending.id,
        requestId: 'media-rejected',
      }),
    ).resolves.toMatchObject({ status: 'REJECTED', idempotent: false });
    writeSpy.mockRestore();
    expect(repository.rejected).toBe('metadata_mismatch');
    expect(objects.deleted).toHaveLength(3);
  });

  it('turns decoder failures into a terminal safe rejection code', async () => {
    objects.source = Buffer.from('not-an-image');
    repository.record = { ...pending, declaredByteSize: objects.source.byteLength };
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(
      service.verify({
        tenantId: pending.tenantId,
        mediaAssetId: pending.id,
        requestId: 'media-decode-rejected',
      }),
    ).resolves.toMatchObject({ status: 'REJECTED' });
    writeSpy.mockRestore();
    expect(repository.rejected).toBe('image_decode_failed');
  });

  it('is idempotent for terminal states without reading storage', async () => {
    repository.record = { ...pending, status: 'READY' };
    await expect(
      service.verify({ tenantId: pending.tenantId, mediaAssetId: pending.id, requestId: 'retry' }),
    ).resolves.toEqual({ mediaAssetId: pending.id, status: 'READY', idempotent: true });
    expect(objects.saved.size).toBe(0);
  });

  it('requires the configured Cloud Tasks queue header', () => {
    try {
      service.requireQueue('foreign-queue');
      throw new Error('Expected the foreign queue to be rejected.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(MediaVerificationRequestError);
      if (error instanceof MediaVerificationRequestError) expect(error.status).toBe(403);
    }
    expect(() => service.requireQueue('synthetic-media')).not.toThrow();
  });
});
