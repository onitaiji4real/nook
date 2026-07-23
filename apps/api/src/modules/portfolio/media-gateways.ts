import { Storage } from '@google-cloud/storage';
import { CloudTasksClient, protos } from '@google-cloud/tasks';
import type { PortfolioImageMimeType } from '@nook/contracts';
import type { RuntimeConfig } from '@nook/config';

export interface SignedUploadPolicy {
  readonly method: 'POST';
  readonly url: string;
  readonly fields: Readonly<Record<string, string>>;
}

export interface MediaUploadSigner {
  sign(input: {
    readonly bucket: string;
    readonly objectKey: string;
    readonly mimeType: PortfolioImageMimeType;
    readonly expiresAt: Date;
  }): Promise<SignedUploadPolicy>;
}

export interface MediaVerificationQueue {
  enqueue(input: { readonly tenantId: string; readonly mediaAssetId: string }): Promise<void>;
}

export class MediaGatewayUnavailableError extends Error {
  constructor() {
    super('media gateway is unavailable');
    this.name = 'MediaGatewayUnavailableError';
  }
}

export class UnavailableMediaUploadSigner implements MediaUploadSigner {
  sign(): Promise<SignedUploadPolicy> {
    return Promise.reject(new MediaGatewayUnavailableError());
  }
}

export class UnavailableMediaVerificationQueue implements MediaVerificationQueue {
  enqueue(): Promise<void> {
    return Promise.reject(new MediaGatewayUnavailableError());
  }
}

export class GcsMediaUploadSigner implements MediaUploadSigner {
  private readonly storage: Storage;

  constructor(projectId: string) {
    this.storage = new Storage({ projectId });
  }

  async sign(input: {
    readonly bucket: string;
    readonly objectKey: string;
    readonly mimeType: PortfolioImageMimeType;
    readonly expiresAt: Date;
  }): Promise<SignedUploadPolicy> {
    const [policy] = await this.storage
      .bucket(input.bucket)
      .file(input.objectKey)
      .generateSignedPostPolicyV4({
        expires: input.expiresAt,
        fields: { 'Content-Type': input.mimeType },
        conditions: [
          ['content-length-range', 1, 15 * 1024 * 1024],
          ['eq', '$Content-Type', input.mimeType],
        ],
      });
    return { method: 'POST', url: policy.url, fields: policy.fields };
  }
}

export class GcpMediaVerificationQueue implements MediaVerificationQueue {
  private readonly client = new CloudTasksClient();

  constructor(private readonly config: Extract<RuntimeConfig['media'], { mode: 'gcp' }>) {}

  async enqueue(input: {
    readonly tenantId: string;
    readonly mediaAssetId: string;
  }): Promise<void> {
    const parent = this.client.queuePath(
      this.config.projectId,
      this.config.region,
      this.config.taskQueue,
    );
    const taskName = this.client.taskPath(
      this.config.projectId,
      this.config.region,
      this.config.taskQueue,
      `media-${input.mediaAssetId}`,
    );
    const body = Buffer.from(JSON.stringify(input)).toString('base64');
    const task: protos.google.cloud.tasks.v2.ITask = {
      name: taskName,
      httpRequest: {
        httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
        url: `${this.config.workerUrl.replace(/\/$/, '')}/internal/media/verify`,
        headers: { 'Content-Type': 'application/json' },
        body,
        oidcToken: {
          serviceAccountEmail: this.config.taskInvokerServiceAccount,
          audience: this.config.workerUrl,
        },
      },
    };
    try {
      await this.client.createTask({ parent, task });
    } catch (error) {
      if (isAlreadyExists(error)) return;
      throw error;
    }
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 6
  );
}
