import { describe, expect, it } from 'vitest';

import { merchantOnboardingRequestSchema } from '../src';

const validRequest = {
  profile: {
    category: 'NAIL',
    phone: '0912-345-678',
    lineOaUrl: 'https://lin.ee/synthetic',
    instagramUrl: 'https://www.instagram.com/synthetic.studio/',
  },
  location: {
    id: '10000000-0000-4000-8000-000000000001',
    name: '主要工作室',
    addressText: '台北市中山區測試路 1 號',
    postalCode: '104',
    city: '台北市',
    district: '中山區',
    isPublicAddress: false,
  },
  service: {
    id: '20000000-0000-4000-8000-000000000001',
    name: '單色凝膠',
    durationMinutes: 90,
    bufferBeforeMinutes: 10,
    bufferAfterMinutes: 15,
    price: { type: 'FIXED', amount: 1200 },
    bookingEnabled: true,
  },
} as const;

describe('merchant onboarding contract', () => {
  it('accepts a complete Taiwan merchant starter setup', () => {
    expect(merchantOnboardingRequestSchema.parse(validRequest)).toEqual(validRequest);
  });

  it('rejects an inverted price range and non-LINE redirect host', () => {
    const result = merchantOnboardingRequestSchema.safeParse({
      ...validRequest,
      profile: { ...validRequest.profile, lineOaUrl: 'https://example.com/pretend-line' },
      service: { ...validRequest.service, price: { type: 'RANGE', min: 2000, max: 1000 } },
    });

    expect(result.success).toBe(false);
  });

  it('defaults private address, zero buffers, and booking enabled', () => {
    const result = merchantOnboardingRequestSchema.parse({
      profile: { category: 'LASH' },
      location: {
        id: validRequest.location.id,
        name: validRequest.location.name,
        addressText: validRequest.location.addressText,
        city: validRequest.location.city,
        district: validRequest.location.district,
      },
      service: {
        id: validRequest.service.id,
        name: validRequest.service.name,
        durationMinutes: validRequest.service.durationMinutes,
        price: { type: 'QUOTE' },
      },
    });

    expect(result.location.isPublicAddress).toBe(false);
    expect(result.service).toMatchObject({
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      bookingEnabled: true,
    });
  });
});
