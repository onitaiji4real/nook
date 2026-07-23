import type {
  AppointmentViewRecord,
  AppointmentViewRepository,
  TenantRepository,
} from '@nook/database';
import type { RuntimeConfig } from '@nook/config';
import { describe, expect, it, vi } from 'vitest';

import { AppointmentViewApplicationService } from '../src/modules/marketplace/appointment-view-application.service';

const tenantId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const staffId = '30000000-0000-4000-8000-000000000001';

describe('AppointmentViewApplicationService', () => {
  it('returns a strict consumer summary and owner-only detail', async () => {
    const record = appointmentRecord();
    const repository = appointmentRepository({
      listForConsumer: vi.fn<AppointmentViewRepository['listForConsumer']>().mockResolvedValue({
        asOf: new Date('2026-07-22T00:00:00.000Z'),
        items: [record],
        next: { startAt: record.startAt, id: record.id },
      }),
      findForConsumer: vi
        .fn<AppointmentViewRepository['findForConsumer']>()
        .mockResolvedValue(record),
    });
    const service = new AppointmentViewApplicationService(
      repository,
      tenantRepository('OWNER'),
      runtimeConfig(),
    );
    const list = await service.listConsumer({
      consumerUserId: userId,
      query: { view: 'upcoming', limit: 20 },
    });
    expect(list.items[0]).toMatchObject({
      id: record.id,
      staff: { displayName: 'Snapshot Yun' },
      location: { name: '主要工作室', city: '台北市', district: '大安區' },
    });
    expect(typeof list.nextCursor).toBe('string');
    expect(list.items[0]).not.toHaveProperty('source');
    expect(list.items[0]).not.toHaveProperty('consumer');
    expect(list.items[0]?.location).not.toHaveProperty('addressText');

    const detail = await service.getConsumer({
      consumerUserId: userId,
      appointmentId: record.id,
    });
    expect(detail).toMatchObject({
      location: { addressText: '台北市測試路 1 號' },
      policies: { bookingPolicy: '完全預約制' },
      history: [{ fromStatus: null, toStatus: 'CONFIRMED' }],
    });
    expect(detail).not.toHaveProperty('source');
  });

  it('lets managers read merchant summaries but never includes address or policy', async () => {
    const record = appointmentRecord();
    const repository = appointmentRepository({
      listForTenant: vi.fn<AppointmentViewRepository['listForTenant']>().mockResolvedValue({
        asOf: new Date('2026-07-22T00:00:00.000Z'),
        calendarTimezone: 'Asia/Taipei',
        items: [record],
        next: null,
      }),
    });
    const service = new AppointmentViewApplicationService(
      repository,
      tenantRepository('MANAGER'),
      runtimeConfig(),
    );
    const response = await service.listMerchant({
      tenantId,
      userId,
      requestId: 'request-1',
      query: {
        from: '2026-07-20T00:00:00.000Z',
        to: '2026-07-27T00:00:00.000Z',
        limit: 100,
      },
    });
    expect(response).toMatchObject({
      calendarTimezone: 'Asia/Taipei',
      items: [{ source: 'MERCHANT_LINK', consumer: { displayName: '顧客A' } }],
    });
    expect(response.items[0]?.location).not.toHaveProperty('addressText');
    expect(response.items[0]).not.toHaveProperty('policies');
  });

  it('derives STAFF scope server-side and rejects another staff filter', async () => {
    const listForTenant = vi.fn();
    const repository = appointmentRepository({
      resolveActiveStaffId: vi
        .fn<AppointmentViewRepository['resolveActiveStaffId']>()
        .mockResolvedValue(staffId),
      listForTenant,
    });
    const service = new AppointmentViewApplicationService(
      repository,
      tenantRepository('STAFF'),
      runtimeConfig(),
    );
    await expect(
      service.listMerchant({
        tenantId,
        userId,
        requestId: 'request-2',
        query: {
          from: '2026-07-20T00:00:00.000Z',
          to: '2026-07-27T00:00:00.000Z',
          staffId: '40000000-0000-4000-8000-000000000001',
          limit: 100,
        },
      }),
    ).rejects.toMatchObject({ status: 403, code: 'staff_calendar_access_denied' });
    expect(listForTenant).not.toHaveBeenCalled();
  });

  it('uses privacy-safe 404 for STAFF detail outside its scoped staff', async () => {
    const findForTenant = vi
      .fn<AppointmentViewRepository['findForTenant']>()
      .mockResolvedValue(null);
    const repository = appointmentRepository({
      resolveActiveStaffId: vi
        .fn<AppointmentViewRepository['resolveActiveStaffId']>()
        .mockResolvedValue(staffId),
      findForTenant,
    });
    const service = new AppointmentViewApplicationService(
      repository,
      tenantRepository('STAFF'),
      runtimeConfig(),
    );
    await expect(
      service.getMerchant({
        tenantId,
        userId,
        requestId: 'request-3',
        appointmentId: '50000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toMatchObject({ status: 404, code: 'appointment_not_found' });
    expect(findForTenant).toHaveBeenCalledWith({
      tenantId,
      appointmentId: '50000000-0000-4000-8000-000000000001',
      staffId,
    });
  });
});

function appointmentRepository(
  overrides: Partial<AppointmentViewRepository>,
): AppointmentViewRepository {
  return {
    resolveActiveStaffId: vi
      .fn<AppointmentViewRepository['resolveActiveStaffId']>()
      .mockResolvedValue(null),
    listForConsumer: vi.fn(),
    findForConsumer: vi.fn(),
    listForTenant: vi.fn(),
    findForTenant: vi.fn(),
    ...overrides,
  } as AppointmentViewRepository;
}

function tenantRepository(role: 'OWNER' | 'MANAGER' | 'STAFF' | 'VIEWER'): TenantRepository {
  return {
    createTenantWithOwner: vi.fn(),
    findActiveTenantMembership: vi
      .fn<TenantRepository['findActiveTenantMembership']>()
      .mockResolvedValue({
        tenant: { id: tenantId, name: 'Nook', slug: 'nook', status: 'ACTIVE' },
        membership: { role, status: 'ACTIVE' },
      }),
    listMembershipsForUser: vi.fn(),
    recordAuthorizationDeniedIfTenantExists: vi.fn(),
  } as TenantRepository;
}

function appointmentRecord(): AppointmentViewRecord {
  return {
    id: '50000000-0000-4000-8000-000000000001',
    status: 'CONFIRMED',
    source: 'MERCHANT_LINK',
    pricingStatus: 'EXACT',
    paymentStatus: 'NOT_REQUIRED',
    timezone: 'Asia/Taipei',
    startAt: new Date('2026-07-24T03:00:00.000Z'),
    endAt: new Date('2026-07-24T04:00:00.000Z'),
    confirmedAt: new Date('2026-07-22T00:00:00.000Z'),
    currency: 'TWD',
    subtotalAmount: 1200,
    depositAmount: 0,
    totalAmount: 1200,
    service: {
      id: '60000000-0000-4000-8000-000000000001',
      name: '凝膠服務',
      durationMinutes: 60,
      priceType: 'FIXED',
      priceAmount: 1200,
      priceMin: null,
      priceMax: null,
      currency: 'TWD',
    },
    staff: { id: staffId, displayName: 'Snapshot Yun' },
    location: {
      name: '主要工作室',
      addressText: '台北市測試路 1 號',
      postalCode: '106',
      city: '台北市',
      district: '大安區',
    },
    policies: {
      version: `v1:${'a'.repeat(64)}`,
      bookingPolicy: '完全預約制',
      cancellationPolicy: '提前24小時',
      acceptedAt: new Date('2026-07-22T00:00:00.000Z'),
      consumerCancelLeadMinutes: 1_440,
      consumerRescheduleLeadMinutes: 1_440,
      cancelUntil: new Date('2026-07-23T03:00:00.000Z'),
      rescheduleUntil: new Date('2026-07-23T03:00:00.000Z'),
      cancelUntilInclusive: true,
      rescheduleUntilInclusive: true,
    },
    evaluatedAt: new Date('2026-07-22T12:00:00.000Z'),
    rescheduleContext: {
      merchantSlug: 'nook',
      serviceId: '60000000-0000-4000-8000-000000000001',
      locationId: '70000000-0000-4000-8000-000000000001',
    },
    consumerDisplayName: '顧客A',
    history: [
      {
        fromStatus: null,
        toStatus: 'CONFIRMED',
        createdAt: new Date('2026-07-22T00:00:00.000Z'),
        reasonCode: null,
      },
    ],
  };
}

function runtimeConfig(): RuntimeConfig {
  return {
    nodeEnv: 'test',
    port: 8080,
    appVersion: 'test',
    apiCorsAllowedOrigins: [],
    appointmentConfirmationEnabled: true,
    bookingPolicyV2WritesEnabled: true,
    appointmentLifecycleEnabled: true,
    lineAuthRateLimit: {
      globalLimit: 120,
      tokenLimit: 5,
      windowSeconds: 60,
      bucketTtlSeconds: 600,
    },
    identity: { mode: 'disabled' },
    media: { mode: 'disabled' },
    notification: { mode: 'disabled' },
  };
}
