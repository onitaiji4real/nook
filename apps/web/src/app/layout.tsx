import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './styles.css';

export const metadata: Metadata = {
  title: 'Nook｜LINE-first 美業預約與店務系統',
  description:
    '給台灣一人工作室與小型美業店家的 LINE-first 預約、班表、顧客與作品管理平台。顧客不用下載 App。',
  applicationName: 'Nook',
  keywords: ['美業預約', 'LINE 預約', '美甲預約系統', '美睫預約系統', '店務管理'],
  openGraph: {
    title: 'Nook｜把空檔，變成準時赴約。',
    description: '從 LINE 自然開始的美業預約與店務系統。',
    locale: 'zh_TW',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#f2eee5',
  colorScheme: 'light',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-Hant" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
