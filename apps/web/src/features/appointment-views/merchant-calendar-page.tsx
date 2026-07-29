'use client';

import type {
  AppointmentTransitionResponse,
  AppointmentStatus,
  MerchantCancelReason,
  MerchantLifecycleAction,
  MerchantAppointmentDetail,
  MerchantAppointmentListResponse,
  MerchantAppointmentSummary,
  StaffAvailabilityResponse,
} from '@nook/contracts';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useStudioSession } from '../studio-session/studio-session-provider';
import { StudioApiError } from '../studio-session/studio-api-error';
import { appointmentLocalDate, calendarWeekWindow, formatAppointmentTime } from './calendar-time';
import { previewMerchantAppointments, previewMerchantDetail } from './preview-appointments';

const statusLabels: Record<AppointmentStatus, string> = {
  CONFIRMED: '已確認・未付款',
  CHECKED_IN: '已報到',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  NO_SHOW: '未到店',
  RESCHEDULED: '已改期',
};

export function MerchantCalendarPage() {
  const session = useStudioSession();
  const { request, selectedMembership: membership, status: sessionStatus } = session;
  const [weekOffset, setWeekOffset] = useState(0);
  const [staffId, setStaffId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [staff, setStaff] = useState<readonly { readonly id: string; readonly name: string }[]>([]);
  const [items, setItems] = useState<readonly MerchantAppointmentSummary[]>([]);
  const [calendarTimezone, setCalendarTimezone] = useState('Asia/Taipei');
  const [rangeLabel, setRangeLabel] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MerchantAppointmentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<MerchantLifecycleAction | null>(null);
  const [cancelReason, setCancelReason] = useState<MerchantCancelReason>(
    'MERCHANT_CUSTOMER_REQUEST',
  );
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const pendingTransition = useRef<{
    readonly action: MerchantLifecycleAction;
    readonly key: string;
    readonly reason: MerchantCancelReason | null;
  } | null>(null);

  const tenantTimezone = membership?.tenantTimezone ?? 'Asia/Taipei';
  const preview = sessionStatus === 'local-preview';

  const loadStaff = useCallback(async () => {
    if (preview) {
      setStaff([
        { id: previewMerchantAppointments[0]!.staff.id, name: 'Yun' },
        { id: previewMerchantAppointments[1]!.staff.id, name: 'Mina' },
      ]);
      return;
    }
    if (sessionStatus !== 'ready' || membership === null) return;
    try {
      const response = await request<StaffAvailabilityResponse>(
        `/v1/tenants/${membership.tenantId}/staff`,
        { cache: 'no-store' },
      );
      setStaff(response.staff.map(({ id, displayName }) => ({ id, name: displayName })));
    } catch {
      setError('服務人員清單暫時無法讀取；仍可查看整店預約。');
    }
  }, [membership, preview, request, sessionStatus]);

  const loadCalendar = useCallback(
    async (append = false, cursor?: string) => {
      if (!preview && (sessionStatus !== 'ready' || membership === null)) return;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const window = calendarWeekWindow(new Date(), tenantTimezone, weekOffset);
        setRangeLabel(
          `${window.localFrom.replaceAll('-', '.')} — ${window.localTo.replaceAll('-', '.')}`,
        );
        if (preview) {
          const visible = previewMerchantAppointments.filter(
            (item) =>
              item.startAt >= window.from &&
              item.startAt < window.to &&
              (staffId === '' || item.staff.id === staffId) &&
              (statusFilter === '' || item.status === statusFilter),
          );
          setItems(visible);
          setCalendarTimezone('Asia/Taipei');
          setNextCursor(null);
          return;
        }
        const query = new URLSearchParams({ from: window.from, to: window.to, limit: '100' });
        if (staffId !== '') query.set('staffId', staffId);
        if (statusFilter !== '') query.set('status', statusFilter);
        if (cursor !== undefined) query.set('cursor', cursor);
        const response = await request<MerchantAppointmentListResponse>(
          `/v1/tenants/${membership!.tenantId}/appointments?${query.toString()}`,
          { cache: 'no-store' },
        );
        setItems((current) => (append ? [...current, ...response.items] : response.items));
        setCalendarTimezone(response.calendarTimezone);
        setNextCursor(response.nextCursor);
      } catch {
        setError('行事曆暫時無法讀取，請稍後重試。');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [
      membership,
      preview,
      request,
      sessionStatus,
      staffId,
      statusFilter,
      tenantTimezone,
      weekOffset,
    ],
  );

  useEffect(() => {
    setStaffId('');
    setDetail(null);
    pendingTransition.current = null;
    void loadStaff();
  }, [loadStaff, membership?.tenantId]);

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    setDetail(null);
    pendingTransition.current = null;
    void loadCalendar();
  }, [loadCalendar]);

  const groups = useMemo(() => {
    const result = new Map<string, MerchantAppointmentSummary[]>();
    for (const item of items) {
      const date = appointmentLocalDate(item.startAt, calendarTimezone);
      result.set(date, [...(result.get(date) ?? []), item]);
    }
    return [...result.entries()];
  }, [calendarTimezone, items]);

  async function openDetail(item: MerchantAppointmentSummary): Promise<void> {
    pendingTransition.current = null;
    setDetailLoading(true);
    setError(null);
    try {
      setDetail(
        preview
          ? previewMerchantDetail(item)
          : await request<MerchantAppointmentDetail>(
              `/v1/tenants/${membership!.tenantId}/appointments/${item.id}`,
              { cache: 'no-store' },
            ),
      );
    } catch {
      setError('預約明細暫時無法讀取。');
    } finally {
      setDetailLoading(false);
    }
  }

  async function transition(action: MerchantLifecycleAction): Promise<void> {
    if (detail === null || (membership === null && !preview)) return;
    const label = merchantActionLabels[action];
    if (!window.confirm(`確定要將這筆預約標記為「${label}」嗎？`)) return;
    setActionBusy(action);
    setActionMessage(null);
    try {
      if (!preview) {
        const reason = action === 'CANCEL' ? cancelReason : null;
        if (
          pendingTransition.current?.action !== action ||
          pendingTransition.current.reason !== reason
        ) {
          pendingTransition.current = { action, key: crypto.randomUUID(), reason };
        }
        await request<AppointmentTransitionResponse>(
          `/v1/tenants/${membership!.tenantId}/appointments/${detail.id}/${merchantActionPaths[action]}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': pendingTransition.current.key,
            },
            body: JSON.stringify(action === 'CANCEL' ? { reasonCode: cancelReason } : {}),
          },
        );
        const refreshed = await request<MerchantAppointmentDetail>(
          `/v1/tenants/${membership!.tenantId}/appointments/${detail.id}`,
          { cache: 'no-store' },
        );
        setDetail(refreshed);
      } else {
        const status = merchantActionStatuses[action];
        setDetail({
          ...detail,
          status,
          lifecycle: {
            ...detail.lifecycle,
            evaluatedAt: new Date().toISOString(),
            allowedActions: previewNextActions(status),
          },
          history: [
            ...detail.history,
            {
              fromStatus: detail.status,
              toStatus: status,
              createdAt: new Date().toISOString(),
              reasonCode: action === 'CANCEL' ? cancelReason : null,
            },
          ],
        });
      }
      setItems((current) =>
        current.map((item) =>
          item.id === detail.id ? { ...item, status: merchantActionStatuses[action] } : item,
        ),
      );
      pendingTransition.current = null;
      setActionMessage(preview ? '預覽操作完成；沒有變更真實資料。' : `預約已標記為「${label}」。`);
      if (!preview) await loadCalendar();
    } catch (cause) {
      if (shouldClearTransitionKey(cause)) pendingTransition.current = null;
      setActionMessage('操作沒有完成，資料可能已被其他人更新；已重新整理預約。');
      await openDetail(detail);
    } finally {
      setActionBusy(null);
    }
  }

  if (['config-loading', 'account-loading'].includes(sessionStatus)) {
    return <main className="studio-calendar studio-calendar-gate">正在準備行事曆…</main>;
  }
  if (['signed-out', 'signing-in', 'not-configured'].includes(sessionStatus)) {
    return (
      <main className="studio-calendar studio-calendar-gate">
        <p className="studio-eyebrow">CALENDAR ACCESS</p>
        <h1>請先登入店務工作台。</h1>
        <a className="studio-dark-action" href="/studio/login">
          前往安全登入
        </a>
      </main>
    );
  }
  if (sessionStatus === 'tenant-required') {
    return (
      <main className="studio-calendar studio-calendar-gate">
        <p className="studio-eyebrow">SELECT TENANT</p>
        <h1>先在總覽選擇一家店。</h1>
        <a className="studio-dark-action" href="/studio">
          回到總覽
        </a>
      </main>
    );
  }

  return (
    <main className="studio-calendar">
      <header className="studio-calendar-hero">
        <div>
          <p className="studio-eyebrow">APPOINTMENT DESK · {calendarTimezone}</p>
          <h1>
            一週的節奏，<em>一眼看清。</em>
          </h1>
          <p>
            {preview
              ? 'LOCAL PREVIEW · 合成資料，不會讀取顧客或真實預約。'
              : '每次篩選都由伺服器重新套用租戶與人員權限。'}
          </p>
        </div>
        <div className="studio-calendar-range">
          <span>7 DAY WINDOW</span>
          <strong>{rangeLabel}</strong>
        </div>
      </header>

      <section className="studio-calendar-toolbar" aria-label="行事曆篩選">
        <div className="studio-calendar-week-controls">
          <button onClick={() => setWeekOffset((value) => value - 1)} type="button">
            ← 上一週
          </button>
          <button onClick={() => setWeekOffset(0)} type="button">
            今天
          </button>
          <button onClick={() => setWeekOffset((value) => value + 1)} type="button">
            下一週 →
          </button>
        </div>
        <label>
          服務人員
          <select
            disabled={membership?.role === 'STAFF'}
            onChange={(event) => setStaffId(event.target.value)}
            value={staffId}
          >
            <option value="">全部人員</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          狀態
          <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
            <option value="">全部狀態</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error === null ? null : (
        <div className="appointment-alert studio-calendar-alert" role="alert">
          <p>{error}</p>
          <button onClick={() => void loadCalendar()} type="button">
            重新讀取
          </button>
        </div>
      )}

      <section className="studio-calendar-agenda" aria-live="polite">
        {loading ? (
          <div className="appointment-loading">正在整理這一週…</div>
        ) : groups.length === 0 ? (
          <div className="appointment-empty">
            <span>00</span>
            <h2>這個範圍沒有符合條件的預約。</h2>
            <p>換一週或清除篩選後再看看。</p>
          </div>
        ) : (
          groups.map(([date, appointments]) => (
            <section className="studio-calendar-day" key={date}>
              <header>
                <time dateTime={date}>{formatDateHeading(date)}</time>
                <span>{appointments.length} APPOINTMENTS</span>
              </header>
              <div>
                {appointments.map((item) => (
                  <article className="studio-calendar-card" key={item.id}>
                    <time>
                      {formatAppointmentTime(item.startAt, item.timezone)}
                      <small>— {formatAppointmentTime(item.endAt, item.timezone)}</small>
                    </time>
                    <div className="studio-calendar-card-main">
                      <span
                        className={`appointment-status appointment-status-${item.status.toLowerCase()}`}
                      >
                        {statusLabels[item.status]}
                      </span>
                      <h2>{item.consumer.displayName}</h2>
                      <p>
                        {item.service.name} · {item.staff.displayName}
                      </p>
                    </div>
                    <div className="studio-calendar-card-meta">
                      <strong>{merchantPriceLabel(item)}</strong>
                      <span>{item.source === 'MERCHANT_LINK' ? '店家連結' : item.source}</span>
                      <button onClick={() => void openDetail(item)} type="button">
                        明細 →
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))
        )}
      </section>

      {nextCursor === null ? null : (
        <button
          className="appointment-load-more"
          disabled={loadingMore}
          onClick={() => void loadCalendar(true, nextCursor)}
          type="button"
        >
          {loadingMore ? '正在載入…' : '載入更多預約'}
        </button>
      )}

      {detail === null && !detailLoading ? null : (
        <div className="appointment-detail-backdrop" role="presentation">
          <aside
            aria-label="店家預約明細"
            className="appointment-detail-panel studio-calendar-detail"
          >
            {detailLoading || detail === null ? (
              <p>正在讀取明細…</p>
            ) : (
              <>
                <div className="appointment-detail-heading">
                  <div>
                    <p className="appointment-kicker">APPOINTMENT DETAIL</p>
                    <h2>{detail.consumer.displayName}</h2>
                  </div>
                  <button
                    aria-label="關閉預約明細"
                    onClick={() => {
                      pendingTransition.current = null;
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
                    <dd>
                      {formatAppointmentTime(detail.startAt, detail.timezone)}—
                      {formatAppointmentTime(detail.endAt, detail.timezone)}
                    </dd>
                  </div>
                  <div>
                    <dt>服務</dt>
                    <dd>{detail.service.name}</dd>
                  </div>
                  <div>
                    <dt>服務人員</dt>
                    <dd>{detail.staff.displayName}</dd>
                  </div>
                  <div>
                    <dt>價格</dt>
                    <dd>{merchantPriceLabel(detail)}</dd>
                  </div>
                  <div>
                    <dt>來源</dt>
                    <dd>
                      {detail.source === 'MERCHANT_LINK'
                        ? '店家自有連結・不直接認列媒合費'
                        : detail.source}
                    </dd>
                  </div>
                </dl>
                <div className="appointment-history">
                  <h3>狀態歷程</h3>
                  {detail.history.map((entry, index) => (
                    <p key={`${entry.createdAt}-${index}`}>
                      {statusLabels[entry.toStatus]} ·{' '}
                      {formatAppointmentTime(entry.createdAt, detail.timezone)}
                    </p>
                  ))}
                </div>
                {detail.lifecycle.allowedActions.length === 0 ? null : (
                  <section className="appointment-actions" aria-label="店家預約操作">
                    <h3>更新預約狀態</h3>
                    {detail.lifecycle.allowedActions.includes('CANCEL') ? (
                      <label>
                        取消原因
                        <select
                          disabled={actionBusy !== null}
                          onChange={(event) =>
                            setCancelReason(event.target.value as MerchantCancelReason)
                          }
                          value={cancelReason}
                        >
                          <option value="MERCHANT_CUSTOMER_REQUEST">依顧客要求</option>
                          <option value="MERCHANT_STAFF_UNAVAILABLE">服務人員臨時無法服務</option>
                          <option value="MERCHANT_BUSINESS_CLOSURE">店休或營運異動</option>
                          <option value="MERCHANT_DUPLICATE">重複預約</option>
                          <option value="MERCHANT_OTHER">其他原因</option>
                        </select>
                      </label>
                    ) : null}
                    <div>
                      {detail.lifecycle.allowedActions.map((action) => (
                        <button
                          disabled={actionBusy !== null}
                          key={action}
                          onClick={() => void transition(action)}
                          type="button"
                        >
                          {actionBusy === action ? '處理中…' : merchantActionLabels[action]}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {actionMessage === null ? null : (
                  <p className="appointment-action-message" role="status">
                    {actionMessage}
                  </p>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

const merchantActionLabels: Record<MerchantLifecycleAction, string> = {
  CANCEL: '取消預約',
  CHECK_IN: '標記已報到',
  COMPLETE: '標記已完成',
  NO_SHOW: '標記未到店',
};

const merchantActionPaths: Record<MerchantLifecycleAction, string> = {
  CANCEL: 'cancel',
  CHECK_IN: 'check-in',
  COMPLETE: 'complete',
  NO_SHOW: 'no-show',
};

const merchantActionStatuses: Record<MerchantLifecycleAction, AppointmentStatus> = {
  CANCEL: 'CANCELLED',
  CHECK_IN: 'CHECKED_IN',
  COMPLETE: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
};

function previewNextActions(status: AppointmentStatus): readonly MerchantLifecycleAction[] {
  return status === 'CHECKED_IN' ? ['COMPLETE'] : [];
}

function shouldClearTransitionKey(cause: unknown): boolean {
  return !(
    cause instanceof StudioApiError &&
    (cause.status === 0 || cause.status === 401 || cause.status === 503)
  );
}

function formatDateHeading(date: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function merchantPriceLabel(item: MerchantAppointmentSummary): string {
  if (item.pricingStatus === 'QUOTE_REQUIRED') return '到店報價';
  if (item.pricingStatus === 'ESTIMATE') return '預估價格';
  return `NT$${item.totalAmount?.toLocaleString() ?? '—'}`;
}
