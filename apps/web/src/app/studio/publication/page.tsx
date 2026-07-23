import type { Metadata } from 'next';

import { PublicationPage } from '../../../features/publication/publication-page';

export const metadata: Metadata = {
  title: '發布中心｜Nook',
  description: '檢查Nook店家公開頁門檻並安全發布或撤下。',
};

export default function PublicationRoute() {
  return <PublicationPage />;
}
