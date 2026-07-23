import { canTransitionAppointment, type AppointmentStatus } from './appointment-state-machine';

const minuteMilliseconds = 60_000;

export function isConsumerLifecycleBeforeDeadline(input: {
  readonly status: AppointmentStatus;
  readonly targetStatus: 'CANCELLED' | 'RESCHEDULED';
  readonly now: Date;
  readonly startAt: Date;
  readonly leadMinutes: number;
}): boolean {
  if (!canTransitionAppointment(input.status, input.targetStatus)) return false;
  if (input.leadMinutes === 0) return input.now < input.startAt;
  return input.now.getTime() <= input.startAt.getTime() - input.leadMinutes * minuteMilliseconds;
}

export function isMerchantLifecycleActionAvailable(input: {
  readonly status: AppointmentStatus;
  readonly targetStatus: 'CANCELLED' | 'CHECKED_IN' | 'COMPLETED' | 'NO_SHOW';
  readonly now: Date;
  readonly startAt: Date;
  readonly endAt: Date;
}): boolean {
  if (!canTransitionAppointment(input.status, input.targetStatus)) return false;
  switch (input.targetStatus) {
    case 'CANCELLED':
      return true;
    case 'CHECKED_IN':
      return input.now.getTime() >= input.startAt.getTime() - 120 * minuteMilliseconds;
    case 'COMPLETED':
      return input.now >= input.startAt;
    case 'NO_SHOW':
      return input.now >= input.endAt;
  }
}
