import type { Metadata } from 'next';

import { BookingPolicyPage } from '../../../features/appointment-views/booking-policy-page';

export const metadata: Metadata = {
  title: '預約規則｜Nook Studio',
  description: '設定預約提前時間、開放範圍與顧客取消改期規則。',
  robots: { index: false, follow: false },
};

export default function StudioPoliciesRoute() {
  return <BookingPolicyPage />;
}
