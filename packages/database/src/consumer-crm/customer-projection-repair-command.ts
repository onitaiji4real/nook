import type { RepairCustomerProjectionOutcome } from './customer-projection-operations';
import type { CustomerProjectionRepository } from './customer-projection-repository';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type CustomerProjectionRepairCommandResult =
  | {
      readonly action: 'repair-stream';
      readonly outcome: RepairCustomerProjectionOutcome;
    }
  | {
      readonly action: 'resume-backfill';
      readonly resumed: boolean;
    }
  | {
      readonly action: 'retry-delivery';
      readonly retried: boolean;
    };

export async function runCustomerProjectionRepairCommand(
  repository: Pick<
    CustomerProjectionRepository,
    'repairBlockedStream' | 'resumeBackfill' | 'retryExhaustedDelivery'
  >,
  arguments_: readonly string[],
): Promise<CustomerProjectionRepairCommandResult> {
  const [action] = arguments_;
  const options = parseOptions(arguments_.slice(1));
  if (action === 'repair-stream') {
    const tenantId = requiredUuid(options, 'tenant-id');
    const consumerUserId = requiredUuid(options, 'consumer-user-id');
    const blockedDeliveryId = requiredUuid(options, 'blocked-delivery-id');
    if (options.get('confirm-delivery-id') !== blockedDeliveryId) {
      throw new CustomerProjectionRepairCommandError('delivery_confirmation_mismatch');
    }
    return {
      action,
      outcome: await repository.repairBlockedStream({
        tenantId,
        consumerUserId,
        blockedDeliveryId,
      }),
    };
  }

  if (action === 'retry-delivery') {
    const tenantId = requiredUuid(options, 'tenant-id');
    const consumerUserId = requiredUuid(options, 'consumer-user-id');
    const deliveryId = requiredUuid(options, 'delivery-id');
    if (options.get('confirm-delivery-id') !== deliveryId) {
      throw new CustomerProjectionRepairCommandError('delivery_confirmation_mismatch');
    }
    return {
      action,
      retried: await repository.retryExhaustedDelivery({
        tenantId,
        consumerUserId,
        deliveryId,
      }),
    };
  }

  if (action === 'resume-backfill') {
    if (options.get('confirm') !== 'resume-backfill') {
      throw new CustomerProjectionRepairCommandError('backfill_confirmation_missing');
    }
    const rawCursor = requiredOption(options, 'expected-cursor-id');
    const expectedCursorId = rawCursor === 'none' ? null : validateUuid(rawCursor);
    return {
      action,
      resumed: await repository.resumeBackfill(expectedCursorId),
    };
  }

  throw new CustomerProjectionRepairCommandError('action_required');
}

function parseOptions(arguments_: readonly string[]): ReadonlyMap<string, string> {
  if (arguments_.length % 2 !== 0) {
    throw new CustomerProjectionRepairCommandError('option_value_missing');
  }
  const options = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (key === undefined || value === undefined || !key.startsWith('--')) {
      throw new CustomerProjectionRepairCommandError('option_invalid');
    }
    const normalizedKey = key.slice(2);
    if (options.has(normalizedKey)) {
      throw new CustomerProjectionRepairCommandError('option_duplicate');
    }
    options.set(normalizedKey, value);
  }
  return options;
}

function requiredUuid(options: ReadonlyMap<string, string>, name: string): string {
  return validateUuid(requiredOption(options, name));
}

function requiredOption(options: ReadonlyMap<string, string>, name: string): string {
  const value = options.get(name);
  if (value === undefined || value.length === 0) {
    throw new CustomerProjectionRepairCommandError('option_required');
  }
  return value;
}

function validateUuid(value: string): string {
  if (!uuidPattern.test(value)) {
    throw new CustomerProjectionRepairCommandError('uuid_invalid');
  }
  return value.toLowerCase();
}

export class CustomerProjectionRepairCommandError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CustomerProjectionRepairCommandError';
  }
}
