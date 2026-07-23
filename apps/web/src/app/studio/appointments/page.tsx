import type { Metadata } from 'next';

import { MerchantCalendarPage } from '../../../features/appointment-views/merchant-calendar-page';

export const metadata: Metadata = {
  title: '預約行事曆｜Nook Studio',
  description: '以租戶與人員權限查看Nook店家預約。',
  robots: { index: false, follow: false },
};

export default function StudioAppointmentsRoute() {
  return <MerchantCalendarPage />;
}
