export type EntityId = string;

export {
  appointmentStatuses,
  AppointmentTransitionError,
  assertAppointmentTransition,
  canTransitionAppointment,
  createNoDepositConfirmedAppointment,
  type AppointmentStatus,
  type InitialConfirmedAppointment,
} from './appointment-state-machine';

export {
  isConsumerLifecycleBeforeDeadline,
  isMerchantLifecycleActionAvailable,
} from './appointment-lifecycle';

export interface DomainEvent<TPayload extends object = Record<string, never>> {
  readonly name: string;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}

export {
  calculateAvailability,
  instantToLocalDate,
  localDateTimeToInstant,
  type AvailabilityCandidateSlot,
  type AvailabilityExceptionInput,
  type AvailabilityExceptionKind,
  type AvailabilityOccupancyInput,
  type AvailabilityStaffInput,
  type AvailabilityWeeklyRule,
  type CalculateAvailabilityInput,
} from './availability';
