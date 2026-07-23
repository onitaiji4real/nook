import type { Metadata } from 'next';

import { ServiceCatalogPage } from '../../../features/service-catalog/service-catalog-page';

export const metadata: Metadata = {
  title: '服務目錄｜Nook',
  description: '管理 Nook 店家的服務時間、緩衝、價格、啟用狀態與顯示順序。',
};

export default function ServiceCatalogRoute() {
  return <ServiceCatalogPage />;
}
