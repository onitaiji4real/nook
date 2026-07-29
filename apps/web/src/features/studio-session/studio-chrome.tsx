'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { useStudioSession } from './studio-session-provider';

const links = [
  { href: '/studio', label: '總覽' },
  { href: '/studio/appointments', label: '預約' },
  { href: '/studio/customers', label: '顧客' },
  { href: '/studio/policies', label: '預約規則' },
  { href: '/studio/onboarding', label: '商家資料' },
  { href: '/studio/services', label: '服務' },
  { href: '/studio/staff', label: '人員班表' },
  { href: '/studio/portfolio', label: '作品' },
  { href: '/studio/publication', label: '發布' },
] as const;

export function StudioChrome({ children }: { readonly children: ReactNode }) {
  const { status, selectedMembership, signOut } = useStudioSession();
  const preview = status === 'local-preview';

  return (
    <div className="studio-shell">
      <header className="studio-shell-header">
        <Link className="studio-shell-brand" href="/studio">
          NOOK <span>STUDIO</span>
        </Link>
        <div className="studio-shell-context" aria-live="polite">
          {preview ? (
            <strong>LOCAL PREVIEW · 不會儲存</strong>
          ) : selectedMembership === null ? (
            <span>尚未選擇店家</span>
          ) : (
            <span>
              {selectedMembership.tenantName} · {selectedMembership.role}
            </span>
          )}
          {!preview && ['ready', 'tenant-required', 'degraded'].includes(status) ? (
            <button type="button" onClick={() => void signOut()}>
              登出
            </button>
          ) : null}
        </div>
      </header>
      <nav className="studio-shell-nav" aria-label="Studio 工作台">
        {links.map((link) => (
          <Link href={link.href} key={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
