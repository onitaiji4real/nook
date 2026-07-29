'use client';

import type { BookingPolicyResponse, BookingPolicyUpdateRequest } from '@nook/contracts';
import React, { useCallback, useEffect, useState } from 'react';

import { useStudioSession } from '../studio-session/studio-session-provider';

const previewPolicy: BookingPolicyResponse = {
  revision: 1,
  slotIntervalMinutes: 30,
  minimumLeadMinutes: 120,
  maximumAdvanceDays: 60,
  consumerCancelLeadMinutes: 1_440,
  consumerRescheduleLeadMinutes: 1_440,
  updatedAt: '2026-07-23T00:00:00.000Z',
};

export function BookingPolicyPage() {
  const { capabilities, request, selectedMembership: membership, status } = useStudioSession();
  const preview = status === 'local-preview';
  const [policy, setPolicy] = useState<BookingPolicyResponse | null>(null);
  const [draft, setDraft] = useState<BookingPolicyUpdateRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const writable =
    preview ||
    (capabilities.bookingPolicyV2Writes &&
      (membership?.role === 'OWNER' || membership?.role === 'MANAGER'));

  const load = useCallback(async () => {
    if (!preview && (status !== 'ready' || membership === null)) return;
    setLoading(true);
    setMessage(null);
    try {
      const value = preview
        ? previewPolicy
        : await request<BookingPolicyResponse>(
            `/v1/tenants/${membership!.tenantId}/booking-policy`,
            {
              cache: 'no-store',
            },
          );
      setPolicy(value);
      setDraft(toDraft(value));
    } catch {
      setMessage('目前讀不到預約規則，請稍後重試。');
    } finally {
      setLoading(false);
    }
  }, [membership, preview, request, status]);

  useEffect(() => void load(), [load]);

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (draft === null || policy === null || !writable) return;
    setSaving(true);
    setMessage(null);
    try {
      const value = preview
        ? { ...draft, revision: policy.revision + 1, updatedAt: new Date().toISOString() }
        : await request<BookingPolicyResponse>(
            `/v1/tenants/${membership!.tenantId}/booking-policy`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(draft),
            },
          );
      setPolicy(value);
      setDraft(toDraft(value));
      setMessage(
        preview
          ? '預覽已更新；重新整理後會恢復，不會寫入資料庫。'
          : '預約規則已更新。新建立的預約會套用新版本。',
      );
    } catch {
      setMessage('儲存沒有完成，可能已有其他人更新；已重新讀取最新版本。');
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (['config-loading', 'account-loading'].includes(status)) {
    return <main className="booking-policy-page booking-policy-gate">正在準備預約規則…</main>;
  }
  if (!preview && status !== 'ready') {
    return (
      <main className="booking-policy-page booking-policy-gate">
        <p className="studio-eyebrow">BOOKING RULES</p>
        <h1>先登入並選擇一家店。</h1>
        <a className="studio-dark-action" href="/studio">
          回到總覽
        </a>
      </main>
    );
  }

  return (
    <main className="booking-policy-page">
      <header className="booking-policy-hero">
        <div>
          <p className="studio-eyebrow">BOOKING RULES · ASIA/TAIPEI</p>
          <h1>
            把可以預約的界線，<em>說清楚。</em>
          </h1>
        </div>
        <p>規則會在顧客保留時段時快照保存；修改不會倒推改變既有預約。</p>
      </header>

      {message === null ? null : (
        <p className="booking-policy-message" role="status">
          {message}
        </p>
      )}
      {loading || draft === null || policy === null ? (
        <section className="booking-policy-form">正在讀取…</section>
      ) : (
        <form className="booking-policy-form" onSubmit={(event) => void save(event)}>
          <div className="booking-policy-meta">
            <strong>REVISION {policy.revision}</strong>
            <span>
              更新：
              {new Intl.DateTimeFormat('zh-TW', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Taipei',
              }).format(new Date(policy.updatedAt))}
            </span>
          </div>
          <PolicySelect
            disabled={!writable || saving}
            label="時段切分（分鐘）"
            value={draft.slotIntervalMinutes}
            onChange={(value) =>
              setDraft({
                ...draft,
                slotIntervalMinutes: value as BookingPolicyUpdateRequest['slotIntervalMinutes'],
              })
            }
          />
          <PolicyNumber
            disabled={!writable || saving}
            label="最晚須提前預約（分鐘）"
            help="0 代表可預約立即開始的時段。"
            min={0}
            max={10_080}
            value={draft.minimumLeadMinutes}
            onChange={(value) => setDraft({ ...draft, minimumLeadMinutes: value })}
          />
          <PolicyNumber
            disabled={!writable || saving}
            label="最遠可預約（天）"
            help="至少 1 天，最多 365 天。"
            min={1}
            max={365}
            value={draft.maximumAdvanceDays}
            onChange={(value) => setDraft({ ...draft, maximumAdvanceDays: value })}
          />
          <PolicyNumber
            disabled={!writable || saving}
            label="顧客取消須提前（分鐘）"
            help="0 代表開始時間前仍可取消；最多 30 天。"
            min={0}
            max={43_200}
            value={draft.consumerCancelLeadMinutes}
            onChange={(value) => setDraft({ ...draft, consumerCancelLeadMinutes: value })}
          />
          <PolicyNumber
            disabled={!writable || saving}
            label="顧客改期須提前（分鐘）"
            help="0 代表開始時間前仍可改期；最多 30 天。"
            min={0}
            max={43_200}
            value={draft.consumerRescheduleLeadMinutes}
            onChange={(value) => setDraft({ ...draft, consumerRescheduleLeadMinutes: value })}
          />
          <footer>
            {!writable ? (
              <p>
                {!preview && !capabilities.bookingPolicyV2Writes
                  ? '預約規則新版寫入功能尚未啟用，目前只能查看。'
                  : '你的角色可以查看規則，但只有店主或管理員可以修改。'}
              </p>
            ) : (
              <p>儲存時會檢查 revision，避免覆蓋其他管理員剛完成的變更。</p>
            )}
            <button disabled={!writable || saving} type="submit">
              {saving ? '儲存中…' : '儲存新版本'}
            </button>
          </footer>
        </form>
      )}
    </main>
  );
}

function toDraft(policy: BookingPolicyResponse): BookingPolicyUpdateRequest {
  return {
    expectedRevision: policy.revision,
    slotIntervalMinutes: policy.slotIntervalMinutes,
    minimumLeadMinutes: policy.minimumLeadMinutes,
    maximumAdvanceDays: policy.maximumAdvanceDays,
    consumerCancelLeadMinutes: policy.consumerCancelLeadMinutes,
    consumerRescheduleLeadMinutes: policy.consumerRescheduleLeadMinutes,
  };
}

function PolicyNumber({
  disabled,
  help,
  label,
  max,
  min,
  onChange,
  value,
}: {
  readonly disabled: boolean;
  readonly help: string;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onChange: (value: number) => void;
  readonly value: number;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        required
        step="1"
        type="number"
        value={value}
      />
      <small>{help}</small>
    </label>
  );
}

function PolicySelect({
  disabled,
  label,
  onChange,
  value,
}: {
  readonly disabled: boolean;
  readonly label: string;
  readonly onChange: (value: number) => void;
  readonly value: number;
}) {
  return (
    <label>
      <span>{label}</span>
      <select
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        value={value}
      >
        {[5, 10, 15, 20, 30, 60].map((option) => (
          <option key={option} value={option}>
            {option} 分鐘
          </option>
        ))}
      </select>
      <small>可預約時間會依這個間隔產生。</small>
    </label>
  );
}
