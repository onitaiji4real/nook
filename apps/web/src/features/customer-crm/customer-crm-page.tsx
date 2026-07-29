'use client';

import type {
  CustomerDetail,
  CustomerListResponse,
  CustomerNote,
  CustomerSummary,
} from '@nook/contracts';
import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { StudioApiError } from '../studio-session/studio-api-error';
import { useStudioSession } from '../studio-session/studio-session-provider';
import { previewCustomerDetail, previewCustomers } from './preview-customers';

const marketingLabels: Record<CustomerSummary['marketingState'], string> = {
  NOT_GRANTED: '未同意',
  GRANTED: '已同意',
  WITHDRAWN: '已撤回',
  SUPERSEDED: '需重新確認',
};

export function CustomerCrmPage() {
  const {
    capabilities,
    request,
    retryAccount,
    selectedMembership: membership,
    status,
  } = useStudioSession();
  const preview = status === 'local-preview';
  const [items, setItems] = useState<readonly CustomerSummary[]>(previewCustomers);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteDeleteCandidate, setNoteDeleteCandidate] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteNotice, setNoteNotice] = useState<string | null>(null);

  const canRead = preview || membership?.role === 'OWNER' || membership?.role === 'MANAGER';
  const canWriteNotes = !preview && capabilities.customerNotes && canRead;
  const noteLength = Array.from(noteDraft).length;

  const loadCustomers = useCallback(
    async (append = false, cursor?: string) => {
      if (preview) {
        setItems(previewCustomers);
        setAsOf('2026-07-28T00:00:00.000Z');
        setNextCursor(null);
        return;
      }
      if (status !== 'ready' || membership === null || !canRead) return;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams({ limit: '50' });
        if (cursor !== undefined) query.set('cursor', cursor);
        const response = await request<CustomerListResponse>(
          `/v1/tenants/${membership.tenantId}/customers?${query.toString()}`,
          { cache: 'no-store' },
        );
        setItems((current) => (append ? [...current, ...response.items] : response.items));
        setAsOf(response.asOf);
        setNextCursor(response.nextCursor);
      } catch {
        setError('顧客名冊暫時無法讀取。資料不會留在瀏覽器儲存空間，請稍後重試。');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [canRead, membership, preview, request, status],
  );

  useEffect(() => {
    setDetail(null);
    resetNoteEditor();
    setError(null);
    setNextCursor(null);
    setAsOf(null);
    if (!preview) setItems([]);
    void loadCustomers();
  }, [loadCustomers, membership?.tenantId, membership?.role, preview]);

  const totals = useMemo(
    () => ({
      relationships: items.length,
      completed: items.reduce((sum, item) => sum + item.completedVisitCount, 0),
      noShow: items.reduce((sum, item) => sum + item.noShowCount, 0),
    }),
    [items],
  );

  async function openDetail(customer: CustomerSummary): Promise<void> {
    if (!canRead || (!preview && membership === null)) return;
    resetNoteEditor();
    setDetailLoading(true);
    setError(null);
    try {
      if (preview) {
        setDetail(previewCustomerDetail(customer.id));
      } else if (membership !== null) {
        setDetail(
          await request<CustomerDetail>(
            `/v1/tenants/${membership.tenantId}/customers/${customer.id}`,
            { cache: 'no-store' },
          ),
        );
      }
    } catch {
      setError('顧客明細目前無法讀取；若加密筆記服務尚未啟用，系統會安全地拒絕顯示。');
    } finally {
      setDetailLoading(false);
    }
  }

  function resetNoteEditor(): void {
    setNoteDraft('');
    setEditingNoteId(null);
    setNoteBusy(false);
    setNoteDeleteCandidate(null);
    setNoteError(null);
    setNoteNotice(null);
  }

  function closeDetail(): void {
    setDetail(null);
    resetNoteEditor();
  }

  function startEditing(note: CustomerNote): void {
    setEditingNoteId(note.id);
    setNoteDraft(note.content);
    setNoteDeleteCandidate(null);
    setNoteError(null);
    setNoteNotice(null);
  }

  async function saveNote(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canWriteNotes || membership === null || detail === null || noteBusy) return;
    if (noteDraft.trim().length === 0 || noteLength > 2_000) {
      setNoteError('備註需為 1–2,000 個字元，不能只包含空白。');
      return;
    }
    const current = detail.notes.find(({ id }) => id === editingNoteId);
    if (editingNoteId !== null && current === undefined) {
      setNoteError('這筆備註已不在目前畫面，請重新開啟顧客明細。');
      return;
    }

    setNoteBusy(true);
    setNoteError(null);
    setNoteNotice(null);
    try {
      const basePath = `/v1/tenants/${membership.tenantId}/customers/${detail.customer.id}/notes`;
      const saved =
        current === undefined
          ? await request<CustomerNote>(basePath, {
              method: 'POST',
              cache: 'no-store',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: noteDraft }),
            })
          : await request<CustomerNote>(`${basePath}/${current.id}`, {
              method: 'PATCH',
              cache: 'no-store',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: noteDraft,
                expectedUpdatedAt: current.updatedAt,
              }),
            });
      setDetail((latest) =>
        latest === null
          ? latest
          : {
              ...latest,
              notes:
                current === undefined
                  ? [saved, ...latest.notes]
                  : latest.notes.map((note) => (note.id === saved.id ? saved : note)),
            },
      );
      setNoteDraft('');
      setEditingNoteId(null);
      setNoteNotice(current === undefined ? '加密備註已建立。' : '加密備註已更新。');
    } catch (caught) {
      setNoteError(
        caught instanceof StudioApiError && caught.code === 'customer_note_conflict'
          ? '其他工作人員已更新這筆備註。請關閉明細後重新讀取，再決定是否覆寫。'
          : '備註目前無法安全儲存；系統沒有降級成明文，請稍後重試。',
      );
    } finally {
      setNoteBusy(false);
    }
  }

  async function deleteNote(note: CustomerNote): Promise<void> {
    if (!canWriteNotes || membership === null || detail === null || noteBusy) return;
    if (noteDeleteCandidate !== note.id) {
      setNoteDeleteCandidate(note.id);
      setEditingNoteId(null);
      setNoteDraft('');
      setNoteError(null);
      setNoteNotice('再按一次「確認刪除」才會移除這筆備註。');
      return;
    }

    setNoteBusy(true);
    setNoteError(null);
    setNoteNotice(null);
    try {
      await request<void>(
        `/v1/tenants/${membership.tenantId}/customers/${detail.customer.id}/notes/${note.id}`,
        { method: 'DELETE', cache: 'no-store' },
      );
      setDetail((latest) =>
        latest === null
          ? latest
          : { ...latest, notes: latest.notes.filter(({ id }) => id !== note.id) },
      );
      setNoteDeleteCandidate(null);
      setNoteNotice('加密備註已刪除。');
    } catch {
      setNoteError('備註目前無法刪除；請重新讀取顧客明細後再試一次。');
    } finally {
      setNoteBusy(false);
    }
  }

  if (status === 'config-loading' || status === 'account-loading') {
    return <main className="customer-crm customer-crm-gate">正在準備顧客名冊…</main>;
  }
  if (status === 'signed-out' || status === 'signing-in' || status === 'not-configured') {
    return (
      <main className="customer-crm customer-crm-gate">
        <p className="studio-eyebrow">CLIENT REGISTER · PRIVATE</p>
        <h1>請先登入店務工作台。</h1>
        <Link className="studio-dark-action" href="/studio/login">
          前往安全登入
        </Link>
      </main>
    );
  }
  if (status === 'tenant-required') {
    return (
      <main className="customer-crm customer-crm-gate">
        <p className="studio-eyebrow">SELECT TENANT</p>
        <h1>先選擇要查看的店家。</h1>
        <Link className="studio-dark-action" href="/studio">
          回到總覽
        </Link>
      </main>
    );
  }
  if (status === 'degraded') {
    return (
      <main className="customer-crm customer-crm-gate">
        <p className="studio-eyebrow">CONNECTION PAUSED</p>
        <h1>顧客資料仍留在記憶體，連線暫時中止。</h1>
        <button className="studio-dark-action" onClick={() => void retryAccount()} type="button">
          重新確認連線
        </button>
      </main>
    );
  }
  if (!canRead) {
    return (
      <main className="customer-crm customer-crm-gate">
        <p className="studio-eyebrow">OWNER / MANAGER ONLY</p>
        <h1>顧客名冊需要店主或管理者權限。</h1>
        <p>服務人員與檢視者不會收到顧客姓名、紀錄或行銷狀態。</p>
        <Link className="studio-dark-action" href="/studio">
          返回店務總覽
        </Link>
      </main>
    );
  }

  return (
    <main className="customer-crm">
      <header className="customer-crm-hero">
        <div>
          <p className="studio-eyebrow">CLIENT REGISTER · APPOINTMENT-BACKED</p>
          <h1>
            每次到訪，
            <em>都有脈絡。</em>
          </h1>
          <p>
            {preview
              ? 'LOCAL PREVIEW · 以下為合成顧客資料，不會讀取或保存真實個資。'
              : '只呈現由真實預約建立的營運關係；行銷同意、履約紀錄與消費金額分開判定。'}
          </p>
        </div>
        <dl className="customer-crm-pulse" aria-label="目前已載入摘要">
          <div>
            <dt>RELATIONSHIPS</dt>
            <dd>{String(totals.relationships).padStart(2, '0')}</dd>
          </div>
          <div>
            <dt>COMPLETED</dt>
            <dd>{String(totals.completed).padStart(2, '0')}</dd>
          </div>
          <div>
            <dt>NO-SHOW</dt>
            <dd>{String(totals.noShow).padStart(2, '0')}</dd>
          </div>
        </dl>
      </header>

      <section className="customer-crm-policy">
        <p>
          <strong>營運關係 ≠ 行銷同意</strong>
          名冊可用於預約履約與客服；只有「已同意」狀態可作為後續行銷 eligibility 的其中一項證據。
        </p>
        <span>{asOf === null ? 'CURRENT VIEW' : `AS OF ${formatDateTime(asOf)}`}</span>
      </section>

      {error === null ? null : (
        <div className="appointment-alert customer-crm-alert" role="alert">
          <p>{error}</p>
          <button onClick={() => void loadCustomers()} type="button">
            重新讀取
          </button>
        </div>
      )}

      <section className="customer-crm-ledger" aria-live="polite">
        <header>
          <span>CLIENT</span>
          <span>RELATIONSHIP</span>
          <span>SERVICE TRUTH</span>
          <span>CONSENT</span>
          <span aria-hidden="true">↗</span>
        </header>
        {loading ? (
          <div className="customer-crm-empty">正在依租戶權限整理名冊…</div>
        ) : items.length === 0 ? (
          <div className="customer-crm-empty">
            <span>00</span>
            <h2>還沒有由預約建立的顧客關係。</h2>
            <p>顧客確認第一筆預約後，投影流程才會建立名冊，不接受手動捏造顧客。</p>
          </div>
        ) : (
          items.map((customer, index) => (
            <article className="customer-crm-row" key={customer.id}>
              <div className="customer-crm-identity">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <h2>{customer.displayName}</h2>
                <small>顧客編號 · {customer.id.slice(0, 8)}</small>
              </div>
              <div>
                <small>首次建立關係</small>
                <strong>{formatDate(customer.relationshipStartedAt)}</strong>
                <span>
                  {customer.lastVisitAt === null
                    ? '尚無完成紀錄'
                    : `最近完成 ${formatDate(customer.lastVisitAt)}`}
                </span>
              </div>
              <div className="customer-crm-facts">
                <p>
                  <strong>{customer.completedVisitCount}</strong>
                  <span>完成</span>
                </p>
                <p>
                  <strong>{customer.noShowCount}</strong>
                  <span>未到</span>
                </p>
                <small>尚無可確認消費金額</small>
              </div>
              <div>
                <span
                  className={`customer-consent customer-consent-${customer.marketingState.toLowerCase()}`}
                >
                  {marketingLabels[customer.marketingState]}
                </span>
                <small>
                  {customer.activeMarketingDocumentVersion === null
                    ? '目前無有效文案'
                    : `文案 ${customer.activeMarketingDocumentVersion}`}
                </small>
              </div>
              <button
                aria-label={`查看 ${customer.displayName} 的顧客明細`}
                onClick={() => void openDetail(customer)}
                type="button"
              >
                明細
                <span>↗</span>
              </button>
            </article>
          ))
        )}
      </section>

      {nextCursor === null ? null : (
        <button
          className="customer-crm-more"
          disabled={loadingMore}
          onClick={() => void loadCustomers(true, nextCursor)}
          type="button"
        >
          {loadingMore ? '正在載入下一頁…' : '載入更多顧客'}
        </button>
      )}

      {detail === null && !detailLoading ? null : (
        <div className="appointment-detail-backdrop" role="presentation">
          <aside aria-label="顧客明細" className="customer-crm-detail">
            {detailLoading || detail === null ? (
              <p>正在依目前權限讀取明細…</p>
            ) : (
              <>
                <header>
                  <div>
                    <p className="studio-eyebrow">CLIENT DOSSIER</p>
                    <h2>{detail.customer.displayName}</h2>
                    <span>營運資料 · 非行銷名單</span>
                  </div>
                  <button aria-label="關閉顧客明細" onClick={closeDetail} type="button">
                    ×
                  </button>
                </header>
                <dl>
                  <div>
                    <dt>首次關係</dt>
                    <dd>{formatDate(detail.customer.relationshipStartedAt)}</dd>
                  </div>
                  <div>
                    <dt>首次完成</dt>
                    <dd>{nullableDate(detail.customer.firstVisitAt)}</dd>
                  </div>
                  <div>
                    <dt>最近完成</dt>
                    <dd>{nullableDate(detail.customer.lastVisitAt)}</dd>
                  </div>
                  <div>
                    <dt>服務紀錄</dt>
                    <dd>
                      {detail.customer.completedVisitCount} 次完成 · {detail.customer.noShowCount}{' '}
                      次未到
                    </dd>
                  </div>
                  <div>
                    <dt>可確認消費</dt>
                    <dd>尚無 final settlement，不以目錄價格推算</dd>
                  </div>
                  <div>
                    <dt>行銷狀態</dt>
                    <dd>{marketingLabels[detail.customer.marketingState]}</dd>
                  </div>
                </dl>
                <section>
                  <p className="studio-eyebrow">VERIFIED CONTACT</p>
                  <h3>尚未收錄已驗證聯絡方式</h3>
                  <p>第一版不從 LINE subject、頭像或預約文字猜測電話與 Email。</p>
                </section>
                <section className="customer-note-panel">
                  <div className="customer-note-heading">
                    <div>
                      <p className="studio-eyebrow">ENCRYPTED NOTES · PRIVATE</p>
                      <h3>只留服務所需的內部脈絡</h3>
                    </div>
                    <span>{detail.notes.length}/100</span>
                  </div>
                  <p className="customer-note-safety">
                    內容只在授權請求中解密；系統不會把備註寫進 log、公開頁或行銷名單。
                  </p>

                  {detail.notes.length === 0 ? (
                    <div className="customer-note-empty">
                      <strong>尚無加密備註</strong>
                      <span>不以空白紀錄推測顧客偏好。</span>
                    </div>
                  ) : (
                    <div className="customer-note-list">
                      {detail.notes.map((note, index) => (
                        <article className="customer-note-card" key={note.id}>
                          <header>
                            <span>NOTE {String(detail.notes.length - index).padStart(2, '0')}</span>
                            <time dateTime={note.updatedAt}>{formatDateTime(note.updatedAt)}</time>
                          </header>
                          <p>{note.content}</p>
                          {canWriteNotes ? (
                            <footer>
                              <button
                                disabled={noteBusy}
                                onClick={() => startEditing(note)}
                                type="button"
                              >
                                編輯
                              </button>
                              <button
                                className={
                                  noteDeleteCandidate === note.id
                                    ? 'customer-note-delete-confirm'
                                    : undefined
                                }
                                disabled={noteBusy}
                                onClick={() => void deleteNote(note)}
                                type="button"
                              >
                                {noteDeleteCandidate === note.id ? '確認刪除' : '刪除'}
                              </button>
                            </footer>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  )}

                  {preview ? (
                    <div className="customer-note-gate">
                      LOCAL PREVIEW 不接受備註輸入，也不會製造合成的敏感內容。
                    </div>
                  ) : !capabilities.customerNotes ? (
                    <div className="customer-note-gate">
                      此環境仍等待 KMS、IAM、輪替與事件負責人核准；讀寫入口保持關閉。
                    </div>
                  ) : (
                    <form className="customer-note-form" onSubmit={(event) => void saveNote(event)}>
                      <label htmlFor="customer-note-content">
                        {editingNoteId === null ? '新增服務備註' : '編輯服務備註'}
                      </label>
                      <textarea
                        aria-describedby="customer-note-counter customer-note-help"
                        disabled={noteBusy}
                        id="customer-note-content"
                        onChange={(event) => setNoteDraft(event.target.value)}
                        placeholder="只記錄下次服務真正需要知道的內容…"
                        rows={5}
                        value={noteDraft}
                      />
                      <div className="customer-note-form-meta">
                        <small id="customer-note-help">
                          請勿填寫醫療診斷、證件號碼或行銷推論。
                        </small>
                        <span
                          className={noteLength > 2_000 ? 'customer-note-counter-over' : undefined}
                          id="customer-note-counter"
                        >
                          {noteLength}/2,000
                        </span>
                      </div>
                      <div className="customer-note-actions">
                        {editingNoteId === null ? null : (
                          <button
                            disabled={noteBusy}
                            onClick={() => {
                              setEditingNoteId(null);
                              setNoteDraft('');
                              setNoteError(null);
                            }}
                            type="button"
                          >
                            取消編輯
                          </button>
                        )}
                        <button
                          disabled={
                            noteBusy ||
                            noteDraft.trim().length === 0 ||
                            noteLength > 2_000 ||
                            (editingNoteId === null && detail.notes.length >= 100)
                          }
                          type="submit"
                        >
                          {noteBusy
                            ? '正在安全處理…'
                            : editingNoteId === null
                              ? '建立加密備註'
                              : '儲存新版本'}
                        </button>
                      </div>
                    </form>
                  )}

                  {noteError === null ? null : (
                    <p className="customer-note-message customer-note-message-error" role="alert">
                      {noteError}
                    </p>
                  )}
                  {noteNotice === null ? null : (
                    <p className="customer-note-message" role="status">
                      {noteNotice}
                    </p>
                  )}
                </section>
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function nullableDate(value: string | null): string {
  return value === null ? '尚無完成紀錄' : formatDate(value);
}
