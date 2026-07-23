'use client';

import type {
  AppointmentTransitionResponse,
  AppointmentStatus,
  ConsumerCancelReason,
  ConsumerAppointmentDetail,
  ConsumerAppointmentListResponse,
  ConsumerAppointmentSummary,
} from '@nook/contracts';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useConsumerSession } from '../merchant-public/consumer-session-provider';
import { StudioApiError } from '../studio-session/studio-api-error';
import { formatAppointmentDateTime } from './calendar-time';
import {
  previewConsumerDetail,
  previewConsumerPast,
  previewConsumerUpcoming,
} from './preview-appointments';

const statusLabels: Record<AppointmentStatus, string> = {
  CONFIRMED: '已確認・尚未付款',
  CHECKED_IN: '已報到',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  NO_SHOW: '未到店',
  RESCHEDULED: '已改期',
};

export function ConsumerAppointmentsPage() {
  const session = useConsumerSession();
  const { message, request, startLineLogin, status: sessionStatus } = session;
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');
  const [items, setItems] = useState<readonly ConsumerAppointmentSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConsumerAppointmentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [cancelReason, setCancelReason] = useState<ConsumerCancelReason>(
    'CONSUMER_CHANGE_OF_PLANS',
  );
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const pendingCancel = useRef<{
    readonly key: string;
    readonly reason: ConsumerCancelReason;
  } | null>(null);

  const load = useCallback(
    async (append = false, cursor?: string) => {
      if (sessionStatus === 'local-preview') {
        setItems(view === 'upcoming' ? previewConsumerUpcoming : previewConsumerPast);
        setNextCursor(null);
        setError(null);
        return;
      }
      if (sessionStatus !== 'ready') return;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams({ view, limit: '20' });
        if (cursor !== undefined) query.set('cursor', cursor);
        const response = await request<ConsumerAppointmentListResponse>(
          `/v1/me/appointments?${query.toString()}`,
          { cache: 'no-store' },
        );
        setItems((current) => (append ? [...current, ...response.items] : response.items));
        setNextCursor(response.nextCursor);
      } catch {
        setError('目前讀不到預約，請保留這個畫面並稍後再試。');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [request, sessionStatus, view],
  );

  useEffect(() => {
    setItems([]);
    setDetail(null);
    pendingCancel.current = null;
    setNextCursor(null);
    void load();
  }, [load]);

  async function openDetail(item: ConsumerAppointmentSummary): Promise<void> {
    pendingCancel.current = null;
    setDetailLoading(true);
    setError(null);
    try {
      setDetail(
        sessionStatus === 'local-preview'
          ? previewConsumerDetail(item)
          : await request<ConsumerAppointmentDetail>(`/v1/me/appointments/${item.id}`, {
              cache: 'no-store',
            }),
      );
    } catch {
      setError('預約明細暫時無法讀取，請稍後重試。');
    } finally {
      setDetailLoading(false);
    }
  }

  async function cancelAppointment(): Promise<void> {
    if (detail === null || !detail.lifecycle.allowedActions.includes('CANCEL')) return;
    if (
      !window.confirm(
        `確定取消 ${formatAppointmentDateTime(detail.startAt, detail.timezone)} 的預約嗎？`,
      )
    ) {
      return;
    }
    setActionBusy(true);
    setActionMessage(null);
    try {
      if (sessionStatus !== 'local-preview') {
        if (pendingCancel.current?.reason !== cancelReason) {
          pendingCancel.current = { key: crypto.randomUUID(), reason: cancelReason };
        }
        await request<AppointmentTransitionResponse>(`/v1/me/appointments/${detail.id}/cancel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': pendingCancel.current.key,
          },
          body: JSON.stringify({ reasonCode: cancelReason }),
        });
      }
      const cancelled: ConsumerAppointmentDetail = {
        ...detail,
        status: 'CANCELLED',
        lifecycle: { evaluatedAt: new Date().toISOString(), allowedActions: [] },
        history: [
          ...detail.history,
          {
            fromStatus: detail.status,
            toStatus: 'CANCELLED',
            createdAt: new Date().toISOString(),
            reasonCode: cancelReason,
          },
        ],
      };
      setDetail(cancelled);
      pendingCancel.current = null;
      setItems((current) =>
        current.map((item) => (item.id === detail.id ? { ...item, status: 'CANCELLED' } : item)),
      );
      setActionMessage(
        sessionStatus === 'local-preview' ? '預覽操作完成；沒有變更真實資料。' : '預約已取消。',
      );
    } catch (cause) {
      if (shouldClearMutationKey(cause)) pendingCancel.current = null;
      setActionMessage('取消沒有完成；資料可能已更新，請重新讀取明細後再試。');
      await openDetail(detail);
    } finally {
      setActionBusy(false);
    }
  }

  if (['config-loading', 'signing-in'].includes(sessionStatus)) {
    return (
      <main className="consumer-appointments consumer-appointments-gate">
        <p className="appointment-kicker">MY APPOINTMENTS</p>
        <h1>正在確認你的預約。</h1>
        <p aria-live="polite">安全連線準備中…</p>
      </main>
    );
  }

  if (sessionStatus === 'signed-out' || sessionStatus === 'not-configured') {
    return (
      <main className="consumer-appointments consumer-appointments-gate">
        <p className="appointment-kicker">PRIVATE APPOINTMENT DESK</p>
        <h1>只有你，看得到自己的預約。</h1>
        <p>{message ?? '使用LINE確認身分後，查看即將到來與過去的預約。'}</p>
        <button onClick={() => void startLineLogin()} type="button">
          使用 LINE 登入
        </button>
      </main>
    );
  }

  return (
    <main className="consumer-appointments">
      <header className="consumer-appointments-header">
        <a href="/" aria-label="回到Nook首頁">
          NOOK
        </a>
        <span>{sessionStatus === 'local-preview' ? 'LOCAL PREVIEW' : 'PRIVATE VIEW'}</span>
      </header>

      <section className="consumer-appointments-hero">
        <p className="appointment-kicker">MY APPOINTMENTS · ASIA/TAIPEI</p>
        <h1>
          把赴約，
          <em>留在看得見的地方。</em>
        </h1>
        <p>
          {sessionStatus === 'local-preview'
            ? '這是合成資料預覽，不會讀取真實預約，也不代表LINE通知已送達。'
            : '這裡只顯示屬於你的預約；完整地址會在預約成立後提供。'}
        </p>
      </section>

      <section className="consumer-appointments-body">
        <div className="appointment-view-tabs" role="tablist" aria-label="預約範圍">
          <button
            aria-selected={view === 'upcoming'}
            onClick={() => setView('upcoming')}
            role="tab"
            type="button"
          >
            即將到來
          </button>
          <button
            aria-selected={view === 'past'}
            onClick={() => setView('past')}
            role="tab"
            type="button"
          >
            過去紀錄
          </button>
        </div>

        {error === null ? null : (
          <div className="appointment-alert" role="alert">
            <p>{error}</p>
            <button onClick={() => void load()} type="button">
              重新讀取
            </button>
          </div>
        )}

        {loading ? (
          <div className="appointment-loading" aria-live="polite">
            正在整理預約…
          </div>
        ) : items.length === 0 ? (
          <div className="appointment-empty">
            <span>00</span>
            <h2>{view === 'upcoming' ? '目前沒有即將到來的預約。' : '還沒有過去紀錄。'}</h2>
            <a href="/">回首頁找店家 →</a>
          </div>
        ) : (
          <div className="consumer-appointment-list">
            {items.map((item, index) => (
              <article className="consumer-appointment-card" key={item.id}>
                <div className="consumer-appointment-index">
                  {String(index + 1).padStart(2, '0')}
                </div>
                <div className="consumer-appointment-main">
                  <span
                    className={`appointment-status appointment-status-${item.status.toLowerCase()}`}
                  >
                    {statusLabels[item.status]}
                  </span>
                  <h2>{item.service.name}</h2>
                  <p>{item.location.name}</p>
                </div>
                <div className="consumer-appointment-facts">
                  <strong>{formatAppointmentDateTime(item.startAt, item.timezone)}</strong>
                  <span>
                    {item.staff.displayName} · {priceLabel(item)}
                  </span>
                  <button onClick={() => void openDetail(item)} type="button">
                    查看明細
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        {nextCursor === null ? null : (
          <button
            className="appointment-load-more"
            disabled={loadingMore}
            onClick={() => void load(true, nextCursor)}
            type="button"
          >
            {loadingMore ? '正在載入…' : '載入更多'}
          </button>
        )}
      </section>

      {detail === null && !detailLoading ? null : (
        <div className="appointment-detail-backdrop" role="presentation">
          <aside aria-label="預約明細" aria-live="polite" className="appointment-detail-panel">
            {detailLoading || detail === null ? (
              <p>正在讀取明細…</p>
            ) : (
              <>
                <div className="appointment-detail-heading">
                  <div>
                    <p className="appointment-kicker">CONFIRMED RECORD</p>
                    <h2>{detail.service.name}</h2>
                  </div>
                  <button
                    aria-label="關閉預約明細"
                    onClick={() => {
                      pendingCancel.current = null;
                      setDetail(null);
                    }}
                    type="button"
                  >
                    ×
                  </button>
                </div>
                <dl className="appointment-detail-list">
                  <div>
                    <dt>狀態</dt>
                    <dd>{statusLabels[detail.status]}</dd>
                  </div>
                  <div>
                    <dt>時間</dt>
                    <dd>{formatAppointmentDateTime(detail.startAt, detail.timezone)}</dd>
                  </div>
                  <div>
                    <dt>服務人員</dt>
                    <dd>{detail.staff.displayName}</dd>
                  </div>
                  <div>
                    <dt>價格</dt>
                    <dd>{priceLabel(detail)}</dd>
                  </div>
                  <div>
                    <dt>完整地址</dt>
                    <dd>
                      {[
                        detail.location.postalCode,
                        detail.location.city,
                        detail.location.district,
                        detail.location.addressText,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    </dd>
                  </div>
                </dl>
                <div className="appointment-policy-copy">
                  <h3>你接受的政策版本</h3>
                  <p>{detail.policies.bookingPolicy}</p>
                  <p>{detail.policies.cancellationPolicy}</p>
                </div>
                {detail.lifecycle.allowedActions.length === 0 ? null : (
                  <section className="appointment-actions" aria-label="預約操作">
                    <h3>管理這次預約</h3>
                    <p>
                      取消期限：
                      {formatAppointmentDateTime(detail.policies.cancelUntil, detail.timezone)}
                      （含）
                    </p>
                    {detail.lifecycle.allowedActions.includes('CANCEL') ? (
                      <label>
                        取消原因
                        <select
                          disabled={actionBusy}
                          onChange={(event) =>
                            setCancelReason(event.target.value as ConsumerCancelReason)
                          }
                          value={cancelReason}
                        >
                          <option value="CONSUMER_CHANGE_OF_PLANS">行程有變</option>
                          <option value="CONSUMER_SCHEDULE_CONFLICT">時間衝突</option>
                          <option value="CONSUMER_BOOKED_ELSEWHERE">已選擇其他安排</option>
                          <option value="CONSUMER_OTHER">其他原因</option>
                        </select>
                      </label>
                    ) : null}
                    <div>
                      {detail.lifecycle.allowedActions.includes('CANCEL') ? (
                        <button
                          disabled={actionBusy}
                          onClick={() => void cancelAppointment()}
                          type="button"
                        >
                          {actionBusy ? '處理中…' : '取消預約'}
                        </button>
                      ) : null}
                      {detail.lifecycle.allowedActions.includes('RESCHEDULE') &&
                      detail.rescheduleContext !== null ? (
                        <a
                          href={`${sessionStatus === 'local-preview' ? '/preview/merchant' : `/m/${encodeURIComponent(detail.rescheduleContext.merchantSlug)}`}?serviceId=${encodeURIComponent(detail.rescheduleContext.serviceId)}&locationId=${encodeURIComponent(detail.rescheduleContext.locationId)}&rescheduleAppointmentId=${encodeURIComponent(detail.id)}#availability`}
                        >
                          選擇改期時段 →
                        </a>
                      ) : null}
                    </div>
                  </section>
                )}
                {actionMessage === null ? null : (
                  <p className="appointment-action-message" role="status">
                    {actionMessage}
                  </p>
                )}
                <p className="appointment-notification-note">
                  預約已建立；此畫面不代表LINE通知已送達。
                </p>
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

function shouldClearMutationKey(cause: unknown): boolean {
  return !(
    cause instanceof StudioApiError &&
    (cause.status === 0 || cause.status === 401 || cause.status === 503)
  );
}

function priceLabel(item: ConsumerAppointmentSummary): string {
  if (item.pricingStatus === 'QUOTE_REQUIRED') return '到店報價';
  if (item.pricingStatus === 'ESTIMATE') {
    if (item.service.priceType === 'RANGE')
      return `預估 NT$${item.service.priceMin?.toLocaleString()}–${item.service.priceMax?.toLocaleString()}`;
    return `NT$${item.service.priceAmount?.toLocaleString()} 起`;
  }
  return `NT$${item.totalAmount?.toLocaleString() ?? '—'}`;
}
