import { describe, expect, it, vi } from 'vitest';

import { runCustomerProjectionRepairCommand } from '../src/consumer-crm/customer-projection-repair-command';

const tenantId = '10000000-0000-4000-8000-000000000001';
const consumerUserId = '10000000-0000-4000-8000-000000000002';
const deliveryId = '10000000-0000-4000-8000-000000000003';

describe('runCustomerProjectionRepairCommand', () => {
  it('requires the exact blocked delivery confirmation before repair', async () => {
    const repository = dependencies();
    await expect(
      runCustomerProjectionRepairCommand(repository, [
        'repair-stream',
        '--tenant-id',
        tenantId,
        '--consumer-user-id',
        consumerUserId,
        '--blocked-delivery-id',
        deliveryId,
        '--confirm-delivery-id',
        '10000000-0000-4000-8000-000000000004',
      ]),
    ).rejects.toThrowError('delivery_confirmation_mismatch');
    expect(repository.repairBlockedStream).not.toHaveBeenCalled();
  });

  it('repairs only the fully specified tenant consumer and blocked delivery', async () => {
    const repository = dependencies();
    repository.repairBlockedStream.mockResolvedValue({
      kind: 'repaired',
      deliveryId,
    });
    await expect(
      runCustomerProjectionRepairCommand(repository, [
        'repair-stream',
        '--tenant-id',
        tenantId,
        '--consumer-user-id',
        consumerUserId,
        '--blocked-delivery-id',
        deliveryId,
        '--confirm-delivery-id',
        deliveryId,
      ]),
    ).resolves.toEqual({
      action: 'repair-stream',
      outcome: { kind: 'repaired', deliveryId },
    });
  });

  it('requires an expected cursor and explicit confirmation before resuming backfill', async () => {
    const repository = dependencies();
    await expect(
      runCustomerProjectionRepairCommand(repository, [
        'resume-backfill',
        '--expected-cursor-id',
        'none',
      ]),
    ).rejects.toThrowError('backfill_confirmation_missing');
    await expect(
      runCustomerProjectionRepairCommand(repository, [
        'resume-backfill',
        '--expected-cursor-id',
        'none',
        '--confirm',
        'resume-backfill',
      ]),
    ).resolves.toEqual({ action: 'resume-backfill', resumed: true });
    expect(repository.resumeBackfill).toHaveBeenCalledWith(null);
  });

  it('retries only the exact confirmed exhausted delivery', async () => {
    const repository = dependencies();
    await expect(
      runCustomerProjectionRepairCommand(repository, [
        'retry-delivery',
        '--tenant-id',
        tenantId,
        '--consumer-user-id',
        consumerUserId,
        '--delivery-id',
        deliveryId,
        '--confirm-delivery-id',
        deliveryId,
      ]),
    ).resolves.toEqual({ action: 'retry-delivery', retried: true });
    expect(repository.retryExhaustedDelivery).toHaveBeenCalledWith({
      tenantId,
      consumerUserId,
      deliveryId,
    });
  });

  it('rejects malformed UUIDs and duplicate options', async () => {
    const repository = dependencies();
    await expect(
      runCustomerProjectionRepairCommand(repository, [
        'repair-stream',
        '--tenant-id',
        'not-a-uuid',
        '--consumer-user-id',
        consumerUserId,
        '--blocked-delivery-id',
        deliveryId,
        '--confirm-delivery-id',
        deliveryId,
      ]),
    ).rejects.toThrowError('uuid_invalid');
    await expect(
      runCustomerProjectionRepairCommand(repository, [
        'resume-backfill',
        '--expected-cursor-id',
        'none',
        '--expected-cursor-id',
        'none',
        '--confirm',
        'resume-backfill',
      ]),
    ).rejects.toThrowError('option_duplicate');
  });
});

function dependencies() {
  return {
    repairBlockedStream: vi.fn().mockResolvedValue({ kind: 'not_blocked' }),
    retryExhaustedDelivery: vi.fn().mockResolvedValue(true),
    resumeBackfill: vi.fn().mockResolvedValue(true),
  };
}
