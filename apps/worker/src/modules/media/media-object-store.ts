import { Storage } from '@google-cloud/storage';

export interface StoredObjectMetadata {
  readonly contentType: string | null;
  readonly byteSize: number;
}

export interface MediaObjectStore {
  metadata(bucket: string, objectKey: string): Promise<StoredObjectMetadata>;
  download(bucket: string, objectKey: string): Promise<Buffer>;
  saveWebp(bucket: string, objectKey: string, contents: Buffer): Promise<void>;
  deleteIfExists(bucket: string, objectKey: string): Promise<void>;
}

export class MediaObjectStoreUnavailableError extends Error {
  constructor() {
    super('media object store is unavailable');
    this.name = 'MediaObjectStoreUnavailableError';
  }
}

export class UnavailableMediaObjectStore implements MediaObjectStore {
  metadata(): Promise<StoredObjectMetadata> {
    return Promise.reject(new MediaObjectStoreUnavailableError());
  }
  download(): Promise<Buffer> {
    return Promise.reject(new MediaObjectStoreUnavailableError());
  }
  saveWebp(): Promise<void> {
    return Promise.reject(new MediaObjectStoreUnavailableError());
  }
  deleteIfExists(): Promise<void> {
    return Promise.reject(new MediaObjectStoreUnavailableError());
  }
}

export class GcsMediaObjectStore implements MediaObjectStore {
  private readonly storage: Storage;

  constructor(projectId: string) {
    this.storage = new Storage({ projectId });
  }

  async metadata(bucket: string, objectKey: string): Promise<StoredObjectMetadata> {
    const [metadata] = await this.storage.bucket(bucket).file(objectKey).getMetadata();
    const byteSize = Number(metadata.size);
    if (!Number.isSafeInteger(byteSize) || byteSize < 1) throw new Error('invalid object size');
    return {
      contentType: typeof metadata.contentType === 'string' ? metadata.contentType : null,
      byteSize,
    };
  }

  async download(bucket: string, objectKey: string): Promise<Buffer> {
    const [contents] = await this.storage
      .bucket(bucket)
      .file(objectKey)
      .download({ validation: 'crc32c' });
    return contents;
  }

  async saveWebp(bucket: string, objectKey: string, contents: Buffer): Promise<void> {
    await this.storage
      .bucket(bucket)
      .file(objectKey)
      .save(contents, {
        contentType: 'image/webp',
        resumable: false,
        validation: 'crc32c',
        metadata: { cacheControl: 'private,max-age=31536000,immutable' },
      });
  }

  async deleteIfExists(bucket: string, objectKey: string): Promise<void> {
    await this.storage.bucket(bucket).file(objectKey).delete({ ignoreNotFound: true });
  }
}
