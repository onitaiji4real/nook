'use client';

import type {
  MerchantOnboardingResponse,
  ServiceCatalogResponse,
  StaffAvailabilityItem,
  StaffAvailabilityResponse,
} from '@nook/contracts';
import Link from 'next/link';
import React, { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { useStudioSession } from '../studio-session/studio-session-provider';
import {
  currentTaipeiDate,
  taipeiLocalEpochMillis,
  taipeiLocalToUtcIso,
  utcIsoToTaipeiLocal,
} from './taipei-date-time';

type WeeklyRule = {
  readonly id: string;
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly validFrom: string;
  readonly validUntil: string | null;
};

type ScheduleException = {
  readonly id: string;
  readonly type: 'TIME_OFF' | 'EXTRA_HOURS' | 'BLOCK';
  readonly startAt: string;
  readonly endAt: string;
  readonly reason: string;
  readonly status: 'ACTIVE' | 'CANCELLED';
};

type LocalStaff = {
  readonly id: string;
  readonly displayName: string;
  readonly specialty: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly bookingEnabled: boolean;
  readonly locationId: string;
  readonly serviceIds: readonly string[];
  readonly weeklyRules: readonly WeeklyRule[];
  readonly exceptions: readonly ScheduleException[];
};

const weekdays = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'] as const;
const previewStaffLimit = 1;
const previewValidFrom = '2026-07-22';

const initialStaff: readonly LocalStaff[] = [
  {
    id: 'preview-staff-mia',
    displayName: 'Mia',
    specialty: '單色凝膠・造型設計',
    status: 'ACTIVE',
    bookingEnabled: true,
    locationId: 'preview-location',
    serviceIds: ['preview-service-1'],
    weeklyRules: [
      {
        id: 'rule-1',
        weekday: 1,
        startTime: '10:00',
        endTime: '13:00',
        validFrom: previewValidFrom,
        validUntil: null,
      },
      {
        id: 'rule-2',
        weekday: 1,
        startTime: '14:00',
        endTime: '19:00',
        validFrom: previewValidFrom,
        validUntil: null,
      },
      {
        id: 'rule-3',
        weekday: 3,
        startTime: '11:00',
        endTime: '19:00',
        validFrom: previewValidFrom,
        validUntil: null,
      },
      {
        id: 'rule-4',
        weekday: 4,
        startTime: '10:00',
        endTime: '18:00',
        validFrom: previewValidFrom,
        validUntil: null,
      },
      {
        id: 'rule-5',
        weekday: 6,
        startTime: '10:00',
        endTime: '17:00',
        validFrom: previewValidFrom,
        validUntil: null,
      },
    ],
    exceptions: [
      {
        id: 'exception-1',
        type: 'TIME_OFF',
        startAt: '2026-08-01T10:00',
        endAt: '2026-08-01T14:00',
        reason: '進修課程',
        status: 'ACTIVE',
      },
    ],
  },
  {
    id: 'preview-staff-lin',
    displayName: 'Lin',
    specialty: '卸甲保養・手足護理',
    status: 'INACTIVE',
    bookingEnabled: false,
    locationId: 'preview-location',
    serviceIds: ['preview-service-1'],
    weeklyRules: [
      {
        id: 'rule-6',
        weekday: 2,
        startTime: '12:00',
        endTime: '18:00',
        validFrom: previewValidFrom,
        validUntil: null,
      },
      {
        id: 'rule-7',
        weekday: 5,
        startTime: '12:00',
        endTime: '18:00',
        validFrom: previewValidFrom,
        validUntil: null,
      },
    ],
    exceptions: [],
  },
];

const exceptionLabels = {
  TIME_OFF: '休假',
  EXTRA_HOURS: '加開',
  BLOCK: '保留',
} as const;

function formatDateTime(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (match === null) return value;
  const [, , month = '', day = '', hour = '', minute = ''] = match;
  return `${Number(month)}/${Number(day)} ${hour}:${minute}`;
}

export function StaffSchedulingPage() {
  const { status, selectedMembership, request } = useStudioSession();
  const [staff, setStaff] = useState<readonly LocalStaff[]>(initialStaff);
  const [selectedId, setSelectedId] = useState(initialStaff[0]?.id ?? '');
  const [notice, setNotice] = useState('目前載入本機排班預覽；重新整理即還原。');
  const [exceptionDraft, setExceptionDraft] = useState({
    type: 'TIME_OFF' as ScheduleException['type'],
    startAt: '2026-08-08T10:00',
    endAt: '2026-08-08T12:00',
    reason: '',
  });
  const [staffLimit, setStaffLimit] = useState(previewStaffLimit);
  const [submitting, setSubmitting] = useState(false);
  const [bootstrapRefs, setBootstrapRefs] = useState<{
    readonly locationId: string;
    readonly serviceIds: readonly string[];
  } | null>(null);
  const [firstStaffDraft, setFirstStaffDraft] = useState({ displayName: '', bio: '' });

  const applyResponse = useCallback((response: StaffAvailabilityResponse, preferredId?: string) => {
    const nextStaff = response.staff.map(toLocalStaff);
    setStaff(nextStaff);
    setStaffLimit(response.entitlement.limit);
    setSelectedId(nextStaff.find(({ id }) => id === preferredId)?.id ?? nextStaff[0]?.id ?? '');
  }, []);

  useEffect(() => {
    if (status !== 'ready' || selectedMembership === null) return;
    let active = true;
    setNotice('正在讀取正式人員與班表…');
    void (async () => {
      try {
        const basePath = `/v1/tenants/${selectedMembership.tenantId}`;
        const response = await request<StaffAvailabilityResponse>(`${basePath}/staff`);
        if (!active) return;
        applyResponse(response);
        if (response.staff.length === 0) {
          const [onboarding, services] = await Promise.all([
            request<MerchantOnboardingResponse>(`${basePath}/merchant-onboarding`),
            request<ServiceCatalogResponse>(`${basePath}/services`),
          ]);
          if (!active) return;
          const activeServiceIds = services.services
            .filter((service) => service.status === 'ACTIVE')
            .map(({ id }) => id)
            .slice(0, 1);
          setBootstrapRefs({
            locationId: onboarding.primaryLocation.id,
            serviceIds: activeServiceIds,
          });
          setNotice(
            activeServiceIds.length === 0
              ? '請先啟用至少一項服務，才能建立第一位人員。'
              : '尚未建立服務人員，請完成第一位人員。',
          );
        } else {
          setNotice('已載入正式人員與班表。');
        }
      } catch (error) {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : '目前無法讀取人員與班表。');
      }
    })();
    return () => {
      active = false;
    };
  }, [applyResponse, request, selectedMembership, status]);

  const selected = staff.find(({ id }) => id === selectedId) ?? staff[0];
  const activeCount = staff.filter(({ status }) => status === 'ACTIVE').length;
  const activeExceptionCount =
    selected?.exceptions.filter(({ status }) => status === 'ACTIVE').length ?? 0;
  const weeklyHours = useMemo(() => {
    if (selected === undefined) return 0;
    return selected.weeklyRules.reduce((total, rule) => {
      const [startHour = 0, startMinute = 0] = rule.startTime.split(':').map(Number);
      const [endHour = 0, endMinute = 0] = rule.endTime.split(':').map(Number);
      return total + endHour + endMinute / 60 - startHour - startMinute / 60;
    }, 0);
  }, [selected]);

  function updateSelected(update: (current: LocalStaff) => LocalStaff) {
    setStaff((current) => current.map((item) => (item.id === selectedId ? update(item) : item)));
  }

  function chooseStaff(staffId: string) {
    setSelectedId(staffId);
    setNotice(
      status === 'ready'
        ? '已切換檢視人員。週間修改需按下儲存。'
        : '已切換檢視人員；修改仍只保留在本機。',
    );
  }

  function addShift(weekday: number) {
    updateSelected((current) => ({
      ...current,
      weeklyRules: [
        ...current.weeklyRules,
        {
          id: crypto.randomUUID(),
          weekday,
          startTime: '10:00',
          endTime: '18:00',
          validFrom: currentTaipeiDate(),
          validUntil: null,
        },
      ],
    }));
    setNotice(
      status === 'ready'
        ? `${weekdays[weekday - 1]}已新增一段時段；請儲存週間班表。`
        : `${weekdays[weekday - 1]}已新增一段時段；尚未送至 API。`,
    );
  }

  function updateShift(ruleId: string, field: 'startTime' | 'endTime', value: string) {
    updateSelected((current) => ({
      ...current,
      weeklyRules: current.weeklyRules.map((rule) =>
        rule.id === ruleId ? { ...rule, [field]: value } : rule,
      ),
    }));
    setNotice('本機時段已更新；正式送出前會檢查 15 分鐘格與重疊。');
  }

  function removeShift(ruleId: string) {
    updateSelected((current) => ({
      ...current,
      weeklyRules: current.weeklyRules.filter(({ id }) => id !== ruleId),
    }));
    setNotice(status === 'ready' ? '時段已移除；請儲存週間班表。' : '本機時段已移除。');
  }

  async function saveWeeklySchedule(): Promise<void> {
    if (status !== 'ready' || selectedMembership === null || selected === undefined) return;
    setSubmitting(true);
    try {
      const response = await request<StaffAvailabilityResponse>(
        `/v1/tenants/${selectedMembership.tenantId}/staff/${selected.id}/weekly-schedule`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rules: selected.weeklyRules }),
        },
      );
      applyResponse(response, selected.id);
      setNotice('正式週間班表已儲存。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '目前無法儲存，週間修改仍保留。');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStaffStatus(): Promise<void> {
    if (selected === undefined) return;
    if (selected.status === 'ACTIVE' && activeCount === 1) {
      setNotice('至少要保留一位 ACTIVE 人員，無法停用最後一位。');
      return;
    }
    if (selected.status === 'INACTIVE' && activeCount >= staffLimit) {
      setNotice('已達 MAX_STAFF 上限；目前無法重新啟用。');
      return;
    }
    const nextStatus = selected.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (status === 'ready' && selectedMembership !== null) {
      setSubmitting(true);
      try {
        const response = await request<StaffAvailabilityResponse>(
          `/v1/tenants/${selectedMembership.tenantId}/staff/${selected.id}/status`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: nextStatus }),
          },
        );
        applyResponse(response, selected.id);
        setNotice(nextStatus === 'ACTIVE' ? '正式人員已重新啟用。' : '正式人員已停用。');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '目前無法變更人員狀態。');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    updateSelected((current) => ({
      ...current,
      status: nextStatus,
      bookingEnabled: nextStatus === 'ACTIVE',
    }));
    setNotice(nextStatus === 'ACTIVE' ? '已在本機重新啟用。' : '已在本機停用並關閉接單。');
  }

  async function addException(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const startAt = taipeiLocalEpochMillis(exceptionDraft.startAt);
    const endAt = taipeiLocalEpochMillis(exceptionDraft.endAt);
    const overlaps = selected?.exceptions.some(
      (item) =>
        item.status === 'ACTIVE' &&
        taipeiLocalEpochMillis(item.startAt) < endAt &&
        taipeiLocalEpochMillis(item.endAt) > startAt,
    );
    if (!Number.isFinite(startAt) || startAt >= endAt) {
      setNotice('例外時段的結束時間必須晚於開始時間。');
      return;
    }
    if (overlaps === true) {
      setNotice('這段時間與既有 ACTIVE 例外重疊。');
      return;
    }
    if (status === 'ready' && selectedMembership !== null && selected !== undefined) {
      setSubmitting(true);
      try {
        const response = await request<StaffAvailabilityResponse>(
          `/v1/tenants/${selectedMembership.tenantId}/staff/${selected.id}/exceptions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: crypto.randomUUID(),
              type: exceptionDraft.type,
              startAt: taipeiLocalToUtcIso(exceptionDraft.startAt),
              endAt: taipeiLocalToUtcIso(exceptionDraft.endAt),
              ...(exceptionDraft.reason.trim().length === 0
                ? {}
                : { reason: exceptionDraft.reason.trim() }),
            }),
          },
        );
        applyResponse(response, selected.id);
        setExceptionDraft((current) => ({ ...current, reason: '' }));
        setNotice('正式例外時段已新增；顯示為台北時間。');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '目前無法新增，內容仍保留。');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    updateSelected((current) => ({
      ...current,
      exceptions: [
        ...current.exceptions,
        {
          id: crypto.randomUUID(),
          type: exceptionDraft.type,
          startAt: exceptionDraft.startAt,
          endAt: exceptionDraft.endAt,
          reason: exceptionDraft.reason.trim(),
          status: 'ACTIVE',
        },
      ],
    }));
    setExceptionDraft((current) => ({ ...current, reason: '' }));
    setNotice('本機例外已新增；API 儲存時會轉為 UTC。');
  }

  async function cancelException(exceptionId: string): Promise<void> {
    if (status === 'ready' && selectedMembership !== null && selected !== undefined) {
      setSubmitting(true);
      try {
        const response = await request<StaffAvailabilityResponse>(
          `/v1/tenants/${selectedMembership.tenantId}/staff/${selected.id}/exceptions/${exceptionId}/status`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'CANCELLED' }),
          },
        );
        applyResponse(response, selected.id);
        setNotice('正式例外已取消，紀錄與audit會保留。');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '目前無法取消例外。');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    updateSelected((current) => ({
      ...current,
      exceptions: current.exceptions.map((item) =>
        item.id === exceptionId ? { ...item, status: 'CANCELLED' } : item,
      ),
    }));
    setNotice('例外已在本機取消；正式資料會保留紀錄與 audit。');
  }

  async function createFirstStaff(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (
      status !== 'ready' ||
      selectedMembership === null ||
      bootstrapRefs === null ||
      bootstrapRefs.serviceIds.length === 0
    ) {
      setNotice('請先完成主要據點並啟用至少一項服務。');
      return;
    }
    setSubmitting(true);
    try {
      const response = await request<StaffAvailabilityResponse>(
        `/v1/tenants/${selectedMembership.tenantId}/staff`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            locationId: bootstrapRefs.locationId,
            displayName: firstStaffDraft.displayName.trim(),
            ...(firstStaffDraft.bio.trim().length === 0 ? {} : { bio: firstStaffDraft.bio.trim() }),
            bookingEnabled: true,
            serviceIds: bootstrapRefs.serviceIds,
          }),
        },
      );
      applyResponse(response);
      setNotice('第一位正式服務人員已建立，接著設定週間班表。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '目前無法建立，內容仍保留。');
    } finally {
      setSubmitting(false);
    }
  }

  if (!['local-preview', 'ready'].includes(status)) {
    return (
      <main className="studio-home studio-home-locked">
        <p className="studio-eyebrow">STUDIO SESSION REQUIRED</p>
        <h1>先選擇目前店家。</h1>
        <p>人員、服務綁定與班表都必須寫入同一個tenant，尚未選擇時不會送出。</p>
        <Link className="studio-dark-action" href="/studio">
          回到店務總覽
        </Link>
      </main>
    );
  }

  return (
    <div className="schedule-shell">
      <header className="catalog-topbar schedule-topbar">
        <a className="studio-wordmark" href="/" aria-label="回到 Nook 首頁">
          <span aria-hidden="true">n/</span>
          nook
        </a>
        <nav aria-label="店家後台導覽">
          <a href="/studio/onboarding">店家資料</a>
          <a href="/studio/services">服務目錄</a>
          <a className="active" href="/studio/staff" aria-current="page">
            人員班表
          </a>
          <a href="/studio/portfolio">作品集</a>
        </nav>
        <span className="catalog-beta">
          {status === 'ready' ? 'LIVE TENANT DATA' : 'LOCAL PREVIEW'}
        </span>
      </header>

      <main className="schedule-main">
        <section className="schedule-heading">
          <div>
            <p>SCHEDULING / 03</p>
            <h1>
              把時間畫清楚，
              <em>空檔才可信。</em>
            </h1>
          </div>
          <div className="schedule-stats" aria-label="排班摘要">
            <div>
              <span>WEEKLY HOURS</span>
              <strong>{weeklyHours}</strong>
              <small>小時 / {selected?.displayName}</small>
            </div>
            <div>
              <span>ACTIVE EXCEPTIONS</span>
              <strong>{activeExceptionCount}</strong>
              <small>Asia / Taipei</small>
            </div>
          </div>
        </section>

        <section className="schedule-board">
          <aside className="staff-index" aria-label="服務人員">
            <div className="staff-index-title">
              <span>TEAM INDEX</span>
              <strong>
                {activeCount} / {staffLimit}
              </strong>
              <small>MAX_STAFF · 只計 ACTIVE</small>
            </div>
            <div className="staff-index-list">
              {staff.map((item, index) => (
                <button
                  className={item.id === selected?.id ? 'selected' : ''}
                  type="button"
                  key={item.id}
                  onClick={() => chooseStaff(item.id)}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{item.displayName}</strong>
                    <small>{item.specialty}</small>
                  </div>
                  <i className={item.status.toLowerCase()}>
                    {item.status === 'ACTIVE' ? 'ON' : 'OFF'}
                  </i>
                </button>
              ))}
            </div>
            <div className="staff-status-card">
              <span>SELECTED STAFF</span>
              {selected === undefined && status === 'ready' ? (
                <form onSubmit={(event) => void createFirstStaff(event)}>
                  <strong>建立第一位人員</strong>
                  <label>
                    顯示名稱
                    <input
                      maxLength={120}
                      required
                      value={firstStaffDraft.displayName}
                      onChange={(event) =>
                        setFirstStaffDraft((current) => ({
                          ...current,
                          displayName: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    專長簡介
                    <input
                      maxLength={2000}
                      value={firstStaffDraft.bio}
                      onChange={(event) =>
                        setFirstStaffDraft((current) => ({
                          ...current,
                          bio: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button
                    disabled={submitting || bootstrapRefs?.serviceIds.length === 0}
                    type="submit"
                  >
                    {submitting ? '正在建立…' : '建立正式人員'}
                  </button>
                </form>
              ) : (
                <>
                  <strong>{selected?.displayName}</strong>
                  <p>{selected?.bookingEnabled ? '目前接受預約' : '目前不接受預約'}</p>
                  <button
                    disabled={submitting}
                    type="button"
                    onClick={() => void toggleStaffStatus()}
                  >
                    {selected?.status === 'ACTIVE' ? '停用此人員' : '重新啟用'}
                  </button>
                </>
              )}
            </div>
          </aside>

          <section className="weekly-ledger" aria-labelledby="weekly-heading">
            <div className="schedule-panel-heading">
              <div>
                <span>WEEKLY RULES</span>
                <h2 id="weekly-heading">固定週間</h2>
              </div>
              <div>
                <p>15 分鐘一格 · 可分段 · 不可重疊</p>
                {status === 'ready' && selected !== undefined ? (
                  <button
                    disabled={submitting}
                    onClick={() => void saveWeeklySchedule()}
                    type="button"
                  >
                    {submitting ? '儲存中…' : '儲存週間班表'}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="weekday-list">
              {weekdays.map((label, weekdayIndex) => {
                const weekday = weekdayIndex + 1;
                const rules =
                  selected?.weeklyRules.filter((rule) => rule.weekday === weekday) ?? [];
                return (
                  <div
                    className={rules.length > 0 ? 'weekday-row has-hours' : 'weekday-row'}
                    key={label}
                  >
                    <div className="weekday-label">
                      <span>{weekday}</span>
                      <strong>{label}</strong>
                    </div>
                    <div className="weekday-shifts">
                      {rules.length === 0 ? <em>未排班</em> : null}
                      {rules.map((rule) => (
                        <div className="shift-block" key={rule.id}>
                          <input
                            aria-label={`${label}開始時間`}
                            type="time"
                            step="900"
                            value={rule.startTime}
                            onChange={(event) =>
                              updateShift(rule.id, 'startTime', event.target.value)
                            }
                          />
                          <span>—</span>
                          <input
                            aria-label={`${label}結束時間`}
                            type="time"
                            step="900"
                            value={rule.endTime}
                            onChange={(event) =>
                              updateShift(rule.id, 'endTime', event.target.value)
                            }
                          />
                          <button
                            type="button"
                            aria-label={`移除${label}時段`}
                            onClick={() => removeShift(rule.id)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <button className="add-shift" type="button" onClick={() => addShift(weekday)}>
                      ＋ 時段
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <aside className="exception-desk" aria-labelledby="exception-heading">
            <div className="schedule-panel-heading">
              <div>
                <span>DATE OVERRIDES</span>
                <h2 id="exception-heading">例外時段</h2>
              </div>
              <p>休假、加開或保留</p>
            </div>
            <form className="exception-form" onSubmit={(event) => void addException(event)}>
              <label>
                <span>類型</span>
                <select
                  value={exceptionDraft.type}
                  onChange={(event) =>
                    setExceptionDraft((current) => ({
                      ...current,
                      type: event.target.value as ScheduleException['type'],
                    }))
                  }
                >
                  <option value="TIME_OFF">休假</option>
                  <option value="EXTRA_HOURS">加開</option>
                  <option value="BLOCK">保留</option>
                </select>
              </label>
              <label>
                <span>開始</span>
                <input
                  name="exceptionStart"
                  type="datetime-local"
                  required
                  value={exceptionDraft.startAt}
                  onChange={(event) =>
                    setExceptionDraft((current) => ({ ...current, startAt: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>結束</span>
                <input
                  name="exceptionEnd"
                  type="datetime-local"
                  required
                  value={exceptionDraft.endAt}
                  onChange={(event) =>
                    setExceptionDraft((current) => ({ ...current, endAt: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>備註</span>
                <input
                  name="exceptionReason"
                  maxLength={500}
                  placeholder="選填，不會寫入 log"
                  value={exceptionDraft.reason}
                  onChange={(event) =>
                    setExceptionDraft((current) => ({ ...current, reason: event.target.value }))
                  }
                />
              </label>
              <button disabled={submitting || selected === undefined} type="submit">
                {submitting
                  ? '正在儲存…'
                  : status === 'ready'
                    ? '新增正式例外 ↗'
                    : '新增本機例外 ↗'}
              </button>
            </form>
            <div className="exception-list">
              {selected?.exceptions.length === 0 ? (
                <p className="exception-empty">目前沒有例外時段。</p>
              ) : null}
              {selected?.exceptions.map((item) => (
                <article className={item.status.toLowerCase()} key={item.id}>
                  <div>
                    <span>{exceptionLabels[item.type]}</span>
                    <i>{item.status === 'ACTIVE' ? 'ACTIVE' : 'CANCELLED'}</i>
                  </div>
                  <strong>
                    {formatDateTime(item.startAt)} — {formatDateTime(item.endAt)}
                  </strong>
                  <p>{item.reason || '未填備註'}</p>
                  {item.status === 'ACTIVE' ? (
                    <button
                      disabled={submitting}
                      type="button"
                      onClick={() => void cancelException(item.id)}
                    >
                      取消但保留紀錄
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          </aside>
        </section>

        <div className="schedule-footer-note" role="status" aria-live="polite">
          <strong>{notice}</strong>
          <span>
            {status === 'ready'
              ? '正式操作皆由API驗證RBAC、tenant隔離、MAX_STAFF與UTC例外交易。'
              : 'API已具備RBAC、租戶隔離、MAX_STAFF與UTC例外交易；登入後才會遠端儲存。'}
          </span>
        </div>
      </main>
    </div>
  );
}

function toLocalStaff(item: StaffAvailabilityItem): LocalStaff {
  return {
    id: item.id,
    displayName: item.displayName,
    specialty: item.bio ?? '尚未填寫專長',
    status: item.status,
    bookingEnabled: item.bookingEnabled,
    locationId: item.locationId,
    serviceIds: item.serviceIds,
    weeklyRules: item.weeklyRules,
    exceptions: item.exceptions.map((exception) => ({
      ...exception,
      startAt: utcIsoToTaipeiLocal(exception.startAt),
      endAt: utcIsoToTaipeiLocal(exception.endAt),
      reason: exception.reason ?? '',
    })),
  };
}
