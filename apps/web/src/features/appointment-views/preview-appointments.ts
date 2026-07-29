import type {
  ConsumerAppointmentDetail,
  ConsumerAppointmentSummary,
  MerchantAppointmentDetail,
  MerchantAppointmentSummary,
} from '@nook/contracts';

const policyVersion = `v1:${'a'.repeat(64)}`;

const previewStaffIds: Readonly<Record<string, string>> = {
  Yun: '70000000-0000-4000-8000-000000000001',
  Mina: '70000000-0000-4000-8000-000000000002',
};

function base(
  id: string,
  startAt: string,
  status: ConsumerAppointmentSummary['status'],
  serviceName: string,
  staffName: string,
): ConsumerAppointmentSummary {
  return {
    id,
    status,
    pricingStatus: 'EXACT',
    paymentStatus: 'NOT_REQUIRED',
    timezone: 'Asia/Taipei',
    startAt,
    endAt: new Date(new Date(startAt).getTime() + 90 * 60_000).toISOString(),
    confirmedAt: '2026-07-22T02:10:00.000Z',
    currency: 'TWD',
    subtotalAmount: 1600,
    depositAmount: 0,
    totalAmount: 1600,
    service: {
      id: `60000000-0000-4000-8000-${id.slice(-12)}`,
      name: serviceName,
      durationMinutes: 90,
      priceType: 'FIXED',
      priceAmount: 1600,
      priceMin: null,
      priceMax: null,
      currency: 'TWD',
    },
    staff: {
      id: previewStaffIds[staffName] ?? `70000000-0000-4000-8000-${id.slice(-12)}`,
      displayName: staffName,
    },
    location: { name: '留白製甲所', city: '台北市', district: '大安區' },
  };
}

export const previewConsumerUpcoming: readonly ConsumerAppointmentSummary[] = [
  base(
    '50000000-0000-4000-8000-000000000001',
    '2026-07-24T05:30:00.000Z',
    'CONFIRMED',
    '透感暈染設計',
    'Yun',
  ),
  base(
    '50000000-0000-4000-8000-000000000002',
    '2026-07-29T02:00:00.000Z',
    'CONFIRMED',
    '手部單色凝膠',
    'Mina',
  ),
];

export const previewConsumerPast: readonly ConsumerAppointmentSummary[] = [
  base(
    '50000000-0000-4000-8000-000000000003',
    '2026-07-08T06:00:00.000Z',
    'COMPLETED',
    '法式線條設計',
    'Yun',
  ),
];

export function previewConsumerDetail(item: ConsumerAppointmentSummary): ConsumerAppointmentDetail {
  return {
    ...item,
    policies: {
      version: policyVersion,
      bookingPolicy: '採完全預約制，請依約定時間抵達。',
      cancellationPolicy: '如需取消，請於二十四小時前聯繫店家。',
      acceptedAt: '2026-07-22T02:10:00.000Z',
      consumerCancelLeadMinutes: 1_440,
      consumerRescheduleLeadMinutes: 1_440,
      cancelUntil: new Date(new Date(item.startAt).getTime() - 1_440 * 60_000).toISOString(),
      rescheduleUntil: new Date(new Date(item.startAt).getTime() - 1_440 * 60_000).toISOString(),
      cancelUntilInclusive: true,
      rescheduleUntilInclusive: true,
    },
    location: {
      ...item.location,
      addressText: '台北市大安區仁愛路四段 100 號 3 樓',
      postalCode: '106',
    },
    history: [
      {
        fromStatus: null,
        toStatus: 'CONFIRMED',
        createdAt: '2026-07-22T02:10:00.000Z',
        reasonCode: null,
      },
      ...(item.status === 'COMPLETED'
        ? [
            {
              fromStatus: 'CHECKED_IN' as const,
              toStatus: 'COMPLETED' as const,
              createdAt: '2026-07-08T08:00:00.000Z',
              reasonCode: null,
            },
          ]
        : []),
    ],
    lifecycle: {
      evaluatedAt: '2026-07-22T12:00:00.000Z',
      allowedActions: item.status === 'CONFIRMED' ? ['CANCEL', 'RESCHEDULE'] : [],
    },
    rescheduleContext:
      item.status === 'CONFIRMED'
        ? {
            merchantSlug: 'nook-preview',
            serviceId: item.service.id,
            locationId: '70000000-0000-4000-8000-000000000001',
          }
        : null,
  };
}

export const previewMerchantAppointments: readonly MerchantAppointmentSummary[] = [
  {
    ...base(
      '50000000-0000-4000-8000-000000000011',
      '2026-07-22T02:00:00.000Z',
      'CONFIRMED',
      '透感暈染設計',
      'Yun',
    ),
    source: 'MERCHANT_LINK',
    consumer: { displayName: '陳小姐' },
  },
  {
    ...base(
      '50000000-0000-4000-8000-000000000012',
      '2026-07-22T05:30:00.000Z',
      'CONFIRMED',
      '手部單色凝膠',
      'Mina',
    ),
    source: 'MERCHANT_LINK',
    consumer: { displayName: '林小姐' },
  },
  {
    ...base(
      '50000000-0000-4000-8000-000000000013',
      '2026-07-24T08:00:00.000Z',
      'CHECKED_IN',
      '自由設計',
      'Yun',
    ),
    pricingStatus: 'QUOTE_REQUIRED',
    subtotalAmount: null,
    totalAmount: null,
    service: {
      ...base(
        '50000000-0000-4000-8000-000000000013',
        '2026-07-24T08:00:00.000Z',
        'CHECKED_IN',
        '自由設計',
        'Yun',
      ).service,
      priceType: 'QUOTE',
      priceAmount: null,
    },
    source: 'MERCHANT_LINK',
    consumer: { displayName: '王小姐' },
  },
];

export function previewMerchantDetail(item: MerchantAppointmentSummary): MerchantAppointmentDetail {
  const evaluatedAt = new Date();
  const allowedActions =
    item.status === 'CONFIRMED'
      ? [
          'CANCEL' as const,
          ...(evaluatedAt.getTime() >= new Date(item.startAt).getTime() - 120 * 60_000
            ? (['CHECK_IN'] as const)
            : []),
          ...(evaluatedAt >= new Date(item.endAt) ? (['NO_SHOW'] as const) : []),
        ]
      : item.status === 'CHECKED_IN' && evaluatedAt >= new Date(item.startAt)
        ? (['COMPLETE'] as const)
        : [];
  return {
    ...item,
    history: [
      { fromStatus: null, toStatus: 'CONFIRMED', createdAt: item.confirmedAt, reasonCode: null },
    ],
    lifecycle: {
      evaluatedAt: evaluatedAt.toISOString(),
      allowedActions,
      checkInAvailableAt: new Date(new Date(item.startAt).getTime() - 120 * 60_000).toISOString(),
      completeAvailableAt: item.startAt,
      noShowAvailableAt: item.endAt,
    },
  };
}
