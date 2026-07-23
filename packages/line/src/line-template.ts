export const lineNotificationTemplateKeys = [
  'appointment.confirmed.v1',
  'appointment.cancelled.v1',
  'appointment.rescheduled.v1',
  'appointment.reminder.24h.v1',
  'appointment.reminder.2h.v1',
] as const;

export type LineNotificationTemplateKey = (typeof lineNotificationTemplateKeys)[number];

export interface LineNotificationTemplateInput {
  readonly templateKey: LineNotificationTemplateKey;
  readonly tenantName: string;
  readonly serviceName: string;
  readonly startAt: Date;
  readonly timezone: string;
  readonly locationName: string;
  readonly publicWebBaseUrl: string;
  readonly allowLocalHttp?: boolean;
}

export type LineNotificationTemplateResult =
  | { readonly ok: true; readonly text: string; readonly appointmentUrl: string }
  | { readonly ok: false; readonly code: 'template_data_invalid' };

const headings: Readonly<Record<LineNotificationTemplateKey, string>> = {
  'appointment.confirmed.v1': '預約已成立',
  'appointment.cancelled.v1': '預約已取消',
  'appointment.rescheduled.v1': '預約已改期',
  'appointment.reminder.24h.v1': '預約提醒（24 小時前）',
  'appointment.reminder.2h.v1': '預約提醒（2 小時前）',
};

const weekdayNames: Readonly<Record<string, string>> = {
  Sun: '日',
  Mon: '一',
  Tue: '二',
  Wed: '三',
  Thu: '四',
  Fri: '五',
  Sat: '六',
};

export function renderLineNotificationTemplate(
  input: LineNotificationTemplateInput,
): LineNotificationTemplateResult {
  const tenantName = safeField(input.tenantName);
  const serviceName = safeField(input.serviceName);
  const locationName = safeField(input.locationName);
  const appointmentUrl = appointmentLink(input.publicWebBaseUrl, input.allowLocalHttp === true);
  const localizedStartAt = formatAppointmentTime(input.startAt, input.timezone);
  if (
    tenantName === null ||
    serviceName === null ||
    locationName === null ||
    appointmentUrl === null ||
    localizedStartAt === null
  ) {
    return { ok: false, code: 'template_data_invalid' };
  }

  const text = [
    headings[input.templateKey],
    tenantName,
    `服務：${serviceName}`,
    `時間：${localizedStartAt}`,
    `據點：${locationName}`,
    `查看預約：${appointmentUrl}`,
  ].join('\n');
  if ([...text].length > 1_000) return { ok: false, code: 'template_data_invalid' };
  return { ok: true, text, appointmentUrl };
}

function safeField(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 && !hasControlCharacter(trimmed) ? trimmed : null;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159));
  });
}

function appointmentLink(baseUrl: string, allowLocalHttp: boolean): string | null {
  try {
    const url = new URL(baseUrl);
    const isLocalHttp =
      allowLocalHttp &&
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (
      (url.protocol !== 'https:' && !isLocalHttp) ||
      (url.pathname !== '' && url.pathname !== '/') ||
      url.search !== '' ||
      url.hash !== '' ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return null;
    }
    return `${url.origin}/appointments`;
  } catch {
    return null;
  }
}

function formatAppointmentTime(value: Date, timezone: string): string | null {
  if (!Number.isFinite(value.getTime())) return null;
  try {
    const dateParts = parts(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(value),
    );
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    }).format(value);
    const weekdayName = weekdayNames[weekday];
    if (
      dateParts.year === undefined ||
      dateParts.month === undefined ||
      dateParts.day === undefined ||
      dateParts.hour === undefined ||
      dateParts.minute === undefined ||
      weekdayName === undefined
    ) {
      return null;
    }
    return `${dateParts.year}/${dateParts.month}/${dateParts.day}（週${weekdayName}）${dateParts.hour}:${dateParts.minute}`;
  } catch {
    return null;
  }
}

function parts(values: readonly Intl.DateTimeFormatPart[]): Partial<Record<string, string>> {
  return Object.fromEntries(
    values.filter((part) => ['year', 'month', 'day', 'hour', 'minute'].includes(part.type)).map(
      (part) => [part.type, part.value],
    ),
  );
}
