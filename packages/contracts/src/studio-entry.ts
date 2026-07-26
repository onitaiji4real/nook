import { z } from 'zod';

export const studioRouteKeySchema = z.enum([
  'home',
  'appointments',
  'services',
  'availability',
  'portfolio',
  'policies',
]);

export const studioMembershipRoleSchema = z.enum(['OWNER', 'MANAGER', 'STAFF', 'VIEWER']);

export const merchantStudioEntryOutcomeSchema = z.enum(['NAVIGATED', 'ROLE_FALLBACK']);

export const merchantStudioEntryEventRequestSchema = z
  .object({
    tenantId: z.string().uuid(),
    routeKey: studioRouteKeySchema,
  })
  .strict();

export type StudioRouteKey = z.infer<typeof studioRouteKeySchema>;
export type StudioMembershipRole = z.infer<typeof studioMembershipRoleSchema>;
export type MerchantStudioEntryOutcome = z.infer<typeof merchantStudioEntryOutcomeSchema>;
export type MerchantStudioEntryEventRequest = z.infer<typeof merchantStudioEntryEventRequestSchema>;

export type StudioRouteAccess = 'manage' | 'read' | 'scoped' | 'fallback';

export interface StudioNavigationDecision {
  readonly routeKey: StudioRouteKey;
  readonly href: string;
  readonly access: StudioRouteAccess;
}

const studioRouteHref: Readonly<Record<StudioRouteKey, string>> = {
  home: '/studio',
  appointments: '/studio/appointments',
  services: '/studio/services',
  availability: '/studio/staff',
  portfolio: '/studio/portfolio',
  policies: '/studio/policies',
};

const roleAccess: Readonly<
  Record<StudioMembershipRole, Readonly<Record<StudioRouteKey, StudioRouteAccess>>>
> = {
  OWNER: {
    home: 'manage',
    appointments: 'manage',
    services: 'manage',
    availability: 'manage',
    portfolio: 'manage',
    policies: 'manage',
  },
  MANAGER: {
    home: 'manage',
    appointments: 'manage',
    services: 'manage',
    availability: 'manage',
    portfolio: 'manage',
    policies: 'manage',
  },
  VIEWER: {
    home: 'read',
    appointments: 'read',
    services: 'fallback',
    availability: 'fallback',
    portfolio: 'fallback',
    policies: 'fallback',
  },
  STAFF: {
    home: 'read',
    appointments: 'scoped',
    services: 'fallback',
    availability: 'fallback',
    portfolio: 'fallback',
    policies: 'fallback',
  },
};

export function parseStudioRouteKey(value: unknown): StudioRouteKey {
  const parsed = studioRouteKeySchema.safeParse(value);
  return parsed.success ? parsed.data : 'home';
}

export function resolveStudioNavigation(input: {
  readonly routeKey: StudioRouteKey;
  readonly role: StudioMembershipRole;
}): StudioNavigationDecision {
  const access = roleAccess[input.role][input.routeKey];
  return {
    routeKey: input.routeKey,
    href: access === 'fallback' ? studioRouteHref.home : studioRouteHref[input.routeKey],
    access,
  };
}

export function buildMerchantLineRedirectUrl(input: {
  readonly currentUrl: string;
  readonly routeKey: StudioRouteKey;
}): string {
  const current = new URL(input.currentUrl);
  if (
    !['http:', 'https:'].includes(current.protocol) ||
    current.username !== '' ||
    current.password !== ''
  ) {
    throw new Error('Merchant LINE entry requires an HTTP(S) origin without credentials.');
  }

  const redirect = new URL('/line/studio', current.origin);
  redirect.searchParams.set('route', input.routeKey);
  return redirect.toString();
}
