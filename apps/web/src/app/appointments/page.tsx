import type { Metadata } from 'next';

import { ConsumerAppointmentsPage } from '../../features/appointment-views/consumer-appointments-page';
import { ConsumerSessionProvider } from '../../features/merchant-public/consumer-session-provider';

export const metadata: Metadata = {
  title: '我的預約｜Nook',
  description: '安全查看即將到來與過去的Nook預約。',
  robots: { index: false, follow: false },
};

export default function ConsumerAppointmentsRoute() {
  return (
    <ConsumerSessionProvider preview={false}>
      <ConsumerAppointmentsPage />
    </ConsumerSessionProvider>
  );
}
