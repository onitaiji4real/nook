'use client';

import type { StudioRouteKey } from '@nook/contracts';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { readRememberLogin, writeStudioEntryNotice } from './browser-session-storage';
import { initializeMerchantLineEntry } from './merchant-line-entry';
import { useStudioSession } from './studio-session-provider';

type EntryPhase =
  | 'preparing'
  | 'redirecting'
  | 'authenticating'
  | 'selecting'
  | 'navigating'
  | 'authorization-missing'
  | 'failed';

export function MerchantLineEntryPage() {
  const {
    status,
    memberships,
    selectedMembership,
    lineEntryConfig,
    message,
    completeLineIdentity,
    recordMerchantEntry,
    selectTenant,
  } = useStudioSession();
  const [phase, setPhase] = useState<EntryPhase>('preparing');
  const [routeKey, setRouteKey] = useState<StudioRouteKey | null>(null);
  const [attempt, setAttempt] = useState(0);
  const initializedAttempt = useRef<number | null>(null);
  const navigating = useRef(false);

  useEffect(() => {
    if (lineEntryConfig.status !== 'ready' || initializedAttempt.current === attempt) return;
    initializedAttempt.current = attempt;
    let active = true;

    void initializeMerchantLineEntry({
      liffId: lineEntryConfig.liffId,
      currentUrl: () => window.location.href,
      replaceUrl: (url) => window.history.replaceState(null, '', url),
    })
      .then(async (result) => {
        if (!active) return;
        setRouteKey(result.routeKey);
        if (result.status === 'redirecting') {
          setPhase('redirecting');
          return;
        }
        if (result.status === 'authorization-missing') {
          setPhase('authorization-missing');
          return;
        }
        setPhase('authenticating');
        await completeLineIdentity(
          { idToken: result.idToken, nonce: result.nonce },
          readRememberLogin(),
        );
      })
      .catch(() => {
        if (active) setPhase('failed');
      });

    return () => {
      active = false;
    };
  }, [attempt, completeLineIdentity, lineEntryConfig]);

  useEffect(() => {
    if (
      routeKey === null ||
      status !== 'ready' ||
      selectedMembership === null ||
      navigating.current
    ) {
      if (status === 'tenant-required' && memberships.length > 1) setPhase('selecting');
      return;
    }

    navigating.current = true;
    setPhase('navigating');
    void recordMerchantEntry({
      tenantId: selectedMembership.tenantId,
      routeKey,
    }).then((decision) => {
      if (decision === null) {
        navigating.current = false;
        setPhase('selecting');
        return;
      }
      if (decision.access === 'fallback') writeStudioEntryNotice('role_fallback');
      window.location.assign(decision.href);
    });
  }, [memberships.length, recordMerchantEntry, routeKey, selectedMembership, status]);

  const retry = useCallback(() => {
    navigating.current = false;
    setPhase('preparing');
    setRouteKey(null);
    setAttempt((value) => value + 1);
  }, []);

  if (lineEntryConfig.status === 'disabled') {
    return (
      <EntryFrame eyebrow="LINE ENTRY · LOCAL">
        <h1>LINE 店務入口尚未啟用。</h1>
        <p>
          本機仍可從一般瀏覽器驗收 RWD 工作台；正式 LIFF ID
          與平台官方帳號設定完成後才會開啟這條入口。
        </p>
        <a className="studio-dark-action" href="/studio">
          開啟本機工作台
        </a>
      </EntryFrame>
    );
  }

  if (phase === 'authorization-missing') {
    return (
      <EntryFrame eyebrow="LINE AUTHORIZATION">
        <h1>LINE 授權尚未完成。</h1>
        <p>請回到平台官方帳號重新開啟店務入口；若你已取消授權，可在 LINE 設定後再次嘗試。</p>
        <button className="studio-line-action" onClick={retry} type="button">
          再試一次
        </button>
      </EntryFrame>
    );
  }

  if (phase === 'failed' || status === 'not-configured' || status === 'degraded') {
    return (
      <EntryFrame eyebrow="CONNECTION PAUSED">
        <h1>目前無法開啟店務入口。</h1>
        <p>{message ?? 'LINE 初始化或登入轉向沒有完成。請確認網路後重新嘗試。'}</p>
        <button className="studio-line-action" onClick={retry} type="button">
          重新連線
        </button>
      </EntryFrame>
    );
  }

  if (routeKey !== null && status === 'tenant-required' && memberships.length === 0) {
    return (
      <EntryFrame eyebrow="MERCHANT ACCESS">
        <h1>目前沒有可使用的店家權限。</h1>
        <p>請聯絡店主確認邀請與權限狀態。基於安全考量，這裡不會顯示店家是否存在或先前權限內容。</p>
        <a className="studio-dark-action" href="/studio">
          返回安全說明
        </a>
      </EntryFrame>
    );
  }

  if (routeKey !== null && status === 'tenant-required' && memberships.length > 1) {
    return (
      <EntryFrame eyebrow="CHOOSE STUDIO">
        <h1>這次要處理哪一家店？</h1>
        <p>LINE 連結只決定功能入口；店家權限會由伺服器重新確認。</p>
        <div className="line-entry-tenants">
          {memberships.map((membership) => (
            <button
              key={membership.membershipId}
              onClick={() => selectTenant(membership.tenantId)}
              type="button"
            >
              <strong>{membership.tenantName}</strong>
              <span>{roleLabel[membership.role]}</span>
            </button>
          ))}
        </div>
      </EntryFrame>
    );
  }

  return (
    <EntryFrame eyebrow="NOOK × LINE">
      <div className="line-entry-pulse" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h1>{phaseCopy[phase].title}</h1>
      <p aria-live="polite">{phaseCopy[phase].detail}</p>
    </EntryFrame>
  );
}

function EntryFrame({
  eyebrow,
  children,
}: {
  readonly eyebrow: string;
  readonly children: ReactNode;
}) {
  return (
    <main className="line-entry-page">
      <div className="line-entry-card">
        <p className="studio-eyebrow">{eyebrow}</p>
        {children}
        <small>身分、店家與角色皆由伺服器確認；LINE 連結不會授予操作權限。</small>
      </div>
    </main>
  );
}

const roleLabel = {
  OWNER: '店主',
  MANAGER: '管理者',
  VIEWER: '唯讀人員',
  STAFF: '服務人員',
} as const;

const phaseCopy: Record<EntryPhase, { readonly title: string; readonly detail: string }> = {
  preparing: {
    title: '正在確認 LINE 入口。',
    detail: '初始化完成前不會讀取網址、啟動分析或進入店務資料。',
  },
  redirecting: {
    title: '正在前往 LINE 登入。',
    detail: '完成授權後會回到同一個安全入口。',
  },
  authenticating: {
    title: '正在核對店家權限。',
    detail: '系統正重新取得有效帳號與 ACTIVE 店家 membership。',
  },
  navigating: {
    title: '權限確認完成。',
    detail: '正在開啟這個角色可使用的店務頁面。',
  },
  selecting: {
    title: '正在準備店家選擇。',
    detail: '請選擇這次要操作的店家。',
  },
  'authorization-missing': {
    title: 'LINE 授權尚未完成。',
    detail: '請回到平台官方帳號重新開啟。',
  },
  failed: {
    title: '目前無法開啟入口。',
    detail: '請稍後重新嘗試。',
  },
};
