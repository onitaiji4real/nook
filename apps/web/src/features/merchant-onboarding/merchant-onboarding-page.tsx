'use client';

import type { MerchantOnboardingRequest, MerchantOnboardingResponse } from '@nook/contracts';
import Link from 'next/link';
import React, { type FormEvent, useEffect, useMemo, useState } from 'react';

import { StudioApiError } from '../studio-session/studio-api-error';
import { useStudioSession } from '../studio-session/studio-session-provider';

const categories = [
  ['NAIL', '美甲'],
  ['LASH', '美睫'],
  ['BROW', '紋繡／眉型'],
  ['BEAUTY', '美容'],
  ['HAIR', '美髮'],
  ['OTHER', '其他'],
] as const;

const initialForm = {
  studioName: '',
  category: 'NAIL',
  description: '',
  phone: '',
  city: '台北市',
  district: '',
  addressText: '',
  isPublicAddress: false,
  serviceName: '',
  durationMinutes: '90',
  bufferAfterMinutes: '15',
  priceAmount: '',
};

type FormState = typeof initialForm;

function Field({
  label,
  name,
  value,
  placeholder,
  type = 'text',
  suffix,
  required = false,
  onChange,
}: {
  readonly label: string;
  readonly name: keyof FormState;
  readonly value: string;
  readonly placeholder?: string;
  readonly type?: 'text' | 'tel' | 'number';
  readonly suffix?: string;
  readonly required?: boolean;
  readonly onChange: (name: keyof FormState, value: string) => void;
}) {
  return (
    <label className="studio-field">
      <span>
        {label} {required ? <em>必填</em> : null}
      </span>
      <span className="studio-input-wrap">
        <input
          name={name}
          type={type}
          value={value}
          placeholder={placeholder}
          required={required}
          min={type === 'number' ? 0 : undefined}
          onChange={(event) => onChange(name, event.target.value)}
        />
        {suffix ? <small>{suffix}</small> : null}
      </span>
    </label>
  );
}

