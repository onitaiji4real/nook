import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { PublicMerchantResponse } from '@nook/contracts';

import { MerchantPublicPage } from '../../../features/merchant-public/merchant-public-page';

type RouteProps = {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const merchant = await loadMerchant((await params).slug);
  if (merchant === null)
    return { title: '找不到商家｜Nook', robots: { index: false, follow: false } };
  return {
    title: `${merchant.name}｜Nook`,
    description: merchant.description,
    openGraph: {
      title: merchant.name,
      description: merchant.description,
      locale: 'zh_TW',
      type: 'website',
    },
  };
}

export default async function PublicMerchantRoute({ params, searchParams }: RouteProps) {
  const merchant = await loadMerchant((await params).slug);
  if (merchant === null) notFound();
  return (
    <MerchantPublicPage
      bookingIntent={parseBookingIntent(await searchParams)}
      merchant={merchant}
    />
  );
}

function parseBookingIntent(searchParams: Record<string, string | string[] | undefined>) {
  const serviceId = searchParams.serviceId;
  const locationId = searchParams.locationId;
  const rescheduleAppointmentId = searchParams.rescheduleAppointmentId;
  if (
    typeof serviceId !== 'string' ||
    typeof locationId !== 'string' ||
    typeof rescheduleAppointmentId !== 'string' ||
    ![serviceId, locationId, rescheduleAppointmentId].every((value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value),
    )
  )
    return undefined;
  return { serviceId, locationId, rescheduleAppointmentId };
}

async function loadMerchant(slug: string): Promise<PublicMerchantResponse | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  const baseUrl = process.env.API_INTERNAL_BASE_URL ?? 'http://localhost:8080';
  try {
    const response = await fetch(`${baseUrl}/v1/marketplace/merchants/${slug}`, {
      next: { revalidate: 60 },
    });
    if (!response.ok) return null;
    return (await response.json()) as PublicMerchantResponse;
  } catch {
    return null;
  }
}
