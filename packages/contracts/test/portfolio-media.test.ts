import { describe, expect, it } from 'vitest';

import {
  createPortfolioUploadIntentRequestSchema,
  reorderPortfolioItemsRequestSchema,
  updatePortfolioItemRequestSchema,
  verifyMediaTaskRequestSchema,
} from '../src';

const itemId = '10000000-0000-4000-8000-000000000001';
const assetId = '10000000-0000-4000-8000-000000000002';

describe('portfolio media contracts', () => {
  it('accepts a bounded image upload intent and trims metadata', () => {
    const parsed = createPortfolioUploadIntentRequestSchema.parse({
      portfolioItemId: itemId,
      mediaAssetId: assetId,
      title: '  夏日霧面美甲  ',
      tags: ['霧面', '短甲'],
      mimeType: 'image/jpeg',
      byteSize: 1_000_000,
    });
    expect(parsed.title).toBe('夏日霧面美甲');
  });

  it.each([
    { mimeType: 'image/svg+xml', byteSize: 10 },
    { mimeType: 'image/jpeg', byteSize: 15 * 1024 * 1024 + 1 },
    { mimeType: 'image/jpeg', byteSize: 10, tags: Array.from({ length: 11 }, (_, i) => `${i}`) },
  ])('rejects unsafe or excessive upload input', (patch) => {
    const valid = {
      portfolioItemId: itemId,
      mediaAssetId: assetId,
      title: '作品',
      tags: [] as string[],
      mimeType: 'image/jpeg' as const,
      byteSize: 10,
    };
    expect(() =>
      createPortfolioUploadIntentRequestSchema.parse({
        ...valid,
        ...patch,
      }),
    ).toThrow();
  });

  it('rejects empty metadata patches and duplicate order IDs', () => {
    expect(updatePortfolioItemRequestSchema.safeParse({}).success).toBe(false);
    expect(
      reorderPortfolioItemsRequestSchema.safeParse({ portfolioItemIds: [itemId, itemId] }).success,
    ).toBe(false);
  });

  it('keeps worker payload limited to tenant and media UUIDs', () => {
    expect(
      verifyMediaTaskRequestSchema.safeParse({ tenantId: itemId, mediaAssetId: assetId }).success,
    ).toBe(true);
    expect(
      verifyMediaTaskRequestSchema.safeParse({
        tenantId: itemId,
        mediaAssetId: assetId,
        objectKey: 'client-controlled',
      }).success,
    ).toBe(false);
  });
});
