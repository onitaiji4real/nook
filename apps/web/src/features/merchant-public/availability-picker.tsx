'use client';

import type {
  AppointmentTransitionResponse,
  AppointmentResponse,
  BookingHoldResponse,
  ConsumerAppointmentDetail,
  PublicAvailabilityResponse,
  PublicMerchantResponse,
} from '@nook/contracts';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  previewConsumerDetail,
  previewConsumerUpcoming,
} from '../appointment-views/preview-appointments';
import { StudioApiError } from '../studio-session/studio-api-error';
import { type ConsumerSessionStatus, useConsumerSession } from './consumer-session-provider';

type QueryState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly result: PublicAvailabilityResponse };

type HoldPhase =
  | 'idle'
  | 'creating'
  | 'held'
  | 'confirming'
  | 'confirmed'
  | 'releasing'
  | 'released'
  | 'expired'
  | 'error';

export function AvailabilityPicker({
  bookingIntent,
  merchant,
  preview = false,
}: {
  readonly bookingIntent?:
    | {
        readonly serviceId: string;
        readonly locationId: string;
        readonly rescheduleAppointmentId: string;
      }
    | undefined;
  readonly merchant: PublicMerchantResponse;
  readonly preview?: boolean;
}) {
  const consumer = useConsumerSession();
  const [serviceId, setServiceId] = useState(
    merchant.services.some((service) => service.id === bookingIntent?.serviceId)
      ? bookingIntent!.serviceId
      : (merchant.services[0]?.id ?? ''),
  );
  const [staffId, setStaffId] = useState('');
  const [date, setDate] = useState(todayInTimezone(merchant.location.timezone));
  const [state, setState] = useState<QueryState>({ kind: 'idle' });
  const [selectedStartAt, setSelectedStartAt] = useState<string | null>(null);
  const [hold, setHold] = useState<BookingHoldResponse | null>(null);
  const [holdPhase, setHoldPhase] = useState<HoldPhase>('idle');
  const [holdMessage, setHoldMessage] = useState<string | null>(null);
  const [policiesAccepted, setPoliciesAccepted] = useState(false);
  const [appointment, setAppointment] = useState<AppointmentResponse | null>(null);
  const [rescheduleSource, setRescheduleSource] = useState<ConsumerAppointmentDetail | null>(null);
  const [rescheduleResult, setRescheduleResult] = useState<AppointmentTransitionResponse | null>(
    null,
  );
  const [clock, setClock] = useState(() => Date.now());
  const pendingIdempotencyKey = useRef<string | null>(null);
  const pendingConfirmationKey = useRef<string | null>(null);
  const rescheduleMode = bookingIntent !== undefined;

  const eligibleStaff = useMemo(
    () => merchant.staff.filter((staff) => staff.serviceIds.includes(serviceId)),
    [merchant.staff, serviceId],
  );

  const remainingSeconds =
    hold === null
      ? 0
      : Math.max(0, Math.ceil((new Date(hold.expiresAt).getTime() - clock) / 1_000));

  useEffect(() => {
    if (hold === null || holdPhase !== 'held') return;
    const timer = window.setInterval(() => {
      const next = Date.now();
      setClock(next);
      if (new Date(hold.expiresAt).getTime() <= next) {
        setHoldPhase('expired');
        setHoldMessage('保留時間已結束，請重新查詢最新候選時段。');
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [hold, holdPhase]);

  useEffect(() => {
    if (bookingIntent === undefined) return;
    if (consumer.status === 'local-preview') {
      const source =
        previewConsumerUpcoming.find(
          (appointment) => appointment.id === bookingIntent.rescheduleAppointmentId,
        ) ?? previewConsumerUpcoming[0];
      if (source !== undefined) setRescheduleSource(previewConsumerDetail(source));
      return;
    }
    if (consumer.status !== 'ready') return;
    let active = true;
    void consumer
      .request<ConsumerAppointmentDetail>(
        `/v1/me/appointments/${bookingIntent.rescheduleAppointmentId}`,
        { cache: 'no-store' },
      )
      .then((source) => {
        if (active) setRescheduleSource(source);
      })
      .catch(() => {
        if (active) setHoldMessage('原預約已無法讀取，請回到「我的預約」重新開始改期。');
      });
    return () => {
      active = false;
    };
  }, [bookingIntent, consumer, merchant, rescheduleMode]);

  async function queryAvailability(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSelectedStartAt(null);
    if (preview) {
      const service = merchant.services.find((item) => item.id === serviceId);
      if (service === undefined) return;
      setState({ kind: 'ready', result: createPreviewResult(merchant, service, staffId, date) });
      return;
    }

    setState({ kind: 'loading' });
    const query = new URLSearchParams({ serviceId, date, days: '1' });
    if (staffId.length > 0) query.set('staffId', staffId);
    try {
      const response = await fetch(
        `/api/marketplace/${encodeURIComponent(merchant.slug)}/availability?${query.toString()}`,
        { cache: 'no-store' },
      );
      if (!response.ok) {
        setState({
          kind: 'error',
          message:
            response.status === 404
              ? '目前找不到可查詢的服務或設計師。'
              : '暫時無法取得候選時段，請稍後再試。',
        });
        return;
      }
      setState({ kind: 'ready', result: (await response.json()) as PublicAvailabilityResponse });
    } catch {
      setState({ kind: 'error', message: '連線未完成，請確認網路後再試一次。' });
    }
  }

  async function createHold() {
    if (selectedStartAt === null || state.kind !== 'ready') return;
    if (consumer.status === 'signed-out') {
      await consumer.startLineLogin();
      return;
    }
    if (consumer.status !== 'ready' && consumer.status !== 'local-preview') {
      setHoldPhase('error');
      setHoldMessage(consumer.message ?? '目前尚未能使用LINE登入保留時段。');
      return;
    }
    setHoldPhase('creating');
    setHoldMessage(null);
    try {
      let created: BookingHoldResponse;
      if (preview || consumer.status === 'local-preview') {
        created = createPreviewHold(merchant, state.result, selectedStartAt, staffId);
      } else {
        pendingIdempotencyKey.current ??= crypto.randomUUID();
        created = await consumer.request<BookingHoldResponse>(
          `/v1/marketplace/merchants/${encodeURIComponent(merchant.slug)}/booking-holds`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': pendingIdempotencyKey.current,
            },
            body: JSON.stringify({
              serviceId,
              ...(staffId.length === 0 ? {} : { staffId }),
              startAt: selectedStartAt,
            }),
          },
        );
      }
      pendingIdempotencyKey.current = null;
      setHold(created);
      setAppointment(null);
      setRescheduleResult(null);
      setPoliciesAccepted(false);
      pendingConfirmationKey.current = null;
      setClock(Date.now());
      setHoldPhase('held');
      setHoldMessage(
        preview || consumer.status === 'local-preview'
          ? 'LOCAL PREVIEW 模擬保留；不會寫入正式資料庫。'
          : '時段已暫時保留，尚未建立預約。',
      );
    } catch (error) {
      if (shouldClearIdempotencyKey(error)) pendingIdempotencyKey.current = null;
      setHoldPhase('error');
      setHoldMessage(holdErrorMessage(error));
    }
  }

  async function releaseHold() {
    if (hold === null) return;
    setHoldPhase('releasing');
    setHoldMessage(null);
    try {
      if (!preview && consumer.status === 'ready') {
        await consumer.request<void>(`/v1/booking-holds/${encodeURIComponent(hold.id)}`, {
          method: 'DELETE',
        });
      }
      setHold(null);
      setHoldPhase('released');
      setHoldMessage('已釋放這段時間，可以重新選擇。');
      pendingIdempotencyKey.current = null;
      pendingConfirmationKey.current = null;
    } catch (error) {
      setHoldPhase('error');
      setHoldMessage(holdErrorMessage(error));
    }
  }

  async function confirmAppointment() {
    if (hold === null || !policiesAccepted || holdPhase !== 'held' || remainingSeconds <= 0) return;
    setHoldPhase('confirming');
    setHoldMessage(null);
    try {
      let confirmed: AppointmentResponse | null = null;
      let rescheduled: AppointmentTransitionResponse | null = null;
      if (preview || consumer.status === 'local-preview') {
        if (bookingIntent !== undefined) {
          rescheduled = {
            appointmentId: bookingIntent.rescheduleAppointmentId,
            status: 'RESCHEDULED',
            occurredAt: new Date().toISOString(),
            replacementAppointmentId: crypto.randomUUID(),
          };
        } else {
          confirmed = createPreviewAppointment(merchant, hold);
        }
      } else if (consumer.status === 'ready') {
        pendingConfirmationKey.current ??= crypto.randomUUID();
        const init = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': pendingConfirmationKey.current,
          },
          body: JSON.stringify({
            holdId: hold.id,
            policiesAccepted: true,
            policyVersion: hold.policies.version,
            ...(bookingIntent === undefined ? {} : { reasonCode: 'RESCHEDULE_PREFERENCE_CHANGE' }),
          }),
        };
        if (bookingIntent === undefined) {
          confirmed = await consumer.request<AppointmentResponse>('/v1/appointments', init);
        } else {
          rescheduled = await consumer.request<AppointmentTransitionResponse>(
            `/v1/me/appointments/${bookingIntent.rescheduleAppointmentId}/reschedule`,
            init,
          );
        }
      } else {
        throw new StudioApiError(401, 'authentication_required', false);
      }
      pendingConfirmationKey.current = null;
      setAppointment(confirmed);
      setRescheduleResult(rescheduled);
      setHoldPhase('confirmed');
      setHoldMessage(
        preview || consumer.status === 'local-preview'
          ? `LOCAL PREVIEW 模擬${rescheduleMode ? '改期' : '成立'}；不會寫入資料庫，也不會發送通知。`
          : rescheduleMode
            ? '改期已完成；目前不代表 LINE 通知已送達。'
            : '預約已建立；目前不代表 LINE 通知已送達。',
      );
    } catch (error) {
      if (shouldClearIdempotencyKey(error)) pendingConfirmationKey.current = null;
      setHoldPhase('held');
      setHoldMessage(confirmationErrorMessage(error));
    }
  }

  const canCreate =
    selectedStartAt !== null &&
    state.kind === 'ready' &&
    !(holdPhase === 'held' && hold?.startAt === selectedStartAt);
  const blockedSessionLabel = consumerHoldBlockedLabel(consumer.status);
  const fixedStatus =
    holdPhase === 'confirmed' && rescheduleResult !== null
      ? 'RESCHEDULED · 改期完成'
      : holdPhase === 'confirmed' && appointment !== null
        ? 'CONFIRMED · 預約成立'
        : (holdPhase === 'held' || holdPhase === 'confirming') && hold !== null
          ? `暫時保留中 · ${formatCountdown(remainingSeconds)}`
          : selectedStartAt === null || state.kind !== 'ready'
            ? '即時查看候選時段 · 尚未保留'
            : `已選 ${formatSlotTime(selectedStartAt, state.result.timezone)} · 尚未保留`;

  return (
    <>
      <section
        className="merchant-availability"
        id="availability"
        aria-labelledby="availability-title"
      >
        <div className="merchant-availability-heading">
          <p>02 / AVAILABILITY</p>
          <h2 id="availability-title">
            {rescheduleMode ? '為原預約換一段時間。' : '找一段適合你的時間。'}
          </h2>
          <p className="merchant-availability-lead">
            顯示的是即時候選時段；選取不代表保留，送出預約前仍可能被其他人選走。
          </p>
          {preview ? <span className="merchant-preview-note">LOCAL PREVIEW · 模擬時段</span> : null}
          {rescheduleMode ? (
            <span className="merchant-preview-note">RESCHEDULE · 確認前原預約維持不變</span>
          ) : null}
        </div>

        <div className="merchant-availability-panel">
          <form
            className="merchant-availability-form"
            onSubmit={(event) => {
              void queryAvailability(event);
            }}
          >
            <label>
              <span>服務</span>
              <select
                value={serviceId}
                onChange={(event) => {
                  setServiceId(event.target.value);
                  setStaffId('');
                  setState({ kind: 'idle' });
                }}
              >
                {merchant.services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} · {service.durationMinutes} 分鐘
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>設計師</span>
              <select value={staffId} onChange={(event) => setStaffId(event.target.value)}>
                <option value="">任何可服務的設計師</option>
                {eligibleStaff.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>日期</span>
              <input
                type="date"
                min={todayInTimezone(merchant.location.timezone)}
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={serviceId.length === 0 || state.kind === 'loading'}>
              {state.kind === 'loading' ? '查詢中…' : '查看候選時段'}
            </button>
          </form>

          {consumer.message === null ? null : (
            <p className="merchant-hold-message" role="alert">
              {consumer.message}
            </p>
          )}

          <div className="merchant-slot-results" aria-live="polite">
            {state.kind === 'idle' ? (
              <p className="merchant-slot-placeholder">選擇服務與日期，再查看可以開始的時間。</p>
            ) : null}
            {state.kind === 'loading' ? <p>正在整理最新空檔…</p> : null}
            {state.kind === 'error' ? <p role="alert">{state.message}</p> : null}
            {state.kind === 'ready' && state.result.slots.length === 0 ? (
              <p>這天暫時沒有合適時段，可以換一天再看看。</p>
            ) : null}
            {state.kind === 'ready' && state.result.slots.length > 0 ? (
              <>
                <div className="merchant-slot-summary">
                  <strong>{formatLocalDate(date)}</strong>
                  <span>
                    {state.result.slots.length} 個候選時段 · {state.result.timezone}
                  </span>
                </div>
                <div className="merchant-slot-grid">
                  {state.result.slots.map((slot) => (
                    <button
                      type="button"
                      key={slot.startAt}
                      className={selectedStartAt === slot.startAt ? 'is-selected' : undefined}
                      aria-pressed={selectedStartAt === slot.startAt}
                      onClick={() => {
                        if (selectedStartAt !== slot.startAt) pendingIdempotencyKey.current = null;
                        setSelectedStartAt(slot.startAt);
                        setHoldMessage(null);
                        if (holdPhase !== 'held') setHoldPhase('idle');
                      }}
                    >
                      {formatSlotTime(slot.startAt, state.result.timezone)}
                    </button>
                  ))}
                </div>
                <p className="merchant-slot-disclaimer">
                  {selectedStartAt === null
                    ? '請選一個候選時段；此步驟不會建立或保留預約。'
                    : `已選 ${formatSlotTime(selectedStartAt, state.result.timezone)}，尚未保留。`}
                </p>
                {selectedStartAt !== null && holdPhase !== 'confirmed' ? (
                  <div className="merchant-hold-actions">
                    <button
                      type="button"
                      className="merchant-hold-primary"
                      disabled={
                        !canCreate || holdPhase === 'creating' || blockedSessionLabel !== null
                      }
                      onClick={() => void createHold()}
                    >
                      {blockedSessionLabel ??
                        (consumer.status === 'signed-out'
                          ? '使用 LINE 登入後保留'
                          : holdPhase === 'creating'
                            ? '正在保留…'
                            : hold !== null && hold.startAt !== selectedStartAt
                              ? '改保留這個時段'
                              : preview || consumer.status === 'local-preview'
                                ? '模擬保留 10 分鐘'
                                : '保留這個時段 10 分鐘')}
                    </button>
                    {hold !== null && holdPhase !== 'expired' ? (
                      <button
                        type="button"
                        className="merchant-hold-release"
                        disabled={holdPhase === 'releasing'}
                        onClick={() => void releaseHold()}
                      >
                        {holdPhase === 'releasing' ? '釋放中…' : '釋放目前保留'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {hold !== null && ['held', 'confirming'].includes(holdPhase) ? (
                  <div className="merchant-hold-ticket" aria-live="polite">
                    <span>HELD · 尚未建立預約</span>
                    <strong>{formatCountdown(remainingSeconds)}</strong>
                    <p>
                      {formatSlotTime(hold.startAt, hold.timezone)} · {hold.staff.displayName} ·{' '}
                      {hold.service.name}
                    </p>
                    {rescheduleMode && rescheduleSource !== null ? (
                      <div className="merchant-reschedule-comparison">
                        <div>
                          <small>原預約</small>
                          <strong>
                            {formatAppointmentDate(
                              rescheduleSource.startAt,
                              rescheduleSource.timezone,
                            )}
                          </strong>
                          <span>
                            {rescheduleSource.staff.displayName} ·{' '}
                            {formatConsumerPrice(rescheduleSource)}
                          </span>
                          <p>{rescheduleSource.policies.cancellationPolicy}</p>
                        </div>
                        <div>
                          <small>改期後</small>
                          <strong>{formatAppointmentDate(hold.startAt, hold.timezone)}</strong>
                          <span>
                            {hold.staff.displayName} · {formatHoldPrice(hold)}
                          </span>
                          <p>{hold.policies.cancellationPolicy}</p>
                        </div>
                      </div>
                    ) : null}
                    <div className="merchant-policy-acknowledgement">
                      <div>
                        <strong>預約政策</strong>
                        <p>{hold.policies.bookingPolicy}</p>
                      </div>
                      <div>
                        <strong>取消政策</strong>
                        <p>{hold.policies.cancellationPolicy}</p>
                      </div>
                      <label>
                        <input
                          type="checkbox"
                          checked={policiesAccepted}
                          disabled={holdPhase === 'confirming'}
                          onChange={(event) => setPoliciesAccepted(event.target.checked)}
                        />
                        <span>我已閱讀並接受此版本的預約與取消政策</span>
                      </label>
                      <button
                        type="button"
                        className="merchant-confirm-primary"
                        disabled={
                          !policiesAccepted || holdPhase === 'confirming' || remainingSeconds <= 0
                        }
                        onClick={() => void confirmAppointment()}
                      >
                        {holdPhase === 'confirming'
                          ? rescheduleMode
                            ? '正在確認改期…'
                            : '正在建立預約…'
                          : preview || consumer.status === 'local-preview'
                            ? rescheduleMode
                              ? '模擬確認改期'
                              : '模擬確認預約'
                            : rescheduleMode
                              ? '確認改期'
                              : '確認預約'}
                      </button>
                    </div>
                  </div>
                ) : null}
                {appointment !== null && holdPhase === 'confirmed' ? (
                  <div className="merchant-confirmation-ticket" aria-live="polite">
                    <span>CONFIRMED · 預約成立</span>
                    <h3>{formatAppointmentDate(appointment.startAt, appointment.timezone)}</h3>
                    <p>
                      {appointment.service.name} · {appointment.staff.displayName} ·{' '}
                      {formatPrice(appointment)}
                    </p>
                    <address>
                      {appointment.location.postalCode ?? ''} {appointment.location.city}
                      {appointment.location.district}
                      <br />
                      {appointment.location.addressText}
                    </address>
                    <small>預約已建立；此畫面不代表 LINE 通知已送達。</small>
                  </div>
                ) : null}
                {rescheduleResult !== null && hold !== null && holdPhase === 'confirmed' ? (
                  <div className="merchant-confirmation-ticket" aria-live="polite">
                    <span>RESCHEDULED · 改期完成</span>
                    <h3>{formatAppointmentDate(hold.startAt, hold.timezone)}</h3>
                    <p>
                      {hold.service.name} · {hold.staff.displayName} · {formatHoldPrice(hold)}
                    </p>
                    <small>原預約已保留為改期紀錄；此畫面不代表 LINE 通知已送達。</small>
                  </div>
                ) : null}
                {holdMessage === null ? null : (
                  <p
                    className="merchant-hold-message"
                    role={holdPhase === 'error' ? 'alert' : undefined}
                  >
                    {holdMessage}
                  </p>
                )}
              </>
            ) : null}
          </div>
        </div>
      </section>
      <aside className="merchant-booking-bar" aria-label="預約狀態">
        <div>
          <span>LINE-FIRST BOOKING</span>
          <strong>{fixedStatus}</strong>
        </div>
        <a className="merchant-booking-note" href="#availability">
          {holdPhase === 'confirmed'
            ? rescheduleMode
              ? '查看改期結果 ↑'
              : '查看預約 ↑'
            : holdPhase === 'held' || holdPhase === 'confirming'
              ? '查看保留 ↑'
              : '選擇時段 ↑'}
        </a>
      </aside>
    </>
  );
}

export function consumerHoldBlockedLabel(status: ConsumerSessionStatus): string | null {
  switch (status) {
    case 'config-loading':
      return '正在準備 LINE 登入…';
    case 'signing-in':
      return 'LINE 登入中…';
    case 'not-configured':
      return 'LINE 登入尚未設定';
    case 'degraded':
      return '登入服務暫時不可用';
    case 'local-preview':
    case 'signed-out':
    case 'ready':
      return null;
  }
}

export function todayInTimezone(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function formatLocalDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return value;
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatSlotTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function createPreviewResult(
  merchant: PublicMerchantResponse,
  service: PublicMerchantResponse['services'][number],
  staffId: string,
  date: string,
): PublicAvailabilityResponse {
  const staff = merchant.staff.filter(
    (item) => item.serviceIds.includes(service.id) && (staffId.length === 0 || item.id === staffId),
  );
  const eligibleStaffIds = staff.map((item) => item.id);
  const slots = ['11:00', '13:30', '16:00'].map((time) => {
    const startAt = new Date(`${date}T${time}:00+08:00`);
    const endAt = new Date(startAt.getTime() + service.durationMinutes * 60_000);
    return { startAt: startAt.toISOString(), endAt: endAt.toISOString(), eligibleStaffIds };
  });
  return {
    timezone: merchant.location.timezone,
    generatedAt: new Date().toISOString(),
    reservation: false,
    service: { id: service.id, name: service.name, durationMinutes: service.durationMinutes },
    staff: staff.map(({ id, displayName }) => ({ id, displayName })),
    slots,
  };
}

function createPreviewHold(
  merchant: PublicMerchantResponse,
  result: PublicAvailabilityResponse,
  selectedStartAt: string,
  requestedStaffId: string,
): BookingHoldResponse {
  const slot = result.slots.find(({ startAt }) => startAt === selectedStartAt);
  const service = merchant.services.find(({ id }) => id === result.service.id);
  const selectedStaffId =
    requestedStaffId.length > 0 ? requestedStaffId : slot?.eligibleStaffIds[0];
  const staff = merchant.staff.find(({ id }) => id === selectedStaffId);
  if (slot === undefined || service === undefined || staff === undefined) {
    throw new Error('Preview candidate is unavailable.');
  }
  return {
    id: crypto.randomUUID(),
    bookingState: 'HELD',
    status: 'ACTIVE',
    appointmentCreated: false,
    timezone: result.timezone,
    startAt: slot.startAt,
    endAt: slot.endAt,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    policies: {
      version: `v2:${'a'.repeat(64)}`,
      bookingPolicy: merchant.policies.booking,
      cancellationPolicy: merchant.policies.cancellation,
      consumerCancelLeadMinutes: 1_440,
      consumerRescheduleLeadMinutes: 1_440,
      cancelUntil: new Date(new Date(slot.startAt).getTime() - 1_440 * 60_000).toISOString(),
      rescheduleUntil: new Date(new Date(slot.startAt).getTime() - 1_440 * 60_000).toISOString(),
      cancelUntilInclusive: true,
      rescheduleUntilInclusive: true,
    },
    service: {
      id: service.id,
      name: service.name,
      durationMinutes: service.durationMinutes,
      priceType: service.priceType,
      priceAmount: service.priceAmount,
      priceMin: service.priceMin,
      priceMax: service.priceMax,
      currency: service.currency,
    },
    staff: { id: staff.id, displayName: staff.displayName },
  };
}

function createPreviewAppointment(
  merchant: PublicMerchantResponse,
  hold: BookingHoldResponse,
): AppointmentResponse {
  const exact = hold.service.priceType === 'FIXED' ? hold.service.priceAmount : null;
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    appointmentCreated: true,
    status: 'CONFIRMED',
    source: 'MERCHANT_LINK',
    pricingStatus:
      hold.service.priceType === 'FIXED'
        ? 'EXACT'
        : hold.service.priceType === 'QUOTE'
          ? 'QUOTE_REQUIRED'
          : 'ESTIMATE',
    paymentStatus: 'NOT_REQUIRED',
    timezone: hold.timezone,
    startAt: hold.startAt,
    endAt: hold.endAt,
    confirmedAt: now,
    currency: hold.service.currency,
    subtotalAmount: exact,
    depositAmount: 0,
    totalAmount: exact,
    service: hold.service,
    staff: hold.staff,
    policies: { ...hold.policies, acceptedAt: now },
    location: {
      name: merchant.location.name ?? `${merchant.name} 預約地點`,
      addressText: merchant.location.address ?? '台北市大安區預覽路 8 號 2 樓',
      postalCode: merchant.location.postalCode,
      city: merchant.location.city,
      district: merchant.location.district,
    },
  };
}

function formatAppointmentDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: timezone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function formatPrice(appointment: AppointmentResponse): string {
  if (appointment.pricingStatus === 'EXACT' && appointment.totalAmount !== null)
    return `NT$ ${appointment.totalAmount.toLocaleString('zh-TW')}`;
  if (appointment.pricingStatus === 'QUOTE_REQUIRED') return '現場報價';
  if (appointment.service.priceType === 'FROM' && appointment.service.priceAmount !== null)
    return `NT$ ${appointment.service.priceAmount.toLocaleString('zh-TW')} 起`;
  if (appointment.service.priceMin !== null && appointment.service.priceMax !== null)
    return `NT$ ${appointment.service.priceMin.toLocaleString('zh-TW')}–${appointment.service.priceMax.toLocaleString('zh-TW')}`;
  return '價格待確認';
}

function formatConsumerPrice(appointment: ConsumerAppointmentDetail): string {
  if (appointment.pricingStatus === 'EXACT' && appointment.totalAmount !== null)
    return `NT$ ${appointment.totalAmount.toLocaleString('zh-TW')}`;
  if (appointment.pricingStatus === 'QUOTE_REQUIRED') return '現場報價';
  if (appointment.service.priceType === 'FROM' && appointment.service.priceAmount !== null)
    return `NT$ ${appointment.service.priceAmount.toLocaleString('zh-TW')} 起`;
  if (appointment.service.priceMin !== null && appointment.service.priceMax !== null)
    return `NT$ ${appointment.service.priceMin.toLocaleString('zh-TW')}–${appointment.service.priceMax.toLocaleString('zh-TW')}`;
  return '價格待確認';
}

function formatHoldPrice(hold: BookingHoldResponse): string {
  if (hold.service.priceType === 'FIXED' && hold.service.priceAmount !== null)
    return `NT$ ${hold.service.priceAmount.toLocaleString('zh-TW')}`;
  if (hold.service.priceType === 'QUOTE') return '現場報價';
  if (hold.service.priceType === 'FROM' && hold.service.priceAmount !== null)
    return `NT$ ${hold.service.priceAmount.toLocaleString('zh-TW')} 起`;
  if (hold.service.priceMin !== null && hold.service.priceMax !== null)
    return `NT$ ${hold.service.priceMin.toLocaleString('zh-TW')}–${hold.service.priceMax.toLocaleString('zh-TW')}`;
  return '價格待確認';
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function holdErrorMessage(error: unknown): string {
  if (error instanceof StudioApiError) {
    if (error.code === 'slot_no_longer_available') return '這個時段剛被選走，請重新查詢空檔。';
    if (error.status === 429) return '保留操作太頻繁，請稍後再試。';
    if (error.status === 401) return '登入已失效，請重新使用LINE登入。';
    return error.message;
  }
  return '目前無法保留這個時段，原有保留不會被取消。';
}

function confirmationErrorMessage(error: unknown): string {
  if (error instanceof StudioApiError) {
    if (['hold_expired', 'hold_not_active'].includes(error.code))
      return '保留已失效，請重新查詢候選時段。';
    if (error.code === 'policy_version_mismatch') return '政策版本已更新，請重新建立保留後再確認。';
    if (error.code === 'monthly_booking_limit_reached') return '店家目前無法接受更多線上預約。';
    if (error.code === 'consumer_action_deadline_passed')
      return '原預約已超過可自行改期的期限，target時段仍在保留期限內，可先釋放。';
    if (['reschedule_target_mismatch', 'policy_version_mismatch'].includes(error.code))
      return '原預約或政策已更新，請釋放時段並從「我的預約」重新開始。';
    if (['target_hold_expired', 'target_hold_not_active'].includes(error.code))
      return '改期時段的保留已失效，請重新查詢候選時段。';
    if (error.status === 401) return '登入已失效，請重新使用 LINE 登入。';
    if (error.status === 503) return '預約暫時無法建立，保留仍在時效內，可稍後重試。';
    return error.message;
  }
  return '連線未完成，保留仍在時效內，可使用同一畫面重試。';
}

function shouldClearIdempotencyKey(error: unknown): boolean {
  return (
    error instanceof StudioApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 401
  );
}
