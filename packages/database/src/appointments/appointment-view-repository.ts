import {
  Prisma,
  type AppointmentReasonCode,
  type AppointmentStatus,
  type PrismaClient,
} from '@prisma/client';

export type AppointmentListView = 'upcoming' | 'past';

export interface AppointmentPageCursor {
  readonly startAt: Date;
  readonly id: string;
}

export interface AppointmentHistoryRecord {
  readonly fromStatus: AppointmentStatus | null;
  readonly toStatus: AppointmentStatus;
  readonly createdAt: Date;
  readonly reasonCode: AppointmentReasonCode | null;
}

export interface AppointmentViewRecord {
  readonly id: string;
  readonly status: AppointmentStatus;
  readonly source: 'MERCHANT_LINK' | 'MARKETPLACE' | 'ADMIN' | 'STAFF' | 'IMPORT';
  readonly pricingStatus: 'EXACT' | 'ESTIMATE' | 'QUOTE_REQUIRED';
  readonly paymentStatus: 'NOT_REQUIRED';
  readonly timezone: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly confirmedAt: Date;
  readonly currency: string;
  readonly subtotalAmount: number | null;
  readonly depositAmount: 0;
  readonly totalAmount: number | null;
  readonly service: {
    readonly id: string;
    readonly name: string;
    readonly durationMinutes: number;
    readonly priceType: 'FIXED' | 'FROM' | 'RANGE' | 'QUOTE';
    readonly priceAmount: number | null;
    readonly priceMin: number | null;
    readonly priceMax: number | null;
    readonly currency: string;
  };
  readonly staff: { readonly id: string; readonly displayName: string };
  readonly location: {
    readonly name: string;
    readonly addressText: string;
    readonly postalCode: string | null;
    readonly city: string;
    readonly district: string;
  };
  readonly policies: {
    readonly version: string;
    readonly bookingPolicy: string;
    readonly cancellationPolicy: string;
    readonly acceptedAt: Date;
    readonly consumerCancelLeadMinutes: number;
    readonly consumerRescheduleLeadMinutes: number;
    readonly cancelUntil: Date;
    readonly rescheduleUntil: Date;
    readonly cancelUntilInclusive: boolean;
    readonly rescheduleUntilInclusive: boolean;
  };
  readonly evaluatedAt: Date;
  readonly rescheduleContext: {
    readonly merchantSlug: string;
    readonly serviceId: string;
    readonly locationId: string;
  } | null;
  readonly consumerDisplayName: string | null;
  readonly history: readonly AppointmentHistoryRecord[];
}

export interface AppointmentViewPage {
  readonly asOf: Date;
  readonly items: readonly AppointmentViewRecord[];
  readonly next: AppointmentPageCursor | null;
}

export interface MerchantAppointmentViewPage extends AppointmentViewPage {
  readonly calendarTimezone: string;
}

export type AppointmentViewRepositoryErrorCode = 'appointment_view_unavailable';

export class AppointmentViewRepositoryError extends Error {
  constructor(readonly code: AppointmentViewRepositoryErrorCode) {
    super(code);
    this.name = 'AppointmentViewRepositoryError';
  }
}

export interface AppointmentViewRepository {
  resolveActiveStaffId(input: {
    readonly tenantId: string;
    readonly userId: string;
  }): Promise<string | null>;
  listForConsumer(input: {
    readonly consumerUserId: string;
    readonly view: AppointmentListView;
    readonly limit: number;
    readonly asOf?: Date | undefined;
    readonly after?: AppointmentPageCursor | undefined;
  }): Promise<AppointmentViewPage>;
  findForConsumer(input: {
    readonly consumerUserId: string;
    readonly appointmentId: string;
  }): Promise<AppointmentViewRecord | null>;
  listForTenant(input: {
    readonly tenantId: string;
    readonly from: Date;
    readonly to: Date;
    readonly staffId?: string | undefined;
    readonly status?: AppointmentStatus | undefined;
    readonly limit: number;
    readonly asOf?: Date | undefined;
    readonly after?: AppointmentPageCursor | undefined;
  }): Promise<MerchantAppointmentViewPage>;
  findForTenant(input: {
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly staffId?: string | undefined;
  }): Promise<AppointmentViewRecord | null>;
}

const baseInclude = Prisma.validator<Prisma.AppointmentInclude>()({
  item: true,
  hold: { select: { staffDisplayNameSnapshot: true } },
});

const detailInclude = Prisma.validator<Prisma.AppointmentInclude>()({
  ...baseInclude,
  statusHistory: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
});

const merchantSummaryInclude = Prisma.validator<Prisma.AppointmentInclude>()({
  ...baseInclude,
  consumer: { select: { displayName: true } },
});

