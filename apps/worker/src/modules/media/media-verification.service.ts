import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { RuntimeConfig } from '@nook/config';
import type { VerifyMediaTaskResponse } from '@nook/contracts';
import {
  PortfolioMediaRepositoryError,
  type MediaVerificationRecord,
  type PortfolioMediaRepository,
} from '@nook/database';
import { createSecurityEventLog, redactValue } from '@nook/observability';
import sharp from 'sharp';

import { RUNTIME_CONFIG } from '../../runtime-config.token';
import type { MediaObjectStore } from './media-object-store';
import { MEDIA_OBJECT_STORE, PORTFOLIO_MEDIA_REPOSITORY } from './media.tokens';

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const formatToMime = new Map([
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
]);

export class MediaVerificationRequestError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 503,
    readonly code: string,
  ) {
    super(code);
    this.name = 'MediaVerificationRequestError';
  }
}

class RejectMediaError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'RejectMediaError';
  }
}

@Injectable()
export class MediaVerificationService {
  constructor(
    @Inject(PORTFOLIO_MEDIA_REPOSITORY) private readonly repository: PortfolioMediaRepository,
    @Inject(MEDIA_OBJECT_STORE) private readonly objects: MediaObjectStore,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  requireQueue(queueName: string | undefined): void {
    if (this.config.media.mode === 'disabled') {
      throw new MediaVerificationRequestError(503, 'media_verification_unavailable');
    }
    if (queueName !== this.config.media.taskQueue) {
      throw new MediaVerificationRequestError(403, 'media_task_queue_denied');
    }
  }

  async verify(input: {
    readonly tenantId: string;
    readonly mediaAssetId: string;
    readonly requestId: string;
  }): Promise<VerifyMediaTaskResponse> {
    if (this.config.media.mode === 'disabled') {
      throw new MediaVerificationRequestError(503, 'media_verification_unavailable');
    }
    let record: MediaVerificationRecord;
    try {
      record = await this.repository.findForVerification(input.tenantId, input.mediaAssetId);
    } catch (error) {
      if (error instanceof PortfolioMediaRepositoryError && error.code === 'media_not_found') {
        throw new MediaVerificationRequestError(404, 'media_not_found');
      }
      throw error;
    }
    if (record.status === 'READY') {
      return { mediaAssetId: record.id, status: 'READY', idempotent: true };
    }
    if (record.status === 'REJECTED' || record.status === 'DELETED') {
      return { mediaAssetId: record.id, status: 'REJECTED', idempotent: true };
    }

    const displayKey = `tenants/${record.tenantId}/portfolio/${record.id}/display.webp`;
    const thumbnailKey = `tenants/${record.tenantId}/portfolio/${record.id}/thumbnail.webp`;
    try {
      const stored = await this.objects.metadata(record.bucket, record.uploadObjectKey);
      if (
        stored.contentType !== record.declaredMimeType ||
        !allowedMimeTypes.has(stored.contentType) ||
        stored.byteSize !== record.declaredByteSize ||
        stored.byteSize > 15 * 1024 * 1024
      ) {
        throw new RejectMediaError('metadata_mismatch');
      }
      const source = await this.objects.download(record.bucket, record.uploadObjectKey);
      if (source.byteLength !== stored.byteSize)
        throw new RejectMediaError('download_size_mismatch');
      const { display, thumbnail } = await decodeAndNormalize(source, record.declaredMimeType);
      await this.objects.saveWebp(record.bucket, displayKey, display.data);
      await this.objects.saveWebp(record.bucket, thumbnailKey, thumbnail);
      try {
        await this.repository.markReady({
          tenantId: record.tenantId,
          mediaAssetId: record.id,
          objectKey: displayKey,
          thumbnailObjectKey: thumbnailKey,
          mimeType: 'image/webp',
          byteSize: display.info.size,
          width: display.info.width,
          height: display.info.height,
          checksum: createHash('sha256').update(display.data).digest('hex'),
        });
      } catch (error) {
        if (
          error instanceof PortfolioMediaRepositoryError &&
          error.code === 'entitlement_limit_reached'
        ) {
          throw new RejectMediaError('quota_exceeded');
        }
        throw error;
      }
      await this.objects.deleteIfExists(record.bucket, record.uploadObjectKey);
      this.log('media.verification_succeeded', input, 'success');
      return { mediaAssetId: record.id, status: 'READY', idempotent: false };
    } catch (error) {
      if (!(error instanceof RejectMediaError)) throw error;
      await Promise.all([
        this.objects.deleteIfExists(record.bucket, record.uploadObjectKey),
        this.objects.deleteIfExists(record.bucket, displayKey),
        this.objects.deleteIfExists(record.bucket, thumbnailKey),
      ]);
      try {
        await this.repository.markRejected(record.tenantId, record.id, error.code);
      } catch (repositoryError) {
        if (
          !(repositoryError instanceof PortfolioMediaRepositoryError) ||
          repositoryError.code !== 'media_not_pending'
        ) {
          throw repositoryError;
        }
      }
      this.log('media.verification_rejected', input, 'denied');
      return { mediaAssetId: record.id, status: 'REJECTED', idempotent: false };
    }
  }

  private log(
    event: Parameters<typeof createSecurityEventLog>[0]['event'],
    input: { readonly tenantId: string; readonly requestId: string },
    outcome: 'success' | 'denied',
  ): void {
    process.stdout.write(
      `${JSON.stringify(
        redactValue(
          createSecurityEventLog({
            event,
            requestId: input.requestId,
            tenantId: input.tenantId,
            outcome,
            version: this.config.appVersion,
            environment: this.config.nodeEnv,
          }),
        ),
      )}\n`,
    );
  }
}

async function decodeAndNormalize(source: Buffer, declaredMimeType: string) {
  try {
    const decoder = sharp(source, { failOn: 'warning', limitInputPixels: 60_000_000 });
    const metadata = await decoder.metadata();
    const actualMime =
      metadata.format === undefined ? undefined : formatToMime.get(metadata.format);
    if (
      actualMime === undefined ||
      actualMime !== declaredMimeType ||
      metadata.width === undefined ||
      metadata.height === undefined ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw new RejectMediaError('unsupported_image_content');
    }
    const pixels = metadata.width * metadata.height;
    if (!Number.isSafeInteger(pixels) || pixels > 60_000_000) {
      throw new RejectMediaError('pixel_limit_exceeded');
    }
    const display = await sharp(source, { failOn: 'warning', limitInputPixels: 60_000_000 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const thumbnail = await sharp(source, { failOn: 'warning', limitInputPixels: 60_000_000 })
      .rotate()
      .resize({ width: 480, height: 480, fit: 'cover', position: 'attention' })
      .webp({ quality: 78 })
      .toBuffer();
    return { display, thumbnail };
  } catch (error) {
    if (error instanceof RejectMediaError) throw error;
    throw new RejectMediaError('image_decode_failed');
  }
}
