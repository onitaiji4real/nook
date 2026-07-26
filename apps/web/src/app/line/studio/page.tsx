import type { Metadata } from 'next';

import { MerchantLineEntryPage } from '../../../features/studio-session/merchant-line-entry-page';
import { StudioSessionProvider } from '../../../features/studio-session/studio-session-provider';

export const metadata: Metadata = {
  title: 'LINE 店務入口｜Nook',
  description: '從 Nook 平台官方帳號安全進入店務工作台。',
};

export default function MerchantLineEntryRoute() {
  return (
    <StudioSessionProvider>
      <MerchantLineEntryPage />
    </StudioSessionProvider>
  );
}
