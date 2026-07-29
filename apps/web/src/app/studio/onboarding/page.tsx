import type { Metadata } from 'next';

import { MerchantOnboardingPage } from '../../../features/merchant-onboarding/merchant-onboarding-page';

export const metadata: Metadata = {
  title: '建立工作室｜Nook',
  description: '準備 Nook 商家檔案、主要據點與第一項可預約服務。',
};

export default function OnboardingRoute() {
  return <MerchantOnboardingPage />;
}