export function MerchantOnboardingPage() {
  const { status, selectedMembership, request } = useStudioSession();
  const [form, setForm] = useState<FormState>(initialForm);
  const [previewed, setPreviewed] = useState(false);
  const [resourceIds, setResourceIds] = useState<{
    readonly locationId: string;
    readonly serviceId: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [remoteMessage, setRemoteMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'ready' || selectedMembership === null) return;
    let active = true;
    setRemoteMessage('正在讀取正式資料…');
    void request<MerchantOnboardingResponse>(
      `/v1/tenants/${selectedMembership.tenantId}/merchant-onboarding`,
    )
      .then((response) => {
        if (!active) return;
        setForm(toFormState(response, selectedMembership.tenantName));
        setResourceIds({
          locationId: response.primaryLocation.id,
          serviceId: response.starterService.id,
        });
        setRemoteMessage('已載入正式資料');
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof StudioApiError && error.status === 404) {
          setForm((current) => ({ ...current, studioName: selectedMembership.tenantName }));
          setRemoteMessage('尚未建立商家資料，儲存後會建立第一版。');
          return;
        }
        setRemoteMessage(error instanceof Error ? error.message : '目前無法讀取正式資料。');
      });
    return () => {
      active = false;
    };
  }, [request, selectedMembership, status]);

  const completed = useMemo(
    () =>
      [form.studioName, form.district, form.addressText, form.serviceName, form.priceAmount].filter(
        Boolean,
      ).length,
    [form],
  );

  const categoryLabel = categories.find(([value]) => value === form.category)?.[1] ?? '美業';

  function updateField(name: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
    setPreviewed(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (status === 'local-preview') {
      setPreviewed(true);
      return;
    }
    if (status !== 'ready' || selectedMembership === null) return;

    setSubmitting(true);
    setRemoteMessage('正在安全儲存…');
    const ids = resourceIds ?? {
      locationId: crypto.randomUUID(),
      serviceId: crypto.randomUUID(),
    };
    const body = toRequest(form, ids);
    try {
      const response = await request<MerchantOnboardingResponse>(
        `/v1/tenants/${selectedMembership.tenantId}/merchant-onboarding`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      setResourceIds({
        locationId: response.primaryLocation.id,
        serviceId: response.starterService.id,
      });
      setPreviewed(true);
      setRemoteMessage('正式資料已儲存');
    } catch (error) {
      setRemoteMessage(error instanceof Error ? error.message : '目前無法儲存，表單仍保留。');
    } finally {
      setSubmitting(false);
    }
  }

  if (!['local-preview', 'ready'].includes(status)) {
    return (
      <main className="studio-home studio-home-locked">
        <p className="studio-eyebrow">STUDIO SESSION REQUIRED</p>
        <h1>先選擇目前店家。</h1>
        <p>正式模式會把這份商家資料寫入選定的tenant；尚未選擇時不會送出。</p>
        <Link className="studio-dark-action" href="/studio">
          回到店務總覽
        </Link>
      </main>
    );
  }

  return (
    <div className="studio-shell">
      <header className="studio-topbar">
        <a className="studio-wordmark" href="/" aria-label="回到 Nook 首頁">
          <span aria-hidden="true">n/</span>
          nook
        </a>
        <div className="studio-context">
          <span>商家設定</span>
          <strong>封閉開發版</strong>
        </div>
        <div className="studio-toplinks">
          <a href="/studio/services">服務目錄</a>
          <a href="/studio/staff">人員班表</a>
          <a href="/studio/portfolio">作品集</a>
          <a className="studio-exit" href="/">
            回服務介紹
          </a>
        </div>
      </header>

      <main className="studio-main">
        <aside className="studio-rail" aria-label="商家建檔進度">
          <p>SETUP / 01</p>
          <h1>先把第一筆預約需要的資料準備好。</h1>
          <ol>
            <li className="active">
              <span>01</span>
              <div>
                <strong>工作室</strong>
                <small>名稱與聯絡方式</small>
              </div>
            </li>
            <li className="active">
              <span>02</span>
              <div>
                <strong>主要據點</strong>
                <small>預設不公開完整地址</small>
              </div>
            </li>
            <li className="active">
              <span>03</span>
              <div>
                <strong>第一項服務</strong>
                <small>時間、緩衝與價格</small>
              </div>
            </li>
          </ol>
          <div className="studio-progress" aria-label={`必填欄位完成 ${completed} / 5`}>
            <span style={{ width: `${(completed / 5) * 100}%` }} />
          </div>
          <small>{completed} / 5 個必填欄位</small>
        </aside>

        <form className="studio-form" onSubmit={(event) => void handleSubmit(event)}>
          <section className="studio-form-section" aria-labelledby="profile-heading">
            <div className="studio-section-number">01</div>
            <div className="studio-fields">
              <div className="studio-section-heading">
                <div>
                  <p>PROFILE</p>
                  <h2 id="profile-heading">你的工作室</h2>
                </div>
                <span>讓顧客認得你</span>
              </div>

              <Field
                label="工作室名稱"
                name="studioName"
                value={form.studioName}
                placeholder="例：好日子美甲"
                required
                onChange={updateField}
              />

              <label className="studio-field">
                <span>
                  主要分類 <em>必填</em>
                </span>
                <select
                  name="category"
                  value={form.category}
                  onChange={(event) => updateField('category', event.target.value)}
                >
                  {categories.map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <Field
                label="聯絡電話"
                name="phone"
                type="tel"
                value={form.phone}
                placeholder="0912-345-678"
                onChange={updateField}
              />

              <label className="studio-field studio-field-wide">
                <span>一句介紹</span>
                <textarea
                  name="description"
                  value={form.description}
                  maxLength={2000}
                  placeholder="你的專長、風格，或希望顧客預約前知道的事。"
                  onChange={(event) => updateField('description', event.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="studio-form-section" aria-labelledby="location-heading">
            <div className="studio-section-number">02</div>
            <div className="studio-fields">
              <div className="studio-section-heading">
                <div>
                  <p>LOCATION</p>
                  <h2 id="location-heading">主要服務地點</h2>
                </div>
                <span>時區固定為台北</span>
              </div>
              <div className="studio-field-pair">
                <Field label="縣市" name="city" value={form.city} required onChange={updateField} />
                <Field
                  label="行政區"
                  name="district"
                  value={form.district}
                  placeholder="例：中山區"
                  required
                  onChange={updateField}
                />
              </div>
              <Field
                label="完整地址"
                name="addressText"
                value={form.addressText}
                placeholder="路名、巷弄、門牌與樓層"
                required
                onChange={updateField}
              />
              <label className="studio-toggle">
                <input
                  name="isPublicAddress"
                  type="checkbox"
                  checked={form.isPublicAddress}
                  onChange={(event) => {
                    setForm((current) => ({
                      ...current,
                      isPublicAddress: event.target.checked,
                    }));
                    setPreviewed(false);
                  }}
                />
                <span aria-hidden="true" />
                <div>
                  <strong>在公開店家頁顯示完整地址</strong>
                  <small>預設關閉。居家工作室可等預約確認後再提供地址。</small>
                </div>
              </label>
            </div>
          </section>

          <section className="studio-form-section" aria-labelledby="service-heading">
            <div className="studio-section-number">03</div>
            <div className="studio-fields">
              <div className="studio-section-heading">
                <div>
                  <p>STARTER SERVICE</p>
                  <h2 id="service-heading">先建立一項服務</h2>
                </div>
                <span>金額以新台幣整數儲存</span>
              </div>
              <Field
                label="服務名稱"
                name="serviceName"
                value={form.serviceName}
                placeholder="例：單色凝膠"
                required
                onChange={updateField}
              />
              <div className="studio-field-trio">
                <Field
                  label="服務時間"
                  name="durationMinutes"
                  type="number"
                  value={form.durationMinutes}
                  suffix="分鐘"
                  required
                  onChange={updateField}
                />
                <Field
                  label="後置緩衝"
                  name="bufferAfterMinutes"
                  type="number"
                  value={form.bufferAfterMinutes}
                  suffix="分鐘"
                  onChange={updateField}
                />
                <Field
                  label="固定價格"
                  name="priceAmount"
                  type="number"
                  value={form.priceAmount}
                  placeholder="1200"
                  suffix="NT$"
                  required
                  onChange={updateField}
                />
              </div>
            </div>
          </section>

          <div className="studio-submit-bar">
            <div>
              <strong>
                {status === 'ready'
                  ? (remoteMessage ?? (previewed ? '正式資料已儲存' : '正式資料尚未儲存'))
                  : previewed
                    ? '本機預覽已更新'
                    : '資料尚未送出'}
              </strong>
              <span>
                {status === 'ready'
                  ? '資料會寫入目前選定的店家；失敗時表單不會被清除。'
                  : '目前只在這個頁面記憶；重新整理即清除。'}
              </span>
            </div>
            <button disabled={submitting} type="submit">
              {submitting
                ? '正在儲存…'
                : status === 'ready'
                  ? '儲存正式資料 ↗'
                  : '更新右側預覽 ↗'}
            </button>
          </div>
        </form>

        <aside className="studio-preview" aria-label="店家頁預覽">
          <div className="studio-preview-status">
            <span /> LIVE PREVIEW
          </div>
          <article className="studio-preview-card">
            <div className="studio-preview-photo">
              <span>{form.studioName.trim().slice(0, 1) || 'N'}</span>
              <small>作品照片將在後續任務開放</small>
            </div>
            <div className="studio-preview-copy">
              <p>
                {categoryLabel} · {form.city || '台灣'}
              </p>
              <h2>{form.studioName || '你的工作室名稱'}</h2>
              <span>{form.description || '一句簡潔介紹，讓顧客快速知道你的風格。'}</span>
              <dl>
                <div>
                  <dt>{form.serviceName || '第一項服務'}</dt>
                  <dd>
                    {form.durationMinutes || '—'} 分鐘 · NT$ {form.priceAmount || '—'}
                  </dd>
                </div>
                <div>
                  <dt>地點</dt>
                  <dd>
                    {form.city} {form.district || '行政區待填'}
                  </dd>
                </div>
              </dl>
              <button type="button" disabled>
                尚未開放預約
              </button>
            </div>
          </article>
          <div className="studio-privacy-note">
            <span aria-hidden="true">⌁</span>
            <p>
              <strong>{form.isPublicAddress ? '公開地址已開啟' : '地址保護中'}</strong>
              {form.isPublicAddress
                ? '公開頁將顯示你填寫的完整地址。'
                : '公開頁只顯示縣市與行政區。'}
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}

function toFormState(response: MerchantOnboardingResponse, tenantName: string): FormState {
  const price = response.starterService.price;
  return {
    studioName: tenantName,
    category: response.profile.category,
    description: response.profile.description ?? '',
    phone: response.profile.phone ?? '',
    city: response.primaryLocation.city,
    district: response.primaryLocation.district,
    addressText: response.primaryLocation.addressText,
    isPublicAddress: response.primaryLocation.isPublicAddress,
    serviceName: response.starterService.name,
    durationMinutes: String(response.starterService.durationMinutes),
    bufferAfterMinutes: String(response.starterService.bufferAfterMinutes),
    priceAmount: price.type === 'FIXED' || price.type === 'FROM' ? String(price.amount) : '',
  };
}

function toRequest(
  form: FormState,
  ids: { readonly locationId: string; readonly serviceId: string },
): MerchantOnboardingRequest {
  return {
    profile: {
      category: form.category as MerchantOnboardingRequest['profile']['category'],
      ...(form.description.trim().length === 0 ? {} : { description: form.description.trim() }),
      ...(form.phone.trim().length === 0 ? {} : { phone: form.phone.trim() }),
    },
    location: {
      id: ids.locationId,
      name: '主要據點',
      addressText: form.addressText.trim(),
      city: form.city.trim(),
      district: form.district.trim(),
      isPublicAddress: form.isPublicAddress,
    },
    service: {
      id: ids.serviceId,
      name: form.serviceName.trim(),
      durationMinutes: Number(form.durationMinutes),
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: Number(form.bufferAfterMinutes),
      price: { type: 'FIXED', amount: Number(form.priceAmount) },
      bookingEnabled: true,
    },
  };
}
