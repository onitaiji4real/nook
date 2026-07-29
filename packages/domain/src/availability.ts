export type AvailabilityExceptionKind = 'TIME_OFF' | 'EXTRA_HOURS' | 'BLOCK';

export interface AvailabilityWeeklyRule {
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly validFrom: string;
  readonly validUntil: string | null;
}

export interface AvailabilityExceptionInput {
  readonly kind: AvailabilityExceptionKind;
  readonly startAt: Date;
  readonly endAt: Date;
}

export interface AvailabilityOccupancyInput {
  readonly startAt: Date;
  readonly endAt: Date;
}

export interface AvailabilityStaffInput {
  readonly id: string;
  readonly displayName: string;
  readonly durationMinutes: number | null;
  readonly weeklyRules: readonly AvailabilityWeeklyRule[];
  readonly exceptions: readonly AvailabilityExceptionInput[];
  readonly occupancy: readonly AvailabilityOccupancyInput[];
}

export interface CalculateAvailabilityInput {
  readonly timeZone: string;
  readonly date: string;
  readonly days: number;
  readonly slotIntervalMinutes: number;
  readonly earliestStartAt: Date;
  readonly serviceDurationMinutes: number;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly staff: readonly AvailabilityStaffInput[];
}

export interface AvailabilityCandidateSlot {
  readonly startAt: Date;
  readonly endAt: Date;
  readonly eligibleStaffIds: readonly string[];
}

interface TimeRange {
  readonly start: number;
  readonly end: number;
}

interface LocalDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

const minuteMs = 60_000;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function calculateAvailability(
  input: CalculateAvailabilityInput,
): readonly AvailabilityCandidateSlot[] {
  assertCalculatorInput(input);
  const queryEndDate = addLocalDays(input.date, input.days);
  const queryStart = localDateTimeToInstant(input.date, '00:00', input.timeZone);
  const queryEnd = localDateTimeToInstant(queryEndDate, '00:00', input.timeZone);
  if (queryStart === null || queryEnd === null) throw new Error('invalid timezone date boundary');

  const aggregated = new Map<
    string,
    { readonly startAt: Date; readonly endAt: Date; readonly staffIds: Set<string> }
  >();

  for (const staff of input.staff) {
    const openRanges = buildOpenRanges(staff, input, queryStart, queryEnd);
    const durationMinutes = staff.durationMinutes ?? input.serviceDurationMinutes;
    for (let dayOffset = 0; dayOffset < input.days; dayOffset += 1) {
      const localDate = addLocalDays(input.date, dayOffset);
      for (let minute = 0; minute < 24 * 60; minute += input.slotIntervalMinutes) {
        const start = localDateTimeToInstant(localDate, minuteToTime(minute), input.timeZone);
        if (start === null || start < input.earliestStartAt.getTime()) continue;
        const end = start + durationMinutes * minuteMs;
        const occupiedStart = start - input.bufferBeforeMinutes * minuteMs;
        const occupiedEnd = end + input.bufferAfterMinutes * minuteMs;
        if (!openRanges.some((range) => contains(range, occupiedStart, occupiedEnd))) continue;
        if (staff.occupancy.some((range) => overlaps(range, occupiedStart, occupiedEnd))) continue;

        const key = `${start}:${end}`;
        const existing = aggregated.get(key);
        if (existing === undefined) {
          aggregated.set(key, {
            startAt: new Date(start),
            endAt: new Date(end),
            staffIds: new Set([staff.id]),
          });
        } else {
          existing.staffIds.add(staff.id);
        }
      }
    }
  }

  return [...aggregated.values()]
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime())
    .map(({ startAt, endAt, staffIds }) => ({
      startAt,
      endAt,
      eligibleStaffIds: [...staffIds].sort(),
    }));
}

export function localDateTimeToInstant(
  date: string,
  time: string,
  timeZone: string,
): number | null {
  const target = parseLocalDateTime(date, time);
  const naive = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  const offsets = new Set<number>();
  for (let hourOffset = -48; hourOffset <= 48; hourOffset += 6) {
    offsets.add(timeZoneOffsetMinutes(naive + hourOffset * 60 * minuteMs, timeZone));
  }
  const candidates = [...offsets]
    .map((offset) => naive - offset * minuteMs)
    .filter((candidate) => sameLocalParts(localParts(candidate, timeZone), target))
    .sort((left, right) => left - right);
  return candidates[0] ?? null;
}

