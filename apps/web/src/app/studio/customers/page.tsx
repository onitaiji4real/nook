import type { Metadata } from 'next';

import { CustomerCrmPage } from '../../../features/customer-crm/customer-crm-page';

export const metadata: Metadata = {
  title: '顧客名冊｜Nook Studio',
  description: '依店家權限查看由預約建立的顧客關係與服務紀錄。',
  robots: { index: false, follow: false },
};

export default function StudioCustomersRoute() {
  return <CustomerCrmPage />;
}
