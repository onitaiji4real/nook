'use client';

import type {
  PortfolioItemResponse,
  PortfolioResponse,
  PortfolioUploadIntentResponse,
} from '@nook/contracts';
import Link from 'next/link';
import React, { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';

import { useStudioSession } from '../studio-session/studio-session-provider';

type PortfolioStatus = 'READY' | 'PENDING' | 'REJECTED' | 'LOCAL';

type LocalPortfolioItem = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly status: PortfolioStatus;
  readonly publicationStatus: 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
  readonly visual: 'chrome' | 'coral' | 'ink' | 'pearl' | 'photo';
  readonly imageUrl?: string;
  readonly fileLabel?: string;
};

const previewPortfolioLimit = 20;

const initialItems: readonly LocalPortfolioItem[] = [
  {
    id: 'portfolio-01',
    title: '鏡面銀・短甲',
    description: '俐落方圓甲型，冷銀鏡面搭配單指透明立體線。',
    tags: ['鏡面', '短甲', '銀色'],
    status: 'READY',
    publicationStatus: 'PUBLISHED',
    visual: 'chrome',
  },
  {
    id: 'portfolio-02',
    title: '珊瑚暈染',
    description: '低飽和珊瑚與乳白暈染，適合日常與婚禮賓客。',
    tags: ['暈染', '珊瑚', '婚禮'],
    status: 'READY',
    publicationStatus: 'DRAFT',
    visual: 'coral',
  },
  {
    id: 'portfolio-03',
    title: '墨線微法式',
    description: '透明底搭配不規則墨線，保留大量裸甲呼吸感。',
    tags: ['法式', '線條'],
    status: 'PENDING',
    publicationStatus: 'DRAFT',
    visual: 'ink',
  },
  {
    id: 'portfolio-04',
    title: '珍珠光裸粉',
    description: '薄透裸粉疊加細緻珍珠光，手部顯白。',
    tags: ['裸粉', '珍珠'],
    status: 'REJECTED',
    publicationStatus: 'HIDDEN',
    visual: 'pearl',
  },
];

const statusLabels: Record<PortfolioStatus, string> = {
  READY: '已驗證',
  PENDING: '待處理',
  REJECTED: '需重傳',
  LOCAL: '本機新增',
};

