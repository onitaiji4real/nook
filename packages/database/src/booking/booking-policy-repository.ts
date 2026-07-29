import { Prisma, type MembershipRole, type PrismaClient } from '@prisma/client';

export type BookingPolicyRepositoryErrorCode =
  | 'forbidden'
  | 'booking_policy_unavailable'
  | 'booking_policy_revision_conflict';

export class BookingPolicyRepositoryError extends Error {
  constructor(readonly code: BookingPolicyRepositoryErrorCode) {
    super(code);
    this.name = 'BookingPolicyRepositoryError';
  }
}

export interface BookingPolicyRecord {
  readonly revision: number;
  readonly slotIntervalMinutes: 5 | 10 | 15 | 20 | 30 | 60;
  readonly minimumLeadMinutes: number;
  readonly maximumAdvanceDays: number;
  readonly consumerCancelLeadMinutes: number;
  readonly consumerRescheduleLeadMinutes: number;
  readonly updatedAt: Date;
}

export interface BookingPolicyRepository {
  getForMember(input: { readonly tenantId: string; readonly actorUserId: string }): Promise<{
    readonly policy: BookingPolicyRecord;
    readonly role: MembershipRole;
    readonly tenantStatus: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  }>;
  update(input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly requestId: string;
    readonly expectedRevision: number;
    readonly slotIntervalMinutes: 5 | 10 | 15 | 20 | 30 | 60;
    readonly minimumLeadMinutes: number;
    readonly maximumAdvanceDays: number;
    readonly consumerCancelLeadMinutes: number;
    readonly consumerRescheduleLeadMinutes: number;
  }): Promise<BookingPolicyRecord>;
}

export class PrismaBookingPolicyRepository implements BookingPolicyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getForMember(input: { readonly tenantId: string; readonly actorUserId: string }) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        tenantId: input.tenantId,
        userId: input.actorUserId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
      },
      select: {
        role: true,
        tenant: { select: { status: true, bookingPolicy: true } },
      },
    });
    if (membership === null) throw new BookingPolicyRepositoryError('forbidden');
    if (membership.tenant.bookingPolicy === null)
      throw new BookingPolicyRepositoryError('booking_policy_unavailable');
    return {
      role: membership.role,
      tenantStatus: membership.tenant.status,
      policy: toRecord(membership.tenant.bookingPolicy),
    };
  }

  async update(input: Parameters<BookingPolicyRepository['update']>[0]) {
    return this.prisma.$transaction(
      async (tx) => {
        const membership = await tx.membership.findFirst({
          where: {
            tenantId: input.tenantId,
            userId: input.actorUserId,
            status: 'ACTIVE',
            role: { in: ['OWNER', 'MANAGER'] },
            user: { status: 'ACTIVE' },
            tenant: { status: 'ACTIVE' },
          },
          select: { id: true },
        });
        if (membership === null) throw new BookingPolicyRepositoryError('forbidden');
        const dbNow = await transactionNow(tx);
        const result = await tx.bookingPolicy.updateMany({
          where: { tenantId: input.tenantId, revision: input.expectedRevision },
          data: {
            revision: { increment: 1 },
            slotIntervalMinutes: input.slotIntervalMinutes,
            minimumLeadMinutes: input.minimumLeadMinutes,
            maximumAdvanceDays: input.maximumAdvanceDays,
            consumerCancelLeadMinutes: input.consumerCancelLeadMinutes,
            consumerRescheduleLeadMinutes: input.consumerRescheduleLeadMinutes,
            updatedAt: dbNow,
          },
        });
        if (result.count !== 1) {
          const exists = await tx.bookingPolicy.findUnique({
            where: { tenantId: input.tenantId },
            select: { tenantId: true },
          });
          throw new BookingPolicyRepositoryError(
            exists === null ? 'booking_policy_unavailable' : 'booking_policy_revision_conflict',
          );
        }
        const policy = await tx.bookingPolicy.findUniqueOrThrow({
          where: { tenantId: input.tenantId },
        });
        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorUserId: input.actorUserId,
            action: 'booking_policy.update',
            resourceType: 'booking_policy',
            resourceId: input.tenantId,
            requestId: input.requestId,
            beforeJson: { revision: input.expectedRevision },
            afterJson: { revision: policy.revision },
            createdAt: dbNow,
          },
        });
        return toRecord(policy);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

function toRecord(policy: {
  readonly revision: number;
  readonly slotIntervalMinutes: number;
  readonly minimumLeadMinutes: number;
  readonly maximumAdvanceDays: number;
  readonly consumerCancelLeadMinutes: number;
  readonly consumerRescheduleLeadMinutes: number;
  readonly updatedAt: Date;
}): BookingPolicyRecord {
  if (![5, 10, 15, 20, 30, 60].includes(policy.slotIntervalMinutes))
    throw new BookingPolicyRepositoryError('booking_policy_unavailable');
  return policy as BookingPolicyRecord;
}

async function transactionNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ dbNow: Date }>>(
    Prisma.sql`SELECT transaction_timestamp() AS "dbNow"`,
  );
  const dbNow = rows[0]?.dbNow;
  if (dbNow === undefined) throw new BookingPolicyRepositoryError('booking_policy_unavailable');
  return dbNow;
}
