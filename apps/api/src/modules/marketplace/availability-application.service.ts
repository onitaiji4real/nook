import { Inject, Injectable } from '@nestjs/common';
import type { AvailabilityQuery, PublicAvailabilityResponse } from '@nook/contracts';
import type { AvailabilityRepository } from '@nook/database';
import { calculateAvailability, instantToLocalDate } from '@nook/domain';

import { ApplicationError } from '../../application-error';
import { AVAILABILITY_CLOCK, AVAILABILITY_REPOSITORY } from './marketplace.tokens';

export type AvailabilityClock = () => Date;

@Injectable()
export class AvailabilityApplicationService {
  constructor(
    @Inject(AVAILABILITY_REPOSITORY) private readonly repository: AvailabilityRepository,
    @Inject(AVAILABILITY_CLOCK) private readonly clock: AvailabilityClock,
  ) {}

  async find(input: {
    readonly slug: string;
    readonly query: AvailabilityQuery;
    readonly requestId: string;
  }): Promise<PublicAvailabilityResponse> {
    const now = this.clock();
    const range = broadUtcRange(input.query.date, input.query.days);
    const projection = await this.repository.findPublishedProjection({
      slug: input.slug,
      serviceId: input.query.serviceId,
      ...(input.query.staffId === undefined ? {} : { staffId: input.query.staffId }),
      ...range,
      now,
    });
    if (
      projection === null ||
      projection.service === null ||
      (input.query.staffId !== undefined && projection.staff.length === 0)
    ) {
      throw availabilityNotFound();
    }
    if (projection.policy === null) {
      process.stdout.write(
        `${JSON.stringify({
          severity: 'ERROR',
          service: 'api',
          operation: 'availability.policy.load',
          outcome: 'failure',
          requestId: input.requestId,
          tenantId: projection.tenantId,
        })}\n`,
      );
      throw new ApplicationError(
        503,
        'availability_policy_unavailable',
        'Service Unavailable',
        'Availability is temporarily unavailable.',
      );
    }

    let today: string;
    try {
      today = instantToLocalDate(now, projection.timezone);
    } catch {
      throw new ApplicationError(
        503,
        'availability_timezone_unavailable',
        'Service Unavailable',
        'Availability is temporarily unavailable.',
      );
    }
    validateDateWindow(
      input.query.date,
      input.query.days,
      today,
      projection.policy.maximumAdvanceDays,
    );
    const earliestStartAt = new Date(now.getTime() + projection.policy.minimumLeadMinutes * 60_000);
    const slots = calculateAvailability({
      timeZone: projection.timezone,
      date: input.query.date,
      days: input.query.days,
      slotIntervalMinutes: projection.policy.slotIntervalMinutes,
      earliestStartAt,
      serviceDurationMinutes: projection.service.durationMinutes,
      bufferBeforeMinutes: projection.service.bufferBeforeMinutes,
      bufferAfterMinutes: projection.service.bufferAfterMinutes,
      staff: projection.staff.map((staff) => ({
        id: staff.id,
        displayName: staff.displayName,
        durationMinutes: staff.customDurationMinutes,
        weeklyRules: staff.weeklyRules,
        exceptions: staff.exceptions.map((exception) => ({
          kind: exception.type,
          startAt: exception.startAt,
          endAt: exception.endAt,
        })),
        occupancy: staff.occupancy,
      })),
    });

    return {
      timezone: projection.timezone,
      generatedAt: now.toISOString(),
      reservation: false,
      service: {
        id: projection.service.id,
        name: projection.service.name,
        durationMinutes: projection.service.durationMinutes,
      },
      staff: projection.staff.map(({ id, displayName }) => ({ id, displayName })),
      slots: slots.map(({ startAt, endAt, eligibleStaffIds }) => ({
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        eligibleStaffIds,
      })),
    };
  }
}

function availabilityNotFound(): ApplicationError {
  return new ApplicationError(
    404,
    'availability_not_found',
    'Not Found',
    'Availability was not found.',
  );
}

function broadUtcRange(
  date: string,
  days: number,
): { readonly rangeStart: Date; readonly rangeEnd: Date } {
  const start = dateOrdinal(date);
  return {
    rangeStart: new Date(start - 18 * 60 * 60 * 1000),
    rangeEnd: new Date(start + (days * 24 + 18) * 60 * 60 * 1000),
  };
}

function validateDateWindow(
  date: string,
  days: number,
  today: string,
  maximumAdvanceDays: number,
): void {
  const start = dateOrdinal(date);
  const todayValue = dateOrdinal(today);
  const lastDate = start + (days - 1) * 86_400_000;
  if (start < todayValue || lastDate > todayValue + maximumAdvanceDays * 86_400_000) {
    throw new ApplicationError(
      400,
      'availability_date_out_of_range',
      'Bad Request',
      'The requested date is outside the booking window.',
    );
  }
}

function dateOrdinal(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined)
    throw new Error('invalid local date');
  return Date.UTC(year, month - 1, day);
}
