import type { PrismaClient } from '@prisma/client';

export interface AvailabilityProjection {
  readonly tenantId: string;
  readonly timezone: string;
  readonly policy: {
    readonly slotIntervalMinutes: number;
    readonly minimumLeadMinutes: number;
    readonly maximumAdvanceDays: number;
  } | null;
  readonly service: {
    readonly id: string;
    readonly name: string;
    readonly durationMinutes: number;
    readonly bufferBeforeMinutes: number;
    readonly bufferAfterMinutes: number;
  } | null;
  readonly staff: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly customDurationMinutes: number | null;
    readonly weeklyRules: readonly {
      readonly weekday: number;
      readonly startTime: string;
      readonly endTime: string;
      readonly validFrom: string;
      readonly validUntil: string | null;
    }[];
    readonly exceptions: readonly {
      readonly type: 'TIME_OFF' | 'EXTRA_HOURS' | 'BLOCK';
      readonly startAt: Date;
      readonly endAt: Date;
    }[];
    readonly occupancy: readonly {
      readonly startAt: Date;
      readonly endAt: Date;
    }[];
  }[];
}

export interface AvailabilityRepository {
  findPublishedProjection(input: {
    readonly slug: string;
    readonly serviceId: string;
    readonly staffId?: string;
    readonly rangeStart: Date;
    readonly rangeEnd: Date;
    readonly now: Date;
  }): Promise<AvailabilityProjection | null>;
}

export class PrismaAvailabilityRepository implements AvailabilityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPublishedProjection(input: {
    readonly slug: string;
    readonly serviceId: string;
    readonly staffId?: string;
    readonly rangeStart: Date;
    readonly rangeEnd: Date;
    readonly now: Date;
  }): Promise<AvailabilityProjection | null> {
    const tenant = await this.prisma.tenant.findFirst({
      where: {
        slug: input.slug,
        status: 'ACTIVE',
        merchantProfile: { is: { visibilityStatus: 'PUBLISHED', publishedAt: { not: null } } },
      },
      select: {
        id: true,
        bookingPolicy: {
          select: {
            slotIntervalMinutes: true,
            minimumLeadMinutes: true,
            maximumAdvanceDays: true,
          },
        },
        merchantProfile: {
          select: { primaryLocation: { select: { id: true, timezone: true, status: true } } },
        },
        services: {
          where: { id: input.serviceId, status: 'ACTIVE', bookingEnabled: true },
          select: {
            id: true,
            name: true,
            durationMinutes: true,
            bufferBeforeMinutes: true,
            bufferAfterMinutes: true,
          },
        },
        staffProfiles: {
          where: {
            ...(input.staffId === undefined ? {} : { id: input.staffId }),
            status: 'ACTIVE',
            bookingEnabled: true,
            location: { status: 'ACTIVE' },
            services: {
              some: {
                serviceId: input.serviceId,
                service: { status: 'ACTIVE', bookingEnabled: true },
              },
            },
          },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            locationId: true,
            displayName: true,
            services: {
              where: { serviceId: input.serviceId },
              select: { customDurationMinutes: true },
              take: 1,
            },
            weeklyRules: {
              where: {
                validFrom: { lte: input.rangeEnd },
                OR: [{ validUntil: null }, { validUntil: { gte: input.rangeStart } }],
              },
              orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
              select: {
                weekday: true,
                startTime: true,
                endTime: true,
                validFrom: true,
                validUntil: true,
              },
            },
            exceptions: {
              where: {
                status: 'ACTIVE',
                startAt: { lt: input.rangeEnd },
                endAt: { gt: input.rangeStart },
              },
              orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
              select: { type: true, startAt: true, endAt: true },
            },
          },
        },
      },
    });
    const location = tenant?.merchantProfile?.primaryLocation;
    if (
      tenant === null ||
      tenant === undefined ||
      location === null ||
      location === undefined ||
      location.status !== 'ACTIVE'
    )
      return null;
    const service = tenant.services[0] ?? null;
    const eligibleStaff = tenant.staffProfiles.filter(
      ({ locationId }) => locationId === location.id,
    );
    const occupancies = await this.prisma.bookingOccupancy.findMany({
      where: {
        tenantId: tenant.id,
        staffId: { in: eligibleStaff.map(({ id }) => id) },
        status: 'ACTIVE',
        occupiedStartAt: { lt: input.rangeEnd },
        occupiedEndAt: { gt: input.rangeStart },
        OR: [
          { appointmentId: { not: null } },
          {
            holdId: { not: null },
            hold: { status: 'ACTIVE', expiresAt: { gt: input.now } },
          },
        ],
      },
      select: { staffId: true, occupiedStartAt: true, occupiedEndAt: true },
    });
    return {
      tenantId: tenant.id,
      timezone: location.timezone,
      policy: tenant.bookingPolicy,
      service,
      staff: eligibleStaff.map((staff) => ({
        id: staff.id,
        displayName: staff.displayName,
        customDurationMinutes: staff.services[0]?.customDurationMinutes ?? null,
        weeklyRules: staff.weeklyRules.map((rule) => ({
          weekday: rule.weekday,
          startTime: timeValue(rule.startTime),
          endTime: timeValue(rule.endTime),
          validFrom: dateValue(rule.validFrom),
          validUntil: rule.validUntil === null ? null : dateValue(rule.validUntil),
        })),
        exceptions: staff.exceptions,
        occupancy: occupancies
          .filter(({ staffId }) => staffId === staff.id)
          .map(({ occupiedStartAt, occupiedEndAt }) => ({
            startAt: occupiedStartAt,
            endAt: occupiedEndAt,
          })),
      })),
    };
  }
}

function timeValue(value: Date): string {
  return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
}

function dateValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}
