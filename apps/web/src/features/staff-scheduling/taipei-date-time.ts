const taipeiOffsetMilliseconds = 8 * 60 * 60 * 1000;

export function taipeiLocalEpochMillis(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return Number.NaN;
  const [, year = '', month = '', day = '', hour = '', minute = ''] = match;
  return (
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)) -
    taipeiOffsetMilliseconds
  );
}

export function taipeiLocalToUtcIso(value: string): string {
  const milliseconds = taipeiLocalEpochMillis(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error('例外時段格式無效，請重新選擇時間。');
  }
  return new Date(milliseconds).toISOString();
}

export function utcIsoToTaipeiLocal(value: string): string {
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) return value;
  const taipei = new Date(milliseconds + taipeiOffsetMilliseconds);
  return `${taipei.getUTCFullYear()}-${String(taipei.getUTCMonth() + 1).padStart(2, '0')}-${String(
    taipei.getUTCDate(),
  ).padStart(2, '0')}T${String(taipei.getUTCHours()).padStart(2, '0')}:${String(
    taipei.getUTCMinutes(),
  ).padStart(2, '0')}`;
}

export function currentTaipeiDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
