import { describe, expect, it } from 'vitest';

import {
  createServiceRequestSchema,
  reorderServicesRequestSchema,
  updateServiceRequestSchema,
} from '../src';

const validService = {
  id: '20000000-0000-4000-8000-000000000020',
  name: '日式自然款',
  durationMinutes: 120,
  price: { type: 'FROM', amount: 1600 },
} as const;

describe('service catalog contract', () => {
  it('defaults buffers and booking availability for a new service', () => {
    expect(createServiceRequestSchema.parse(validService)).toEqual({
      ...validService,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      bookingEnabled: true,
    });
  });

  it('rejects empty patches and invalid price ranges', () => {
    expect(updateServiceRequestSchema.safeParse({}).success).toBe(false);
    expect(
      updateServiceRequestSchema.safeParse({ price: { type: 'RANGE', min: 2000, max: 1000 } })
        .success,
    ).toBe(false);
  });

  it('requires one exact, duplicate-free ordering list', () => {
    expect(
      reorderServicesRequestSchema.safeParse({ serviceIds: [validService.id, validService.id] })
        .success,
    ).toBe(false);
    expect(reorderServicesRequestSchema.parse({ serviceIds: [validService.id] })).toEqual({
      serviceIds: [validService.id],
    });
  });
});
