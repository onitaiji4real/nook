import type { CustomerDetail, CustomerSummary } from '@nook/contracts';

export const previewCustomers: readonly CustomerSummary[] = [
  {
    id: '71000000-0000-4000-8000-000000000001',
    displayName: '陳小美',
    relationshipStartedAt: '2026-05-18T06:30:00.000Z',
    firstVisitAt: '2026-05-25T06:30:00.000Z',
    lastVisitAt: '2026-07-20T09:00:00.000Z',
    completedVisitCount: 4,
    noShowCount: 0,
    totalSpent: null,
    spendStatus: 'UNKNOWN',
    marketingState: 'GRANTED',
    activeMarketingDocumentVersion: '2026-07.v1',
    tags: [],
  },
  {
    id: '71000000-0000-4000-8000-000000000002',
    displayName: '林小姐',
    relationshipStartedAt: '2026-04-02T02:00:00.000Z',
    firstVisitAt: '2026-04-09T02:00:00.000Z',
    lastVisitAt: '2026-06-28T04:30:00.000Z',
    completedVisitCount: 3,
    noShowCount: 1,
    totalSpent: null,
    spendStatus: 'UNKNOWN',
    marketingState: 'WITHDRAWN',
    activeMarketingDocumentVersion: '2026-07.v1',
    tags: [],
  },
  {
    id: '71000000-0000-4000-8000-000000000003',
    displayName: '王怡婷',
    relationshipStartedAt: '2026-03-11T11:00:00.000Z',
    firstVisitAt: null,
    lastVisitAt: null,
    completedVisitCount: 0,
    noShowCount: 0,
    totalSpent: null,
    spendStatus: 'UNKNOWN',
    marketingState: 'NOT_GRANTED',
    activeMarketingDocumentVersion: '2026-07.v1',
    tags: [],
  },
];

export function previewCustomerDetail(customerId: string): CustomerDetail | null {
  const customer = previewCustomers.find(({ id }) => id === customerId);
  if (customer === undefined) return null;
  return {
    customer,
    contact: { phone: null, email: null, source: null },
    notes: [],
  };
}
