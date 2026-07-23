const minuteMs = 60_000;

interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export function calendarWeekWindow(
  now: Date,
  timeZone: string,
  weekOffset: number,
): {
  readonly from: string;
  readonly to: string;
  readonly localFrom: string;
  readonly localTo: string;
} {
  const today = instantToLocalDate(now, timeZone);
  const localFrom = addLocalDays(today, weekOffset * 7);
  const localTo = addLocalDays(localFrom, 7);
  const from = localDateTimeToInstant(localFrom, '00:00', timeZone);
  const to = localDateTimeToInstant(localTo, '00:00', timeZone);
  if (from === null || to === null) throw new Error('calendar_timezone_unavailable');
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), localFrom, localTo };
}

export function formatAppointmentDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

export function formatAppointmentTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

export function appointmentLocalDate(value: string, timeZone: string): string {
  return instantToLocalDate(new Date(value), timeZone);
}

function localDateTimeToInstant(date: string, time: string, timeZone: string): number | null {
  const target = parseLocalDateTime(date, time);
  const naive = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  const offsets = new Set<number>();
  for (let hourOffset = -48; hourOffset <= 48; hourOffset += 6) {
    offsets.add(timeZoneOffsetMinutes(naive + hourOffset * 60 * minuteMs, timeZone));
  }
  return (
    [...offsets]
      .map((offset) => naive - offset * minuteMs)
      .filter((candidate) => sameLocalParts(localParts(candidate, timeZone), target))
      .sort((left, right) => left - right)[0] ?? null
  );
}

function instantToLocalDate(instant: Date, timeZone: string): string {
  const parts = localParts(instant.getTime(), timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function addLocalDays(date: string, days: number): string {
  const parts = parseLocalDateTime(date, '00:00');
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

function localParts(instant: number, timeZone: string): LocalParts {
  const values = new Map(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(instant))
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]),
  );
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  const hour = values.get('hour');
  const minute = values.get('minute');
  if ([year, month, day, hour, minute].some((value) => value === undefined)) {
    throw new Error('calendar_timezone_unavailable');
  }
  return { year: year!, month: month!, day: day!, hour: hour!, minute: minute! };
}

function timeZoneOffsetMinutes(instant: number, timeZone: string): number {
  const parts = localParts(instant, timeZone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return Math.round((localAsUtc - Math.floor(instant / minuteMs) * minuteMs) / minuteMs);
}

function parseLocalDateTime(date: string, time: string): LocalParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (match === null || timeMatch === null) throw new Error('invalid_calendar_date');
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
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
    throw new Error('invalid_calendar_date');
  }
  return parts;
}

function sameLocalParts(left: LocalParts, right: LocalParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
