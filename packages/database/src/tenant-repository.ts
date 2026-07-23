import {
  MembershipRole,
  MembershipStatus,
  Prisma,
  type PrismaClient,
  type TenantStatus,
  UserStatus,
} from '@prisma/client';

export interface CreateTenantWithOwnerInput {
  readonly ownerUserId: string;
  readonly name: string;
  readonly slug: string;
  readonly requestId: string;
}

export interface TenantMembershipRecord {
  readonly tenant: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly status: TenantStatus;
  };
  readonly membership: {
    readonly role: MembershipRole;
    readonly status: MembershipStatus;
  };
}

export interface UserMembershipRecord {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly tenantStatus: TenantStatus;
  readonly tenantTimezone: string;
  readonly role: MembershipRole;
  readonly status: MembershipStatus;
}

export interface TenantRepository {
  createTenantWithOwner(input: CreateTenantWithOwnerInput): Promise<TenantMembershipRecord>;
  findActiveTenantMembership(input: {
    readonly tenantId: string;
    readonly userId: string;
  }): Promise<TenantMembershipRecord | null>;
  listMembershipsForUser(userId: string): Promise<readonly UserMembershipRecord[]>;
  recordAuthorizationDeniedIfTenantExists(input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly requestId: string;
  }): Promise<void>;
}

export type TenantConflictCode = 'duplicate_slug' | 'duplicate_membership';

export function classifyTenantConflict(error: unknown): TenantConflictCode | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return null;
  }

  const rawTarget = error.meta?.target;
  const target = Array.isArray(rawTarget)
    ? rawTarget.map((value) => (typeof value === 'string' ? value : '')).join(',')
    : typeof rawTarget === 'string'
      ? rawTarget
      : '';

  if (target.includes('slug')) {
    return 'duplicate_slug';
  }

  if (target.includes('tenant_id') || target.includes('tenantId')) {
    return 'duplicate_membership';
  }

  return null;
}

export class PrismaTenantRepository implements TenantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createTenantWithOwner(input: CreateTenantWithOwnerInput): Promise<TenantMembershipRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const defaultPlan = await transaction.plan.findFirst({
        where: { isDefault: true },
        select: { id: true },
      });
      if (defaultPlan === null) {
        throw new Error('default plan is not configured');
      }
      const tenant = await transaction.tenant.create({
        data: {
          name: input.name,
          slug: input.slug,
          planId: defaultPlan.id,
          bookingPolicy: { create: {} },
        },
        select: { id: true, name: true, slug: true, status: true },
      });

      const membership = await transaction.membership.create({
        data: {
          tenantId: tenant.id,
          userId: input.ownerUserId,
          role: MembershipRole.OWNER,
          status: MembershipStatus.ACTIVE,
        },
        select: { role: true, status: true },
      });

      await transaction.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: input.ownerUserId,
          action: 'tenant.created',
          resourceType: 'tenant',
          resourceId: tenant.id,
          requestId: input.requestId,
        },
      });

      return { tenant, membership };
    });
  }

  async findActiveTenantMembership(input: {
    readonly tenantId: string;
    readonly userId: string;
  }): Promise<TenantMembershipRecord | null> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        tenantId: input.tenantId,
        userId: input.userId,
        status: MembershipStatus.ACTIVE,
        tenant: { status: 'ACTIVE' },
        user: { status: UserStatus.ACTIVE },
      },
      select: {
        role: true,
        status: true,
        tenant: { select: { id: true, name: true, slug: true, status: true } },
      },
    });

    if (membership === null) {
      return null;
    }

    return {
      tenant: membership.tenant,
      membership: { role: membership.role, status: membership.status },
    };
  }

  async listMembershipsForUser(userId: string): Promise<readonly UserMembershipRecord[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, user: { status: UserStatus.ACTIVE } },
      orderBy: { createdAt: 'asc' },
      select: {
        tenantId: true,
        role: true,
        status: true,
        tenant: { select: { name: true, slug: true, status: true, usageTimezone: true } },
      },
    });

    return memberships.map(({ tenant, ...membership }) => ({
      ...membership,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      tenantStatus: tenant.status,
      tenantTimezone: tenant.usageTimezone,
    }));
  }

  async recordAuthorizationDeniedIfTenantExists(input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly requestId: string;
  }): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { id: true },
    });

    if (tenant === null) {
      return;
    }

    await this.prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: 'authorization.denied',
        resourceType: 'tenant',
        resourceId: input.tenantId,
        requestId: input.requestId,
      },
    });
  }
}
