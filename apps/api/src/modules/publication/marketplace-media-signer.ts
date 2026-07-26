import { Storage } from '@google-cloud/storage';

export interface MarketplaceMediaSigner {
  sign(input: { readonly bucket: string; readonly objectKey: string }): Promise<string>;
}

export class GcsMarketplaceMediaSigner implements MarketplaceMediaSigner {
  private readonly storage: Storage;

  constructor(projectId: string) {
    this.storage = new Storage({ projectId });
  }

  async sign(input: { readonly bucket: string; readonly objectKey: string }): Promise<string> {
    const [url] = await this.storage
      .bucket(input.bucket)
      .file(input.objectKey)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000,
      });
    return url;
  }
}

export class UnavailableMarketplaceMediaSigner implements MarketplaceMediaSigner {
  sign(): Promise<string> {
    return Promise.reject(new Error('marketplace media delivery is unavailable'));
  }
}
