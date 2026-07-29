import { describe, expect, it } from 'vitest';

import { renderLineNotificationTemplate } from '../src';

const baseInput = {
  tenantName: '暖光美甲',
  serviceName: '單色凝膠',
  startAt: new Date('2026-07-23T02:00:00.000Z'),
  timezone: 'Asia/Taipei',
  locationName: '大安工作室',
  publicWebBaseUrl: 'https://nook.example',
} as const;

describe('LINE notification templates', () => {
  it.each([
    ['appointment.confirmed.v1', '預約已成立'],
    ['appointment.cancelled.v1', '預約已取消'],
    ['appointment.rescheduled.v1', '預約已改期'],
    ['appointment.reminder.24h.v1', '預約提醒（24 小時前）'],
    ['appointment.reminder.2h.v1', '預約提醒（2 小時前）'],
  ] as const)('renders the exact %s contract', (templateKey, heading) => {
    expect(renderLineNotificationTemplate({ ...baseInput, templateKey })).toEqual({
      ok: true,
      appointmentUrl: 'https://nook.example/appointments',
      text: `${heading}\n暖光美甲\n服務：單色凝膠\n時間：2026/07/23（週四）10:00\n據點：大安工作室\n查看預約：https://nook.example/appointments`,
    });
  });

  it('trims safe fields and supports localhost only when explicitly allowed', () => {
    expect(
      renderLineNotificationTemplate({
        ...baseInput,
        templateKey: 'appointment.confirmed.v1',
        tenantName: '  暖光美甲  ',
        publicWebBaseUrl: 'http://localhost:3000',
        allowLocalHttp: true,
      }),
    ).toMatchObject({ ok: true, appointmentUrl: 'http://localhost:3000/appointments' });
  });

  it.each([
    { tenantName: '暖光\n美甲' },
    { timezone: 'Not/A-Timezone' },
    { publicWebBaseUrl: 'http://nook.example' },
    { publicWebBaseUrl: 'https://nook.example/path' },
    { locationName: ' ' },
  ])('fails closed for unsafe template data %#', (override) => {
    expect(
      renderLineNotificationTemplate({
        ...baseInput,
        templateKey: 'appointment.confirmed.v1',
        ...override,
      }),
    ).toEqual({ ok: false, code: 'template_data_invalid' });
  });
});
