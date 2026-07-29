import { describe, expect, it } from 'vitest';

import {
  currentTaipeiDate,
  taipeiLocalToUtcIso,
  utcIsoToTaipeiLocal,
} from '../src/features/staff-scheduling/taipei-date-time';

describe('Taipei date-time conversion', () => {
  it('stores a datetime-local value as the corresponding UTC instant', () => {
    expect(taipeiLocalToUtcIso('2026-08-08T10:00')).toBe('2026-08-08T02:00:00.000Z');
  });

  it('renders UTC values in Asia/Taipei independent of the browser timezone', () => {
    expect(utcIsoToTaipeiLocal('2026-08-08T02:00:00.000Z')).toBe('2026-08-08T10:00');
  });

  it('derives the product date from Asia/Taipei around a UTC date boundary', () => {
    expect(currentTaipeiDate(new Date('2026-07-21T16:30:00.000Z'))).toBe('2026-07-22');
  });

  it('rejects malformed local input instead of guessing a timezone', () => {
    expect(() => taipeiLocalToUtcIso('08/08/2026 10:00')).toThrow('例外時段格式無效');
  });
});