export function instantToLocalDate(instant: Date, timeZone: string): string {
  const parts = localParts(instant.getTime(), timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function buildOpenRanges(
  staff: AvailabilityStaffInput,
  input: CalculateAvailabilityInput,
  queryStart: number,
  queryEnd: number,
): readonly TimeRange[] {
  const weekly: TimeRange[] = [];
  for (let dayOffset = 0; dayOffset < input.days; dayOffset += 1) {
    const localDate = addLocalDays(input.date, dayOffset);
    const weekday = weekdayOf(localDate);
    for (const rule of staff.weeklyRules) {
      if (
        rule.weekday !== weekday ||
        localDate < rule.validFrom ||
        (rule.validUntil !== null && localDate > rule.validUntil)
      ) {
        continue;
      }
      const start = localDateTimeToInstant(localDate, rule.startTime, input.timeZone);
      const endDate = rule.endTime <= rule.startTime ? addLocalDays(localDate, 1) : localDate;
      const end = localDateTimeToInstant(endDate, rule.endTime, input.timeZone);
      if (start !== null && end !== null && start < end) weekly.push({ start, end });
    }
  }

  const extra = staff.exceptions
    .filter(({ kind }) => kind === 'EXTRA_HOURS')
    .map(toRange)
    .map((range) => clip(range, queryStart, queryEnd))
    .filter((range): range is TimeRange => range !== null);
  const closed = staff.exceptions
    .filter(({ kind }) => kind === 'TIME_OFF' || kind === 'BLOCK')
    .map(toRange)
    .map((range) => clip(range, queryStart, queryEnd))
    .filter((range): range is TimeRange => range !== null);

  return subtractRanges(mergeRanges([...weekly, ...extra]), mergeRanges(closed));
}

function mergeRanges(ranges: readonly TimeRange[]): readonly TimeRange[] {
  const sorted = [...ranges]
    .filter(({ start, end }) => start < end)
    .sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous === undefined || range.start > previous.end) {
      merged.push(range);
    } else {
      merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, range.end) };
    }
  }
  return merged;
}

function subtractRanges(
  sources: readonly TimeRange[],
  exclusions: readonly TimeRange[],
): readonly TimeRange[] {
  let result = [...sources];
  for (const exclusion of exclusions) {
    result = result.flatMap((source) => {
      if (exclusion.end <= source.start || exclusion.start >= source.end) return [source];
      const parts: TimeRange[] = [];
      if (exclusion.start > source.start) parts.push({ start: source.start, end: exclusion.start });
      if (exclusion.end < source.end) parts.push({ start: exclusion.end, end: source.end });
      return parts;
    });
  }
  return result;
}

function overlaps(range: AvailabilityOccupancyInput, start: number, end: number): boolean {
  return range.startAt.getTime() < end && range.endAt.getTime() > start;
}

function contains(range: TimeRange, start: number, end: number): boolean {
  return range.start <= start && end <= range.end;
}

function toRange(input: AvailabilityExceptionInput): TimeRange {
  return { start: input.startAt.getTime(), end: input.endAt.getTime() };
}

function clip(range: TimeRange, start: number, end: number): TimeRange | null {
  const clipped = { start: Math.max(range.start, start), end: Math.min(range.end, end) };
  return clipped.start < clipped.end ? clipped : null;
}

function localParts(instant: number, timeZone: string): LocalDateTimeParts {
  let formatter = formatterCache.get(timeZone);
  formatter ??= new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timeZone, formatter);
  const values = new Map(
    formatter
      .formatToParts(new Date(instant))
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]),
  );
  return {
    year: values.get('year')!,
    month: values.get('month')!,
    day: values.get('day')!,
    hour: values.get('hour')!,
    minute: values.get('minute')!,
  };
}

function timeZoneOffsetMinutes(instant: number, timeZone: string): number {
  const parts = localParts(instant, timeZone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return Math.round((localAsUtc - Math.floor(instant / minuteMs) * minuteMs) / minuteMs);
}

function sameLocalParts(left: LocalDateTimeParts, right: LocalDateTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function parseLocalDateTime(date: string, time: string): LocalDateTimeParts {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (dateMatch === null || timeMatch === null) throw new Error('invalid local date or time');
  const parts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
  const normalized = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute),
  );
  if (
    normalized.getUTCFullYear() !== parts.year ||
    normalized.getUTCMonth() + 1 !== parts.month ||
    normalized.getUTCDate() !== parts.day ||
    parts.hour > 23 ||
    parts.minute > 59
  ) {
    throw new Error('invalid local date or time');
  }
  return parts;
}

function addLocalDays(date: string, days: number): string {
  const parts = parseLocalDateTime(date, '00:00');
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

function weekdayOf(date: string): number {
  const parts = parseLocalDateTime(date, '00:00');
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() || 7;
}

function minuteToTime(value: number): string {
  return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function assertCalculatorInput(input: CalculateAvailabilityInput): void {
  parseLocalDateTime(input.date, '00:00');
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 7)
    throw new Error('days must be between 1 and 7');
  if (![5, 10, 15, 20, 30, 60].includes(input.slotIntervalMinutes))
    throw new Error('invalid slot interval');
  if (
    !Number.isInteger(input.serviceDurationMinutes) ||
    input.serviceDurationMinutes < 5 ||
    input.bufferBeforeMinutes < 0 ||
    input.bufferAfterMinutes < 0
  ) {
    throw new Error('invalid duration or buffer');
  }
  new Intl.DateTimeFormat('en', { timeZone: input.timeZone }).format(input.earliestStartAt);
}