export function PortfolioPage() {
  const { status, selectedMembership, request } = useStudioSession();
  const [items, setItems] = useState<readonly LocalPortfolioItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState(initialItems[0]?.id ?? '');
  const [notice, setNotice] = useState('目前載入本機作品預覽；重新整理即還原。');
  const [portfolioLimit, setPortfolioLimit] = useState(previewPortfolioLimit);
  const [entitlementUsed, setEntitlementUsed] = useState(initialItems.length);
  const [submitting, setSubmitting] = useState(false);
  const objectUrls = useRef<string[]>([]);

  const applyResponse = useCallback((response: PortfolioResponse, preferredId?: string) => {
    const nextItems = response.items.map(toLocalPortfolioItem);
    setItems(nextItems);
    setPortfolioLimit(response.entitlement.limit);
    setEntitlementUsed(response.entitlement.used);
    setSelectedId(nextItems.find(({ id }) => id === preferredId)?.id ?? nextItems[0]?.id ?? '');
  }, []);

  useEffect(() => {
    if (status !== 'ready' || selectedMembership === null) return;
    let active = true;
    setNotice('正在讀取正式作品資料…');
    void request<PortfolioResponse>(`/v1/tenants/${selectedMembership.tenantId}/portfolio`)
      .then((response) => {
        if (!active) return;
        applyResponse(response);
        setNotice('已載入正式作品資料。');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : '目前無法讀取作品資料。');
      });
    return () => {
      active = false;
    };
  }, [applyResponse, request, selectedMembership, status]);

  useEffect(
    () => () => {
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  const selected = items.find(({ id }) => id === selectedId) ?? items[0];
  const readyCount = items.filter(({ status }) => status === 'READY').length;
  const pendingCount = items.filter(({ status }) => status === 'PENDING').length;
  const displayedUsage = status === 'ready' ? entitlementUsed : items.length;

  function selectItem(id: string) {
    setSelectedId(id);
    setNotice(
      status === 'ready'
        ? '已切換正式作品；文字修改需按下儲存。'
        : '已切換作品；修改仍只保留在本機 React memory。',
    );
  }

  function updateSelected(
    patch: Partial<Pick<LocalPortfolioItem, 'title' | 'description' | 'tags'>>,
  ) {
    setItems((current) =>
      current.map((item) => (item.id === selectedId ? { ...item, ...patch } : item)),
    );
    setNotice(
      status === 'ready'
        ? '作品文字已修改；請儲存作品資料。'
        : '作品文字已在本機更新；尚未送至受保護 API。',
    );
  }

  async function addFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setNotice('只接受 JPEG、PNG 或 WebP；SVG、HEIC 與動畫圖第一版會拒絕。');
      return;
    }
    if (file.size < 1 || file.size > 15 * 1024 * 1024) {
      setNotice('圖片必須小於 15 MiB；目前沒有送出任何檔案。');
      return;
    }
    if (displayedUsage >= portfolioLimit) {
      setNotice('已達 MAX_PORTFOLIO_IMAGES 上限，無法新增。');
      return;
    }
    const imageUrl = URL.createObjectURL(file);
    objectUrls.current.push(imageUrl);
    const id = crypto.randomUUID();
    const title = file.name.replace(/\.[^.]+$/, '').slice(0, 160) || '未命名作品';
    const item: LocalPortfolioItem = {
      id,
      title,
      description: '',
      tags: [],
      status: 'LOCAL',
      publicationStatus: 'DRAFT',
      visual: 'photo',
      imageUrl,
      fileLabel: `${file.type} · ${(file.size / 1024 / 1024).toFixed(2)} MiB`,
    };
    setItems((current) => [...current, item]);
    setSelectedId(id);
    if (status !== 'ready' || selectedMembership === null) {
      setNotice('圖片只在此分頁預覽，未上傳 GCS；正式登入後才會取得15分鐘signed policy。');
      return;
    }

    setSubmitting(true);
    setNotice('正在取得受控上傳授權…');
    try {
      const basePath = `/v1/tenants/${selectedMembership.tenantId}/portfolio`;
      const mediaAssetId = crypto.randomUUID();
      const intent = await request<PortfolioUploadIntentResponse>(`${basePath}/upload-intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioItemId: id,
          mediaAssetId,
          title,
          tags: [],
          mimeType: file.type,
          byteSize: file.size,
        }),
      });
      const uploadBody = new FormData();
      for (const [name, value] of Object.entries(intent.upload.fields)) {
        uploadBody.append(name, value);
      }
      uploadBody.append('file', file);
      const uploadResponse = await fetch(intent.upload.url, { method: 'POST', body: uploadBody });
      if (!uploadResponse.ok) {
        throw new Error('圖片傳輸未完成，沒有建立可發布作品。');
      }
      await request(`${basePath}/media/${intent.upload.mediaAssetId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const response = await request<PortfolioResponse>(basePath);
      applyResponse(response, id);
      setNotice('圖片已送入私有驗證流程；READY前不會公開。');
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `${error.message} 本機預覽仍保留，可稍後重新選擇檔案。`
          : '目前無法上傳，本機預覽仍保留。',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function saveMetadata(): Promise<void> {
    if (status !== 'ready' || selectedMembership === null || selected === undefined) return;
    if (selected.status === 'LOCAL') {
      setNotice('這張圖片尚未進入正式流程，請重新選擇檔案後再儲存。');
      return;
    }
    setSubmitting(true);
    try {
      const response = await request<PortfolioResponse>(
        `/v1/tenants/${selectedMembership.tenantId}/portfolio/${selected.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: selected.title.trim(),
            description:
              selected.description.trim().length === 0 ? null : selected.description.trim(),
            tags: selected.tags,
          }),
        },
      );
      applyResponse(response, selected.id);
      setNotice('正式作品資料已儲存。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '目前無法儲存，修改仍保留。');
    } finally {
      setSubmitting(false);
    }
  }

  async function changePublicationStatus(): Promise<void> {
    if (
      status !== 'ready' ||
      selectedMembership === null ||
      selected === undefined ||
      selected.status === 'LOCAL'
    ) {
      return;
    }
    const nextStatus = selected.publicationStatus === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
    setSubmitting(true);
    try {
      await request(
        `/v1/tenants/${selectedMembership.tenantId}/publication/portfolio/${selected.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      const response = await request<PortfolioResponse>(
        `/v1/tenants/${selectedMembership.tenantId}/portfolio`,
      );
      applyResponse(response, selected.id);
      setNotice(nextStatus === 'PUBLISHED' ? '作品已納入公開頁。' : '作品已從公開頁撤下。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '目前無法變更作品發布狀態。');
    } finally {
      setSubmitting(false);
    }
  }

  async function moveSelected(direction: -1 | 1): Promise<void> {
    const index = items.findIndex(({ id }) => id === selectedId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(target, 0, item);
    if (status === 'ready' && selectedMembership !== null) {
      if (next.some(({ status: itemStatus }) => itemStatus === 'LOCAL')) {
        setNotice('請先完成或移除尚未上傳的本機圖片，再調整正式排序。');
        return;
      }
      setSubmitting(true);
      try {
        const response = await request<PortfolioResponse>(
          `/v1/tenants/${selectedMembership.tenantId}/portfolio/order`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ portfolioItemIds: next.map(({ id }) => id) }),
          },
        );
        applyResponse(response, selectedId);
        setNotice('正式作品順序已更新。');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '目前無法更新排序。');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setItems(next);
    setNotice('作品順序已在本機調整。');
  }

  async function removeSelected(): Promise<void> {
    if (selected === undefined) return;
    if (status === 'ready' && selectedMembership !== null && selected.status !== 'LOCAL') {
      setSubmitting(true);
      try {
        const response = await request<PortfolioResponse>(
          `/v1/tenants/${selectedMembership.tenantId}/portfolio/${selected.id}`,
          { method: 'DELETE' },
        );
        applyResponse(response);
        setNotice('正式作品已soft delete並保留audit。');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '目前無法移除作品。');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    const remaining = items.filter(({ id }) => id !== selected.id);
    setItems(remaining);
    setSelectedId(remaining[0]?.id ?? '');
    setNotice('作品已從本機預覽移除；正式 API 使用 soft delete 與 audit。');
  }

  if (!['local-preview', 'ready'].includes(status)) {
    return (
      <main className="studio-home studio-home-locked">
        <p className="studio-eyebrow">STUDIO SESSION REQUIRED</p>
        <h1>先選擇目前店家。</h1>
        <p>作品、上傳授權與配額都綁定tenant，尚未選擇時不會傳送圖片。</p>
        <Link className="studio-dark-action" href="/studio">
          回到店務總覽
        </Link>
      </main>
    );
  }

  return (
    <div className="portfolio-shell">
      <header className="catalog-topbar portfolio-topbar">
        <a className="studio-wordmark" href="/" aria-label="回到 Nook 首頁">
          <span aria-hidden="true">n/</span>
          nook
        </a>
        <nav aria-label="店家後台導覽">
          <a href="/studio/onboarding">店家資料</a>
          <a href="/studio/services">服務目錄</a>
          <a href="/studio/staff">人員班表</a>
          <a className="active" href="/studio/portfolio" aria-current="page">
            作品集
          </a>
        </nav>
        <span className="catalog-beta">
          {status === 'ready' ? 'LIVE TENANT DATA' : 'LOCAL PREVIEW'}
        </span>
      </header>

      <main className="portfolio-main">
        <section className="portfolio-hero">
          <div>
            <p>PORTFOLIO / 04</p>
            <h1>
              讓作品先說話，
              <em>檔案要先過關。</em>
            </h1>
          </div>
          <div className="portfolio-counter" aria-label="作品集配額">
            <span>MAX_PORTFOLIO_IMAGES</span>
            <strong>
              {displayedUsage}
              <i>/{portfolioLimit}</i>
            </strong>
            <small>有效 PENDING + READY 計入正式配額</small>
          </div>
        </section>

        <section className="portfolio-status-strip" aria-label="作品狀態摘要">
          <div>
            <span>READY</span>
            <strong>{readyCount.toString().padStart(2, '0')}</strong>
          </div>
          <div>
            <span>PENDING</span>
            <strong>{pendingCount.toString().padStart(2, '0')}</strong>
          </div>
          <p>
            Signed POST 15 min <b>→</b> private GCS <b>→</b> worker verify <b>→</b> stripped WebP
          </p>
        </section>

        <section className="portfolio-workbench">
          <section className="portfolio-contact-sheet" aria-labelledby="contact-sheet-heading">
            <div className="portfolio-panel-heading">
              <div>
                <span>CONTACT SHEET</span>
                <h2 id="contact-sheet-heading">作品索引</h2>
              </div>
              <label className="portfolio-file-button">
                ＋ 選擇圖片
                <input
                  aria-label="選擇作品圖片"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={submitting}
                  onChange={(event) => void addFile(event)}
                />
              </label>
            </div>

            {items.length === 0 ? (
              <div className="portfolio-empty">尚無作品。選擇一張安全格式圖片開始本機預覽。</div>
            ) : (
              <div className="portfolio-grid">
                {items.map((item, index) => (
                  <button
                    type="button"
                    className={
                      item.id === selected?.id ? 'portfolio-card selected' : 'portfolio-card'
                    }
                    key={item.id}
                    onClick={() => selectItem(item.id)}
                  >
                    <span className="portfolio-frame-number">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className={`portfolio-art ${item.visual}`}>
                      {item.imageUrl === undefined ? null : (
                        <img src={item.imageUrl} alt={`${item.title}本機預覽`} />
                      )}
                    </span>
                    <span className="portfolio-card-copy">
                      <strong>{item.title}</strong>
                      <small>{item.tags.length === 0 ? '尚未加標籤' : item.tags.join(' / ')}</small>
                    </span>
                    <i className={item.status.toLowerCase()}>{statusLabels[item.status]}</i>
                  </button>
                ))}
              </div>
            )}
          </section>

          <aside className="portfolio-inspector" aria-labelledby="portfolio-inspector-heading">
            <div className="portfolio-panel-heading dark">
              <div>
                <span>FRAME INSPECTOR</span>
                <h2 id="portfolio-inspector-heading">作品資料</h2>
              </div>
              <span>{selected === undefined ? '—' : statusLabels[selected.status]}</span>
            </div>

            {selected === undefined ? (
              <p className="portfolio-inspector-empty">選擇圖片後即可編輯作品資料。</p>
            ) : (
              <div className="portfolio-inspector-body">
                <div className={`portfolio-inspector-preview ${selected.visual}`}>
                  {selected.imageUrl === undefined ? null : (
                    <img src={selected.imageUrl} alt={`${selected.title}大圖本機預覽`} />
                  )}
                  <span>
                    SELECTED FRAME / {String(items.indexOf(selected) + 1).padStart(2, '0')}
                  </span>
                </div>
                <label>
                  <span>作品名稱</span>
                  <input
                    value={selected.title}
                    maxLength={160}
                    onChange={(event) => updateSelected({ title: event.target.value })}
                  />
                </label>
                <label>
                  <span>說明</span>
                  <textarea
                    value={selected.description}
                    maxLength={2000}
                    placeholder="色系、技法、適合情境…"
                    onChange={(event) => updateSelected({ description: event.target.value })}
                  />
                </label>
                <label>
                  <span>標籤 · 最多 10 個，以逗號分隔</span>
                  <input
                    value={selected.tags.join(', ')}
                    onChange={(event) =>
                      updateSelected({
                        tags: event.target.value
                          .split(',')
                          .map((tag) => tag.trim().slice(0, 50))
                          .filter(Boolean)
                          .slice(0, 10),
                      })
                    }
                  />
                </label>
                <div className="portfolio-file-facts">
                  <span>ORIGINAL</span>
                  <strong>{selected.fileLabel ?? 'synthetic preview asset'}</strong>
                  <small>正式 worker 會驗證實際 MIME、≤60 MP、單頁，並移除 EXIF。</small>
                </div>
                {status === 'ready' ? (
                  <div className="portfolio-persistence-actions">
                    <button
                      disabled={submitting || selected.status === 'LOCAL'}
                      onClick={() => void saveMetadata()}
                      type="button"
                    >
                      {submitting ? '儲存中…' : '儲存正式作品資料 ↗'}
                    </button>
                    <button
                      disabled={submitting || selected.status !== 'READY'}
                      onClick={() => void changePublicationStatus()}
                      type="button"
                    >
                      {selected.publicationStatus === 'PUBLISHED' ? '撤下公開作品' : '發布這張作品'}
                    </button>
                  </div>
                ) : null}
                <div className="portfolio-order-actions">
                  <button disabled={submitting} type="button" onClick={() => void moveSelected(-1)}>
                    ← 往前
                  </button>
                  <button disabled={submitting} type="button" onClick={() => void moveSelected(1)}>
                    往後 →
                  </button>
                  <button
                    className="danger"
                    disabled={submitting}
                    type="button"
                    onClick={() => void removeSelected()}
                  >
                    移除作品
                  </button>
                </div>
              </div>
            )}
          </aside>
        </section>

        <section className="portfolio-safety-note">
          <strong role="status">{notice}</strong>
          <span>
            {status === 'ready'
              ? '正式圖片使用短效signed POST直傳private GCS，API負責RBAC、tenant隔離與配額。'
              : 'API已具RBAC、tenant隔離、MAX_PORTFOLIO_IMAGES與private upload contract；登入後才會正式儲存。'}
          </span>
        </section>
      </main>
    </div>
  );
}

function toLocalPortfolioItem(item: PortfolioItemResponse, index: number): LocalPortfolioItem {
  const visuals: readonly LocalPortfolioItem['visual'][] = ['chrome', 'coral', 'ink', 'pearl'];
  return {
    id: item.id,
    title: item.title,
    description: item.description ?? '',
    tags: item.tags,
    status: item.media.status,
    publicationStatus: item.status,
    visual: visuals[index % visuals.length] ?? 'ink',
    fileLabel:
      item.media.mimeType === null || item.media.byteSize === null
        ? '等待檔案驗證'
        : `${item.media.mimeType} · ${(item.media.byteSize / 1024 / 1024).toFixed(2)} MiB`,
  };
}
