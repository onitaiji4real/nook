import { describe, expect, it } from 'vitest';

import {
  buildMerchantLineRedirectUrl,
  merchantStudioEntryEventRequestSchema,
  parseStudioRouteKey,
  resolveStudioNavigation,
  studioRouteKeySchema,
  type StudioMembershipRole,
  type StudioRouteKey,
} from '../src';

const routes = studioRouteKeySchema.options;
const roles = ['OWNER', 'MANAGER', 'VIEWER', 'STAFF'] as const;

describe('merchant Studio entry contract', () => {
  it.each([
    ['OWNER', ['manage', 'manage', 'manage', 'manage', 'manage', 'manage']],
    ['MANAGER', ['manage', 'manage', 'manage', 'manage', 'manage', 'manage']],
    ['VIEWER', ['read', 'read', 'fallback', 'fallback', 'fallback', 'fallback']],
    ['STAFF', ['read', 'scoped', 'fallback', 'fallback', 'fallback', 'fallback']],
  ] as const)('resolves all six routes for %s without changing authority', (role, expected) => {
    expect(routes.map((routeKey) => resolveStudioNavigation({ routeKey, role }).access)).toEqual(
      expected,
    );
  });

  it('maps every allowed route to a bounded Studio path', () => {
    const decisions = roles.flatMap((role: StudioMembershipRole) =>
      routes.map((routeKey: StudioRouteKey) => resolveStudioNavigation({ routeKey, role })),
    );

    expect(decisions).toHaveLength(24);
    for (const decision of decisions) {
      expect(decision.href).toMatch(/^\/studio(?:\/[a-z-]+)?$/);
      expect(decision.href).not.toContain('?');
      expect(decision.href).not.toContain('://');
    }
  });

  it('falls invalid or hostile route values back to home', () => {
    expect(parseStudioRouteKey('https://evil.example/steal')).toBe('home');
    expect(parseStudioRouteKey('//evil.example')).toBe('home');
    expect(parseStudioRouteKey('appointments?tenantId=other')).toBe('home');
    expect(parseStudioRouteKey(undefined)).toBe('home');
  });

  it('builds a same-origin canonical redirect with only the validated route', () => {
    const redirect = buildMerchantLineRedirectUrl({
      currentUrl:
        'https://studio.example/line/studio?returnUrl=https://evil.example&tenantId=other',
      routeKey: 'appointments',
    });

    expect(redirect).toBe('https://studio.example/line/studio?route=appointments');
    expect(redirect).not.toContain('evil');
    expect(redirect).not.toContain('tenantId');
  });

  it.each([
    'javascript:alert(1)',
    'file:///private/data',
    'https://user:password@studio.example/line/studio',
  ])('rejects a redirect origin that cannot be trusted: %s', (currentUrl) => {
    expect(() => buildMerchantLineRedirectUrl({ currentUrl, routeKey: 'home' })).toThrowError();
  });

  it('rejects unbounded analytics fields and unknown outcomes', () => {
    expect(
      merchantStudioEntryEventRequestSchema.safeParse({
        tenantId: '00000000-0000-4000-8000-000000000001',
        routeKey: 'appointments',
        returnUrl: 'https://evil.example',
      }).success,
    ).toBe(false);
    expect(
      merchantStudioEntryEventRequestSchema.safeParse({
        tenantId: '00000000-0000-4000-8000-000000000001',
        routeKey: 'appointments',
        outcome: 'CLICKED',
      }).success,
    ).toBe(false);
  });
});