const merchantDetailInclude = Prisma.validator<Prisma.AppointmentInclude>()({
  ...detailInclude,
  consumer: { select: { displayName: true } },
});

type ConsumerSummaryRow = Prisma.AppointmentGetPayload<{ include: typeof baseInclude }>;
type ConsumerDetailRow = Prisma.AppointmentGetPayload<{ include: typeof detailInclude }>;
type MerchantSummaryRow = Prisma.AppointmentGetPayload<{ include: typeof merchantSummaryInclude }>;
type MerchantDetailRow = Prisma.AppointmentGetPayload<{ include: typeof merchantDetailInclude }>;
type AppointmentRow =
  | ConsumerSummaryRow
  | ConsumerDetailRow
  | MerchantSummaryRow
  | MerchantDetailRow;

const terminalStatuses: AppointmentStatus[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'];

export class PrismaAppointmentViewRepository implements AppointmentViewRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveActiveStaffId(input: {
    readonly tenantId: string;
    readonly userId: string;
  }): Promise<string | null> {
    const rows = await this.prisma.staffProfile.findMany({
      where: { tenantId: input.tenantId, userId: input.userId, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
      take: 2,
      select: { id: true },
    });
    return rows.length === 1 ? (rows[0]?.id ?? null) : null;
  }

  listForConsumer(input: {
    readonly consumerUserId: string;
    readonly view: AppointmentListView;
    readonly limit: number;
    readonly asOf?: Date | undefined;
    readonly after?: AppointmentPageCursor | undefined;
  }): Promise<AppointmentViewPage> {
    return this.prisma.$transaction(async (transaction) => {
      const asOf = input.asOf ?? (await transactionNow(transaction));
      const ascending = input.view === 'upcoming';
      const rows = await transaction.appointment.findMany({
        where: {
          consumerUserId: input.consumerUserId,
          AND: [
            input.view === 'upcoming'
              ? { status: { in: ['CONFIRMED', 'CHECKED_IN'] }, endAt: { gte: asOf } }
              : { OR: [{ status: { in: terminalStatuses } }, { endAt: { lt: asOf } }] },
            cursorPredicate(input.after, ascending),
          ],
        },
        orderBy: [{ startAt: ascending ? 'asc' : 'desc' }, { id: ascending ? 'asc' : 'desc' }],
        take: input.limit + 1,
        include: baseInclude,
      });
      return page(rows, input.limit, asOf, (row) => toRecord(row, null));
    });
  }

  async findForConsumer(input: {
    readonly consumerUserId: string;
    readonly appointmentId: string;
  }): Promise<AppointmentViewRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const evaluatedAt = await transactionNow(transaction);
      const row = await transaction.appointment.findFirst({
        where: { consumerUserId: input.consumerUserId, id: input.appointmentId },
        include: detailInclude,
      });
      if (row === null) return null;
      const merchant = await transaction.tenant.findFirst({
        where: {
          id: row.tenantId,
          status: 'ACTIVE',
          merchantProfile: {
            is: { visibilityStatus: 'PUBLISHED', publishedAt: { not: null } },
          },
          locations: { some: { id: row.locationId, status: 'ACTIVE' } },
          services: {
            some: { id: row.item?.serviceId ?? '', status: 'ACTIVE', bookingEnabled: true },
          },
        },
        select: { slug: true },
      });
      return toRecord(row, null, evaluatedAt, merchant === null ? null : merchant.slug);
    });
  }

  listForTenant(input: {
    readonly tenantId: string;
    readonly from: Date;
    readonly to: Date;
    readonly staffId?: string | undefined;
    readonly status?: AppointmentStatus | undefined;
    readonly limit: number;
    readonly asOf?: Date | undefined;
    readonly after?: AppointmentPageCursor | undefined;
  }): Promise<MerchantAppointmentViewPage> {
    return this.prisma.$transaction(async (transaction) => {
      const tenant = await transaction.tenant.findFirst({
        where: { id: input.tenantId },
        select: { usageTimezone: true },
      });
      if (tenant === null) throw new AppointmentViewRepositoryError('appointment_view_unavailable');
      const asOf = input.asOf ?? (await transactionNow(transaction));
      const rows = await transaction.appointment.findMany({
        where: {
          tenantId: input.tenantId,
          ...(input.staffId === undefined ? {} : { staffId: input.staffId }),
          ...(input.status === undefined ? {} : { status: input.status }),
          startAt: { lt: input.to },
          endAt: { gt: input.from },
          AND: [cursorPredicate(input.after, true)],
        },
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        take: input.limit + 1,
        include: merchantSummaryInclude,
      });
      return {
        ...page(rows, input.limit, asOf, (row) => toRecord(row, row.consumer.displayName)),
        calendarTimezone: tenant.usageTimezone,
      };
    });
  }

  async findForTenant(input: {
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly staffId?: string | undefined;
  }): Promise<AppointmentViewRecord | null> {
    const row = await this.prisma.appointment.findFirst({
      where: {
        tenantId: input.tenantId,
        id: input.appointmentId,
        ...(input.staffId === undefined ? {} : { staffId: input.staffId }),
      },
      include: merchantDetailInclude,
    });
    if (row === null) return null;
    const evaluatedAt = await this.prisma.$transaction(transactionNow);
    return toRecord(row, row.consumer.displayName, evaluatedAt, null);
  }
}

