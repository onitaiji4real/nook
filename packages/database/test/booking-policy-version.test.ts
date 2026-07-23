import { describe, expect, it } from 'vitest';

import { createBookingPolicyVersion, createBookingPolicyVersionV2 } from '../src';

describe('booking policy version', () => {
  it('uses the fixed compact JSON insertion order and lowercase SHA-256 vector', () => {
    expect(createBookingPolicyVersion('完全預約制', '提前24小時')).toBe(
      'v1:45e250fe267c7d46d979461c4192a671359ececb21d2738e044b3f4615ccc024',
    );
  });

  it('includes structured lifecycle leads in the fixed v2 vector', () => {
    expect(createBookingPolicyVersionV2('完全預約制', '提前24小時', 1_440, 1_440)).toBe(
      'v2:68ad4ba258354505ca2749f74a30f739ee9194d4b58c93819882fa30aae23dff',
    );
  });
});
