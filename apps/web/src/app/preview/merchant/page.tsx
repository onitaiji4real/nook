import type { Metadata } from 'next';

import { MerchantPublicPage } from '../../../features/merchant-public/merchant-public-page';
import { previewMerchant } from '../../../features/merchant-public/preview-data';

export const metadata: Metadata = {
  title: '公開商家頁預覽｜Nook',
  description: 'Nook 公開商家頁的本機合成資料預覽。',
  robots: { index: false, follow: false },
};

export default async function MerchantPreviewRoute({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const serviceId =
    typeof query.serviceId === 'string' ? query.serviceId : previewMerchant.services[0]?.id;
  const locationId = typeof query.locationId === 'string' ? query.locationId : undefined;
  const rescheduleAppointmentId =
    typeof query.rescheduleAppointmentId === 'string' ? query.rescheduleAppointmentId : undefined;
  const bookingIntent =
    serviceId && locationId && rescheduleAppointmentId
      ? { serviceId, locationId, rescheduleAppointmentId }
      : undefined;
  return <MerchantPublicPage bookingIntent={bookingIntent} merchant={previewMerchant} preview />;
}
