import { describe, expect, it } from 'vitest';

import {
  appointmentLocalDate,
  calendarWeekWindow,
  formatAppointmentTime,
} from '../src/features/appointment-views/calendar-time';

describe('appointment calendar time', () => {
  it('builds a seven-day Asia/Taipei window using local midnight', () => {
    expect(calendarWeekWindow(new Date('2026-07-22T04:00:00.000Z'), 'Asia/Taipei', 0)).toEqual({
      from: '2026-07-21T16:00:00.000Z',
      to: '2026-07-28T16:00:00.000Z',
      localFrom: '2026-07-22',
      localTo: '2026-07-29',
    });
  });

  it('keeps seven local dates across daylight-saving changes', () => {
    const window = calendarWeekWindow(new Date('2026-03-07T17:00:00.000Z'), 'America/New_York', 0);
    expect(window.localFrom).toBe('2026-03-07');
    expect(window.localTo).toBe('2026-03-14');
    expect((Date.parse(window.to) - Date.parse(window.from)) / 3_600_000).toBe(167);
  });

  it('formats and groups instants in the appointment timezone', () => {
    expect(appointmentLocalDate('2026-07-21T16:30:00.000Z', 'Asia/Taipei')).toBe('2026-07-22');
    expect(formatAppointmentTime('2026-07-21T16:30:00.000Z', 'Asia/Taipei')).toBe('00:30');
  });
});
