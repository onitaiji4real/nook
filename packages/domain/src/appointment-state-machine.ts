export const appointmentStatuses = [
  'CONFIRMED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
] as const;

export type AppointmentStatus = (typeof appointmentStatuses)[number];

export interface InitialConfirmedAppointment {
  readonly status: 'CONFIRMED';
  readonly paymentStatus: 'NOT_REQUIRED';
  readonly depositAmount: 0;
  readonly history: {
    readonly fromStatus: null;
    readonly toStatus: 'CONFIRMED';
  };
}

const allowedTransitions: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'],
  CHECKED_IN: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  RESCHEDULED: [],
};

export class AppointmentTransitionError extends Error {
  constructor(
    readonly fromStatus: AppointmentStatus,
    readonly toStatus: AppointmentStatus,
  ) {
    super(`appointment transition ${fromStatus} -> ${toStatus} is not allowed`);
    this.name = 'AppointmentTransitionError';
  }
}

export function createNoDepositConfirmedAppointment(): InitialConfirmedAppointment {
  return {
    status: 'CONFIRMED',
    paymentStatus: 'NOT_REQUIRED',
    depositAmount: 0,
    history: { fromStatus: null, toStatus: 'CONFIRMED' },
  };
}

export function assertAppointmentTransition(
  fromStatus: AppointmentStatus,
  toStatus: AppointmentStatus,
): void {
  if (!allowedTransitions[fromStatus].includes(toStatus)) {
    throw new AppointmentTransitionError(fromStatus, toStatus);
  }
}

export function canTransitionAppointment(
  fromStatus: AppointmentStatus,
  toStatus: AppointmentStatus,
): boolean {
  return allowedTransitions[fromStatus].includes(toStatus);
}