function cursorPredicate(
  cursor: AppointmentPageCursor | undefined,
  ascending: boolean,
): Prisma.AppointmentWhereInput {
  if (cursor === undefined) return {};
  const comparison = ascending ? 'gt' : 'lt';
  return {
    OR: [
      { startAt: { [comparison]: cursor.startAt } },
      { startAt: cursor.startAt, id: { [comparison]: cursor.id } },
    ],
  };
}

function page<Row extends { readonly id: string; readonly startAt: Date }>(
  rows: readonly Row[],
  limit: number,
  asOf: Date,
  map: (row: Row) => AppointmentViewRecord,
): AppointmentViewPage {
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    asOf,
    items: visible.map(map),
    next: rows.length > limit && last !== undefined ? { startAt: last.startAt, id: last.id } : null,
  };
}

function toRecord(
  row: AppointmentRow,
  consumerDisplayName: string | null,
  evaluatedAt = new Date(0),
  merchantSlug: string | null = null,
): AppointmentViewRecord {
  if (row.item === null || row.paymentStatus !== 'NOT_REQUIRED' || row.depositAmount !== 0) {
    throw new AppointmentViewRepositoryError('appointment_view_unavailable');
  }
  const history = 'statusHistory' in row ? row.statusHistory : [];
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    pricingStatus: row.pricingStatus,
    paymentStatus: row.paymentStatus,
    timezone: row.locationTimezoneSnapshot,
    startAt: row.startAt,
    endAt: row.endAt,
    confirmedAt: row.confirmedAt,
    currency: row.currency,
    subtotalAmount: row.subtotalAmount,
    depositAmount: 0,
    totalAmount: row.totalAmount,
    service: {
      id: row.item.serviceId,
      name: row.item.serviceNameSnapshot,
      durationMinutes: row.item.durationMinutesSnapshot,
      priceType: row.item.priceTypeSnapshot,
      priceAmount: row.item.priceAmountSnapshot,
      priceMin: row.item.priceMinSnapshot,
      priceMax: row.item.priceMaxSnapshot,
      currency: row.item.currencySnapshot,
    },
    staff: { id: row.staffId, displayName: row.hold.staffDisplayNameSnapshot },
    location: {
      name: row.locationNameSnapshot,
      addressText: row.addressTextSnapshot,
      postalCode: row.postalCodeSnapshot,
      city: row.citySnapshot,
      district: row.districtSnapshot,
    },
    policies: {
      version: row.policyVersion,
      bookingPolicy: row.bookingPolicySnapshot,
      cancellationPolicy: row.cancellationPolicySnapshot,
      acceptedAt: row.policiesAcceptedAt,
      consumerCancelLeadMinutes: row.consumerCancelLeadMinutesSnapshot,
      consumerRescheduleLeadMinutes: row.consumerRescheduleLeadMinutesSnapshot,
      cancelUntil: new Date(row.startAt.getTime() - row.consumerCancelLeadMinutesSnapshot * 60_000),
      rescheduleUntil: new Date(
        row.startAt.getTime() - row.consumerRescheduleLeadMinutesSnapshot * 60_000,
      ),
      cancelUntilInclusive: row.consumerCancelLeadMinutesSnapshot > 0,
      rescheduleUntilInclusive: row.consumerRescheduleLeadMinutesSnapshot > 0,
    },
    evaluatedAt,
    rescheduleContext:
      merchantSlug === null || row.item === null
        ? null
        : { merchantSlug, serviceId: row.item.serviceId, locationId: row.locationId },
    consumerDisplayName,
    history: history.map(({ fromStatus, toStatus, createdAt, reasonCode }) => ({
      fromStatus,
      toStatus,
      createdAt,
      reasonCode,
    })),
  };
}

async function transactionNow(transaction: Prisma.TransactionClient): Promise<Date> {
  const rows = await transaction.$queryRaw<Array<{ dbNow: Date }>>(
    Prisma.sql`SELECT transaction_timestamp() AS "dbNow"`,
  );
  const dbNow = rows[0]?.dbNow;
  if (dbNow === undefined) throw new AppointmentViewRepositoryError('appointment_view_unavailable');
  return dbNow;
}
