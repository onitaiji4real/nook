import type { Metadata } from 'next';

import { PortfolioPage } from '../../../features/portfolio/portfolio-page';

export const metadata: Metadata = {
  title: '作品集｜Nook',
  description: '管理 Nook 店家作品metadata、受控圖片上傳狀態與作品排序。',
};

export default function PortfolioRoute() {
  return <PortfolioPage />;
}
