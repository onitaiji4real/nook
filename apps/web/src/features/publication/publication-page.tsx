'use client';

import type { MerchantPublicationResponse, PublicationReadinessItem } from '@nook/contracts';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';

import { useStudioSession } from '../studio-session/studio-session-provider';

const previewReadiness: readonly PublicationReadinessItem[] = [
  {
    code: 'PROFILE_CONTENT',
    label: '商家介紹與政策',
    ready: false,
    actionPath: '/studio/onboarding',
  },
  { code: 'ACTIVE_LOCATION', label: '主要服務地點', ready: true, actionPath: '/studio/onboarding' },
  { code: 'ACTIVE_SERVICE', label: '啟用中的服務', ready: true, actionPath: '/studio/services' },
  { code: 'ACTIVE_STAFF', label: '可接單服務人員', ready: true, actionPath: '/studio/staff' },
  { code: 'WEEKLY_AVAILABILITY', label: '固定週間班表', ready: false, actionPath: '/studio/staff' },
  {
    code: 'PUBLISHED_PORTFOLIO',
    label: '至少一張公開作品',
    ready: false,
    actionPath: '/studio/portfolio',
  },
];

export function PublicationPage() {
  const { status, selectedMembership, request } = useStudioSession();
  const [publication, setPublication] = useState<MerchantPublicationResponse | null>(null);
  const [message, setMessage] = useState('LOCAL PREVIEW不會改變正式公開狀態。');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status !== 'ready' || selectedMembership === null) return;
    let active = true;
    setMessage('正在重新計算發布門檻…');
    void request<MerchantPublicationResponse>(
      `/v1/tenants/${selectedMembership.tenantId}/publication`,
    )
      .then((response) => {
        if (!active) return;
        setPublication(response);
        setMessage('發布門檻已依正式資料重新計算。');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : '目前無法讀取發布狀態。');
      });
    return () => {
      active = false;
    };
  }, [request, selectedMembership, status]);

  async function togglePublication(): Promise<void> {
    if (status !== 'ready' || selectedMembership === null || publication === null) return;
    const visibilityStatus = publication.visibilityStatus === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
    setSubmitting(true);
    try {
      const response = await request<MerchantPublicationResponse>(
        `/v1/tenants/${selectedMembership.tenantId}/publication`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visibilityStatus }),
        },
      );
      setPublication(response);
      setMessage(visibilityStatus === 'PUBLISHED' ? '店家公開頁已發布。' : '店家公開頁已撤下。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '目前無法變更公開狀態。');
    } finally {
      setSubmitting(false);
    }
  }

  if (!['local-preview', 'ready'].includes(status)) {
    return (
      <main className="studio-home studio-home-locked">
        <p className="studio-eyebrow">STUDIO SESSION REQUIRED</p>
        <h1>先選擇目前店家。</h1>
        <p>發布門檻必須由API依選定tenant重新計算，未登入時不會提供假發布。</p>
        <Link className="studio-dark-action" href="/studio">
          回到店務總覽
        </Link>
      </main>
    );
  }

  const readiness = publication?.readiness ?? previewReadiness;
  const visibilityStatus = publication?.visibilityStatus ?? 'DRAFT';
  const readyToPublish = publication?.readyToPublish ?? false;
  const canChange =
    status === 'ready' &&
    publication !== null &&
    publication.visibilityStatus !== 'SUSPENDED' &&
    (publication.visibilityStatus === 'PUBLISHED' || publication.readyToPublish);

  return (
    <main className="publication-page">
      <section className="publication-heading">
        <div>
          <p className="studio-eyebrow">PUBLICATION / 05</p>
          <h1>公開之前，先把承諾補完整。</h1>
          <p>每次發布都由API重新檢查資料，不以畫面上的舊狀態直接放行。</p>
        </div>
        <div className={`publication-state ${visibilityStatus.toLowerCase()}`}>
          <span>CURRENT VISIBILITY</span>
          <strong>{visibilityStatus}</strong>
          <small>{status === 'ready' ? publication?.slug : 'LOCAL PREVIEW'}</small>
        </div>
      </section>

      <section className="publication-board">
        <div className="publication-checklist">
          <div>
            <p className="studio-eyebrow">READINESS GATE</p>
            <h2>
              {readiness.filter(({ ready }) => ready).length} / {readiness.length} 已完成
            </h2>
          </div>
          <ol>
            {readiness.map((item) => (
              <li className={item.ready ? 'ready' : ''} key={item.code}>
                <span>{item.ready ? '✓' : '○'}</span>
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.code}</small>
                </div>
                <Link href={item.actionPath}>{item.ready ? '檢視' : '去完成'} →</Link>
              </li>
            ))}
          </ol>
        </div>

        <aside className="publication-action-panel">
          <p className="studio-eyebrow">GO LIVE CONTROL</p>
          <h2>
            {visibilityStatus === 'PUBLISHED'
              ? '店家頁目前公開中。'
              : readyToPublish
                ? '已經可以發布。'
                : '還有門檻未完成。'}
          </h2>
          <p>
            發布只會公開allowlist欄位；私人電話、未公開完整地址、儲存路徑與內部備註不會出現在公開response。
          </p>
          <button
            disabled={!canChange || submitting}
            onClick={() => void togglePublication()}
            type="button"
          >
            {submitting
              ? '正在更新…'
              : visibilityStatus === 'PUBLISHED'
                ? '撤下公開頁'
                : '發布店家頁'}
          </button>
          {publication?.visibilityStatus === 'PUBLISHED' ? (
            <Link className="publication-public-link" href={publication.publicPath}>
              查看公開頁 ↗
            </Link>
          ) : null}
          <strong className="publication-message" role="status">
            {message}
          </strong>
        </aside>
      </section>
    </main>
  );
}
