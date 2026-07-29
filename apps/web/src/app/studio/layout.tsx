import type { ReactNode } from 'react';

import { StudioChrome } from '../../features/studio-session/studio-chrome';
import { StudioSessionProvider } from '../../features/studio-session/studio-session-provider';

export default function StudioLayout({ children }: { readonly children: ReactNode }) {
  return (
    <StudioSessionProvider>
      <StudioChrome>{children}</StudioChrome>
    </StudioSessionProvider>
  );
}
