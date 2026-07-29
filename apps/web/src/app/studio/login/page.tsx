import type { Metadata } from 'next';

import { StudioLoginPage } from '../../../features/studio-session/studio-login-page';

export const metadata: Metadata = {
  title: '登入工作台｜Nook',
  description: '使用LINE安全登入Nook店務工作台。',
};

export default function StudioLoginRoute() {
  return <StudioLoginPage />;
}
