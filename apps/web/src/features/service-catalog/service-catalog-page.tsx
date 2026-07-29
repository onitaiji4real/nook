'use client';

import type { ServiceCatalogItem, ServiceCatalogResponse } from '@nook/contracts';
import Link from 'next/link';
import React, { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { useStudioSession } from '../studio-session/studio-session-provider';

type LocalService = {
  readonly id: string;
  readonly name: string;
  readonly durationMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly priceAmount: number | null;
  readonly priceLabel: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly bookingEnabled: boolean;
};

type Draft = {
  readonly name: string;
  readonly durationMinutes: string;
  readonly bufferAfterMinutes: string;
  readonly priceAmount: string;
};

const previewServiceLimit = 5;
const initialServices: readonly LocalService[] = [
  {
    id: 'preview-service-1',
    name: '單色凝膠',
    durationMinutes: 90,
    bufferAfterMinutes: 15,
    priceAmount: 1200,
    priceLabel: 'NT$ 1,200',
    status: 'ACTIVE',
    bookingEnabled: true,
  },
  {
    id: 'preview-service-2',
    name: '造型凝膠',
    durationMinutes: 120,
    bufferAfterMinutes: 15,
    priceAmount: 1800,
    priceLabel: 'NT$ 1,800',
    status: 'ACTIVE',
    bookingEnabled: true,
  },
  {
    id: 'preview-service-3',
    name: '卸甲保養',
    durationMinutes: 45,
    bufferAfterMinutes: 10,
    priceAmount: 600,
    priceLabel: 'NT$ 600',
    status: 'INACTIVE',
    bookingEnabled: false,
  },
];

function toDraft(service: LocalService): Draft {
  return {
    name: service.name,
    durationMinutes: String(service.durationMinutes),
    bufferAfterMinutes: String(service.bufferAfterMinutes),
    priceAmount: service.priceAmount === null ? '' : String(service.priceAmount),
  };
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat('zh-TW').format(amount);
}

export function ServiceCatalogPage() {
  const { status, selectedMembership, request } = useStudioSession();
  const [services, setServices] = useState<readonly LocalService[]>(initialServices);
  const [selectedId, setSelectedId] = useState(initialServices[0]?.id ?? '');
  const [draft, setDraft] = useState<Draft>(toDraft(initialServices[0] as LocalService));
  const [mode, setMode] = useState<'edit' | 'new'>('edit');
  const [notice, setNotice] = useState('目前載入的是預覽資料，重新整理即還原。');
  const [showInactive, setShowInactive] = useState(true);
  const [serviceLimit, setServiceLimit] = useState(previewServiceLimit);
  const [submitting, setSubmitting] = useState(false);

  const applyResponse = useCallback((response: ServiceCatalogResponse) => {
    const nextServices = response.services.map(toLocalService);
    setServices(nextServices);
    setServiceLimit(response.entitlement.limit);
    const selected = nextServices[0];
    setSelectedId(selected?.id ?? '');
    if (selected !== undefined) setDraft(toDraft(selected));
  }, []);

  useEffect(() => {
    if (status !== 'ready' || selectedMembership === null) return;
    let active = true;
    setNotice('正在讀取正式服務目錄…');
    void request<ServiceCatalogResponse>(`/v1/tenants/${selectedMembership.tenantId}/services`)
      .then((response) => {
        if (!active) return;
        applyResponse(response);
        setNotice('已載入正式服務目錄。');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : '目前無法讀取服務目錄。');
      });
    return () => {
      active = false;
    };
  }, [applyResponse, request, selectedMembership, status]);

  const activeCount = services.filter(({ status }) => status === 'ACTIVE').length;
  const visibleServices = useMemo(
    () => services.filter(({ status }) => showInactive || status === 'ACTIVE'),
    [services, showInactive],
  );
  const selected = services.find(({ id }) => id === selectedId) ?? services[0];

  function chooseService(service: LocalService) {
    setSelectedId(service.id);
    setDraft(toDraft(service));
    setMode('edit');
    setNotice('資料尚未送出。');
  }

  function startNew() {
    if (activeCount >= serviceLimit) {
      setNotice('已達 MAX_SERVICES 上限；可先停用一項服務。');
      return;
    }
    setDraft({ name: '', durationMinutes: '60', bufferAfterMinutes: '15', priceAmount: '' });
    setMode('new');
    setNotice('新增項目只會保留在本機預覽。');
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalized = {
      name: draft.name.trim(),
      durationMinutes: Number(draft.durationMinutes),
      bufferAfterMinutes: Number(draft.bufferAfterMinutes),
      priceAmount: Number(draft.priceAmount),
    };
    if (
      normalized.name.length === 0 ||
      normalized.durationMinutes < 5 ||
      normalized.priceAmount < 0
    ) {
      setNotice('請確認服務名稱、時間與價格。');
      return;
    }

    if (status === 'local-preview' && mode === 'new') {
      const created: LocalService = {
        id: `preview-service-${crypto.randomUUID()}`,
        ...normalized,
        priceLabel: `NT$ ${formatMoney(normalized.priceAmount)}`,
        status: 'ACTIVE',
        bookingEnabled: true,
      };
      setServices((current) => [...current, created]);
      setSelectedId(created.id);
      setDraft(toDraft(created));
      setMode('edit');
      setNotice('本機服務已新增；登入串接後才會遠端儲存。');
      return;
    }

    if (mode === 'edit' && selected === undefined) return;
    if (status === 'ready' && selectedMembership !== null) {
      setSubmitting(true);
      try {
        const basePath = `/v1/tenants/${selectedMembership.tenantId}/services`;
        const response = await request<ServiceCatalogResponse>(
          mode === 'new' ? basePath : `${basePath}/${selected?.id ?? ''}`,
          {
            method: mode === 'new' ? 'POST' : 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...(mode === 'new' ? { id: crypto.randomUUID() } : {}),
              name: normalized.name,
              durationMinutes: normalized.durationMinutes,
              bufferBeforeMinutes: 0,
              bufferAfterMinutes: normalized.bufferAfterMinutes,
              price: { type: 'FIXED', amount: normalized.priceAmount },
              bookingEnabled: true,
            }),
          },
        );
        applyResponse(response);
        setMode('edit');
        setNotice(mode === 'new' ? '正式服務已新增。' : '正式服務已更新。');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '目前無法儲存，編輯內容仍保留。');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (selected === undefined) return;
    setServices((current) =>
      current.map((service) =>
        service.id === selected.id
          ? {
              ...service,
              ...normalized,
              priceLabel: `NT$ ${formatMoney(normalized.priceAmount)}`,
            }
          : service,
      ),
    );
    setNotice('本機服務已更新；尚未送至 API。');
  }

  async function toggleStatus(service: LocalService): Promise<void> {
    if (service.status === 'ACTIVE' && activeCount === 1) {
      setNotice('至少要保留一項 ACTIVE 服務。');
      return;
    }
    if (service.status === 'INACTIVE' && activeCount >= serviceLimit) {
      setNotice('已達 MAX_SERVICES 上限，無法重新啟用。');
      return;
    }
    const nextStatus = service.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (status === 'ready' && selectedMembership !== null) {
      setSubmitting(true);
      try {
        const response = await request<ServiceCatalogResponse>(
          `/v1/tenants/${selectedMembership.tenantId}/services/${service.id}/status`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: nextStatus }),
          },
        );
        applyResponse(response);
        setNotice(nextStatus === 'ACTIVE' ? '正式服務已重新啟用。' : '正式服務已停用。');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '目前無法變更狀態。');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setServices((current) =>
      current.map((item) =>
        item.id === service.id
          ? { ...item, status: nextStatus, bookingEnabled: nextStatus === 'ACTIVE' }
          : item,
      ),
    );
    setNotice(nextStatus === 'ACTIVE' ? '已在本機重新啟用。' : '已在本機停用並保留資料。');
  }

  async function move(serviceId: string, direction: -1 | 1): Promise<void> {
    const next = reorderServices(services, serviceId, direction);
    if (next === services) return;
    if (status === 'ready' && selectedMembership !== null) {
      setSubmitting(true);
      try {
        const response = await request<ServiceCatalogResponse>(
          `/v1/tenants/${selectedMembership.tenantId}/services/order`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serviceIds: next.map(({ id }) => id) }),
          },
        );
        applyResponse(response);
        setNotice('正式服務排序已更新。');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '目前無法更新排序。');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setServices(next);
    setNotice('本機排序已更新。');
  }

  if (!['local-preview', 'ready'].includes(status)) {
    return (
      <main className="studio-home studio-home-locked">
        <p className="studio-eyebrow">STUDIO SESSION REQUIRED</p>
        <h1>先選擇目前店家。</h1>
        <p>服務目錄會套用選定tenant的額度與權限，尚未選擇時不會送出。</p>
        <Link className="studio-dark-action" href="/studio">
          回到店務總覽
        </Link>
      </main>
    );
  }

  return (
    <div className="catalog-shell">
      <header className="catalog-topbar">
        <a className="studio-wordmark" href="/" aria-label="回到 Nook 首頁">
          <span aria-hidden="true">n/</span>
          nook
        </a>
        <nav aria-label="店家後台導覽">
          <a href="/studio/onboarding">店家資料</a>
          <a className="active" href="/studio/services" aria-current="page">
            服務目錄
          </a>
          <a href="/studio/staff">人員班表</a>
          <a href="/studio/portfolio">作品集</a>
        </nav>
        <span className="catalog-beta">
          {status === 'ready' ? 'LIVE TENANT DATA' : 'LOCAL PREVIEW'}
        </span>
      </header>

      <main className="catalog-main">
        <section className="catalog-heading">
          <div>
            <p>CATALOG / 02</p>
            <h1>
              把服務排好，
              <em>預約才算得準。</em>
            </h1>
          </div>
          <div
            className="catalog-entitlement"
            aria-label={`啟用服務 ${activeCount} / ${serviceLimit}`}
          >
            <span>MAX_SERVICES</span>
            <strong>
              {activeCount}
              <small> / {serviceLimit}</small>
            </strong>
            <div>
              {Array.from({ length: serviceLimit }, (_, index) => (
                <i className={index < activeCount ? 'filled' : ''} key={index} />
              ))}
            </div>
            <small>只計算 ACTIVE 服務</small>
          </div>
        </section>

        <section className="catalog-workbench">
          <div className="catalog-list-panel">
            <div className="catalog-toolbar">
              <div>
                <strong>服務項目</strong>
                <span>
                  {services.length} 筆資料 · {activeCount} 筆啟用
                </span>
              </div>
              <div className="catalog-toolbar-actions">
                <label>
                  <input
                    type="checkbox"
                    checked={showInactive}
                    onChange={(event) => setShowInactive(event.target.checked)}
                  />
                  顯示停用
                </label>
                <button type="button" onClick={startNew} disabled={activeCount >= serviceLimit}>
                  ＋ 新增服務
                </button>
              </div>
            </div>

            <ol className="catalog-list">
              {visibleServices.map((service) => {
                const absoluteIndex = services.findIndex(({ id }) => id === service.id);
                return (
                  <li
                    className={selectedId === service.id && mode === 'edit' ? 'selected' : ''}
                    key={service.id}
                  >
                    <button
                      className="catalog-service-main"
                      type="button"
                      onClick={() => chooseService(service)}
                    >
                      <span className="catalog-drag" aria-hidden="true">
                        ⋮⋮
                      </span>
                      <span className="catalog-order">
                        {String(absoluteIndex + 1).padStart(2, '0')}
                      </span>
                      <span className="catalog-service-copy">
                        <strong>{service.name}</strong>
                        <small>
                          {service.durationMinutes} 分鐘 · 緩衝 {service.bufferAfterMinutes} 分鐘
                        </small>
                      </span>
                      <span className="catalog-price">{service.priceLabel}</span>
                      <span className={`catalog-status ${service.status.toLowerCase()}`}>
                        {service.status === 'ACTIVE' ? '啟用' : '停用'}
                      </span>
                    </button>
                    <div className="catalog-row-actions">
                      <button
                        type="button"
                        aria-label={`上移 ${service.name}`}
                        disabled={absoluteIndex === 0}
                        onClick={() => void move(service.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`下移 ${service.name}`}
                        disabled={absoluteIndex === services.length - 1}
                        onClick={() => void move(service.id, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <aside className="catalog-editor" aria-label={mode === 'new' ? '新增服務' : '編輯服務'}>
            <div className="catalog-editor-topline">
              <span>{mode === 'new' ? 'NEW ENTRY' : 'EDIT ENTRY'}</span>
              {mode === 'edit' && selected ? (
                <button
                  disabled={submitting}
                  type="button"
                  onClick={() => void toggleStatus(selected)}
                >
                  {selected.status === 'ACTIVE' ? '停用此服務' : '重新啟用'}
                </button>
              ) : null}
            </div>
            <h2>{mode === 'new' ? '新增一項服務' : selected?.name}</h2>
            <form onSubmit={(event) => void submitDraft(event)}>
              <label>
                <span>服務名稱</span>
                <input
                  name="catalogServiceName"
                  required
                  value={draft.name}
                  placeholder="例：日式自然款"
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
              <div className="catalog-editor-grid">
                <label>
                  <span>服務時間</span>
                  <input
                    name="catalogDuration"
                    type="number"
                    min="5"
                    max="720"
                    required
                    value={draft.durationMinutes}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, durationMinutes: event.target.value }))
                    }
                  />
                  <small>分鐘</small>
                </label>
                <label>
                  <span>後置緩衝</span>
                  <input
                    name="catalogBuffer"
                    type="number"
                    min="0"
                    max="180"
                    value={draft.bufferAfterMinutes}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        bufferAfterMinutes: event.target.value,
                      }))
                    }
                  />
                  <small>分鐘</small>
                </label>
              </div>
              <label>
                <span>固定價格</span>
                <input
                  name="catalogPrice"
                  type="number"
                  min="0"
                  max="10000000"
                  required
                  value={draft.priceAmount}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, priceAmount: event.target.value }))
                  }
                />
                <small>NT$</small>
              </label>
              <button className="catalog-save" disabled={submitting} type="submit">
                {submitting
                  ? '正在儲存…'
                  : mode === 'new'
                    ? status === 'ready'
                      ? '新增正式服務'
                      : '加入本機目錄'
                    : status === 'ready'
                      ? '更新正式服務'
                      : '更新本機預覽'}{' '}
                ↗
              </button>
            </form>
            <p className="catalog-notice" role="status">
              {notice}
            </p>
            <div className="catalog-api-note">
              <strong>{status === 'ready' ? '正式儲存已啟用' : '正式儲存已準備好'}</strong>
              <p>
                {status === 'ready'
                  ? '所有操作都會帶入目前tenant並由API執行RBAC、隔離與額度交易。'
                  : '登入後才會送出API；目前只更新本分頁預覽。'}
              </p>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

function toLocalService(service: ServiceCatalogItem): LocalService {
  const price = service.price;
  return {
    id: service.id,
    name: service.name,
    durationMinutes: service.durationMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes,
    priceAmount: price.type === 'FIXED' || price.type === 'FROM' ? price.amount : null,
    priceLabel: formatServicePrice(price),
    status: service.status,
    bookingEnabled: service.bookingEnabled,
  };
}

function formatServicePrice(price: ServiceCatalogItem['price']): string {
  switch (price.type) {
    case 'FIXED':
      return `NT$ ${formatMoney(price.amount)}`;
    case 'FROM':
      return `NT$ ${formatMoney(price.amount)} 起`;
    case 'RANGE':
      return `NT$ ${formatMoney(price.min)}–${formatMoney(price.max)}`;
    case 'QUOTE':
      return '依項目報價';
  }
}

function reorderServices(
  services: readonly LocalService[],
  serviceId: string,
  direction: -1 | 1,
): readonly LocalService[] {
  const index = services.findIndex(({ id }) => id === serviceId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= services.length) return services;
  const next = [...services];
  const [service] = next.splice(index, 1);
  if (service === undefined) return services;
  next.splice(target, 0, service);
  return next;
}
