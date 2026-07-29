export interface CustomerProjectionAppointment {
  readonly id: string;
  readonly tenantId: string;
  readonly consumerUserId: string;
  readonly status: string;
  readonly startAt: Date;
  readonly confirmedAt: Date;
  readonly rescheduledFromId: string | null;
  readonly rescheduleRootId: string | null;
}

export interface CustomerProjectionAggregate {
  readonly relationshipStartedAt: Date;
  readonly firstVisitAt: Date | null;
  readonly lastVisitAt: Date | null;
  readonly completedVisitCount: number;
  readonly noShowCount: number;
}

export class CustomerProjectionCorruption extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function deriveCustomerProjection(
  appointments: readonly CustomerProjectionAppointment[],
  triggerAppointmentId: string,
): CustomerProjectionAggregate {
  if (appointments.length === 0 || !appointments.some(({ id }) => id === triggerAppointmentId)) {
    corrupt('appointment_missing_or_cross_tenant');
  }

  const byId = new Map(appointments.map((appointment) => [appointment.id, appointment]));
  const childByParent = new Map<string, CustomerProjectionAppointment>();
  for (const appointment of appointments) {
    if (appointment.rescheduledFromId === null) {
      if (appointment.rescheduleRootId !== null) corrupt('reschedule_root_without_parent');
      continue;
    }
    const parent = byId.get(appointment.rescheduledFromId);
    if (parent === undefined) corrupt('reschedule_parent_missing');
    if (childByParent.has(parent.id)) corrupt('multiple_effective_leaves');
    childByParent.set(parent.id, appointment);
    if (
      parent.status !== 'RESCHEDULED' ||
      appointment.rescheduleRootId !== (parent.rescheduleRootId ?? parent.id)
    ) {
      corrupt('reschedule_chain_invalid');
    }
  }

  for (const appointment of appointments) {
    const visited = new Set<string>();
    let current: CustomerProjectionAppointment | undefined = appointment;
    while (current.rescheduledFromId !== null) {
      if (visited.has(current.id)) corrupt('reschedule_chain_cycle');
      visited.add(current.id);
      current = byId.get(current.rescheduledFromId);
      if (current === undefined) corrupt('reschedule_parent_missing');
    }
  }

  const leaves = appointments.filter(({ id }) => !childByParent.has(id));
  const completed = leaves.filter(({ status }) => status === 'COMPLETED');
  const completedTimes = completed.map(({ startAt }) => startAt.getTime());
  return {
    relationshipStartedAt: new Date(
      Math.min(...appointments.map(({ confirmedAt }) => confirmedAt.getTime())),
    ),
    firstVisitAt: completedTimes.length === 0 ? null : new Date(Math.min(...completedTimes)),
    lastVisitAt: completedTimes.length === 0 ? null : new Date(Math.max(...completedTimes)),
    completedVisitCount: completed.length,
    noShowCount: leaves.filter(({ status }) => status === 'NO_SHOW').length,
  };
}

function corrupt(code: string): never {
  throw new CustomerProjectionCorruption(code);
}
