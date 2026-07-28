'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { consumeStudioEntryNotice } from './browser-session-storage';
import { useStudioSession } from './studio-session-provider';

const workspaces = [
  {
    href: '/studio/appointments',
    step: '00',
    title: '預約行事曆',
    note: '今日節奏、顧客與服務人員',
  },
  { href: '/studio/customers', step: '01', title: '顧客名冊', note: '履約關係、到訪與同意狀態' },
  { href: '/studio/onboarding', step: '02', title: '商家資料', note: '名稱、據點與第一項服務' },
  { href: '/studio/services', step: '03', title: '服務目錄', note: '價格、時間與上下架' },
  { href: '/studio/staff', step: '04', title: '人員班表', note: '工作時間、休假與例外' },
  { href: '/studio/portfolio', step: '05', title: '作品管理', note: '受控上傳、排序與發布狀態' },
  { href: '/studio/publication', step: '06', title: '發布中心', note: '門檻檢查、公開與撤下' },
] as const;

export function StudioHomePage() {
  const {
    status,
    memberships,
    selectedMembership,
    message,
    selectTenant,
    createTenant,
    retryAccount,
  } = useStudioSession();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [entryNotice, setEntryNotice] = useState<string | null>(null);

  useEffect(() => {
    if (consumeStudioEntryNotice() === 'role_fallback') {
      setEntryNotice('你的角色目前不能開啟原先指定的頁面，已安全返回店務總覽。');
    }
  }, []);

  async function submitTenant(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      await createTenant({ name, slug });
      setName('');
      setSlug('');
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'config-loading' || status === 'account-loading') {
    return (
      <main className="studio-home">
        <p>正在準備安全工作台…</p>
      </main>
    );
  }
  if (status === 'signed-out' || status === 'signing-in' || status === 'not-configured') {
    return (
      <main className="studio-home studio-home-locked">
        <p className="studio-eyebrow">STUDIO ACCESS</p>
        <h1>先確認店家身分，再開始編輯。</h1>
        {message === null ? null : <p role="alert">{message}</p>}
        <Link className="studio-dark-action" href="/studio/login">
          前往安全登入
        </Link>
      </main>
    );
  }
  if (status === 'degraded') {
    return (
      <main className="studio-home studio-home-locked">
        <p className="studio-eyebrow">CONNECTION PAUSED</p>
        <h1>session仍保留，服務暫時沒有回應。</h1>
        <p role="alert">{message}</p>
        <button className="studio-dark-action" onClick={() => void retryAccount()} type="button">
          重新連線
        </button>
      </main>
    );
  }

  return (
    <main className="studio-home">
      <section className="studio-home-intro">
        <p className="studio-eyebrow">OPERATIONS DESK · ASIA/TAIPEI</p>
        <h1>{status === 'local-preview' ? '先把店務流程走順。' : '今天要整理哪一家店？'}</h1>
        <p>
          {status === 'local-preview'
            ? '以下工作台都能操作，但重新整理後不保證保留，且不會送出正式資料。'
            : '目前店家會套用到所有服務、班表、作品與發布操作，時間會以台北顯示、UTC儲存。'}
        </p>
      </section>

      {entryNotice === null ? null : (
        <p className="studio-entry-notice" role="status">
          {entryNotice}
        </p>
      )}

      {status === 'tenant-required' ? (
        <section className="studio-tenant-panel">
          <div>
            <p className="studio-eyebrow">CURRENT TENANT</p>
            <h2>{memberships.length === 0 ? '建立第一家店' : '選擇目前店家'}</h2>
          </div>
          {memberships.length > 0 ? (
            <div className="studio-tenant-list">
              {memberships.map((membership) => (
                <button
                  key={membership.tenantId}
                  onClick={() => selectTenant(membership.tenantId)}
                  type="button"
                >
                  <strong>{membership.tenantName}</strong>
                  <span>
                    {membership.role} · /m/{membership.tenantSlug}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <form className="studio-tenant-form" onSubmit={(event) => void submitTenant(event)}>
              <label>
                店家名稱
                <input
                  maxLength={160}
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
              </label>
              <label>
                公開網址代號
                <input
                  maxLength={100}
                  minLength={3}
                  onChange={(event) => setSlug(event.target.value.toLowerCase())}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  required
                  value={slug}
                />
              </label>
              <button disabled={submitting} type="submit">
                {submitting ? '正在建立…' : '建立店家'}
              </button>
            </form>
          )}
        </section>
      ) : null}

      {status === 'local-preview' || selectedMembership !== null ? (
        <section className="studio-workspace-grid" aria-label="工作台入口">
          {workspaces.map((workspace) => (
            <Link href={workspace.href} key={workspace.href}>
              <span>{workspace.step}</span>
              <h2>{workspace.title}</h2>
              <p>{workspace.note}</p>
              <strong>OPEN →</strong>
            </Link>
          ))}
        </section>
      ) : null}
    </main>
  );
}
