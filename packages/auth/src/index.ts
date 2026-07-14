export type MembershipRole = 'OWNER' | 'MANAGER' | 'STAFF' | 'VIEWER';

export interface AuthorizationContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly roles: readonly MembershipRole[];
}
