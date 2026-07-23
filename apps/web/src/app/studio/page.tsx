import type { Metadata } from 'next';

import { StudioHomePage } from '../../features/studio-session/studio-home-page';

export const metadata: Metadata = {
  title: '店務總覽｜Nook',
  description: '選擇店家並進入Nook店務工作台。',
};

export default function StudioHomeRoute() {
  return <StudioHomePage />;
}
