import type { Metadata } from 'next';

import { StaffSchedulingPage } from '../../../features/staff-scheduling/staff-scheduling-page';

export const metadata: Metadata = {
  title: '人員班表｜Nook',
  description: '管理 Nook 店家人員的週間班表、休假、加開與保留時段。',
};

export default function StaffSchedulingRoute() {
  return <StaffSchedulingPage />;
}
