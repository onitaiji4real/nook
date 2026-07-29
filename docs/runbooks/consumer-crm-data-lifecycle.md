# Consumer CRM data lifecycle與activation runbook

## Safe defaults

- `CRM_PROJECTION_MODE=disabled`、`CRM_NOTES_MODE=disabled`、`CRM_TAGS_MODE=disabled`、`CRM_EXPORT_MODE=disabled`、`MARKETING_CONSENT_GRANT_ENABLED=false`為production預設。Consent state read與withdraw不受grant flag控制；migration一旦部署就必須保持可用。現有Terraform明確把API的grant flag與tag mode固定為disabled，核准前不得用console漂移覆寫。
- Consumer self-service固定為`GET|POST|DELETE /v1/me/marketing-consents/{tenantId}`；三種方法及authentication/problem response都必須回`Cache-Control: private, no-store`。POST是唯一受grant flag控制的方法，GET與DELETE不得因tenant/document停用或flag為false而被關閉。
- Tenant CRM讀取固定為`GET /v1/tenants/{tenantId}/customers`與`GET /v1/tenants/{tenantId}/customers/{customerId}`；只允許ACTIVE OWNER／MANAGER，VIEWER／STAFF固定403，cross-tenant ID固定404，所有成功與錯誤response皆為`Cache-Control: private, no-store`。只有`CRM_PROJECTION_MODE=active`可讀；disabled／shadow固定503，不能把未驗證投影冒充current truth。
- List使用database產生的immutable `asOf`與relationship key cursor；第一頁後新建立的customer不會插入同一個pagination snapshot。API不回phone/email/note內容，不推算spend。Tags只有`CRM_TAGS_MODE=active`且tenant plan的generic boolean `CUSTOMER_TAGS=true`才會出現在customer read；任一gate未開即固定空集合。Detail若發現既有encrypted note row但KMS read尚未啟用，固定503 fail closed並留下不含PII的safe audit，不能回空notes冒充成功解密。
- Tag definition list/create/status與customer attach/detach全部回`Cache-Control: private, no-store`。Create/status只允許OWNER；list/attach/detach允許OWNER／MANAGER；VIEWER／STAFF固定403，非會員及cross-tenant resource固定404。名稱先NFKC／trim並以32 code points、control/format與敏感分類拒絕清單fail closed；definition/link上限分別100／50。
- Expand migration及fake KMS/storage tests可先部署；disabled不代表可以保存明文、建立ACTIVE consent document或產生artifact。
- Repository、Terraform state/output、`.env.example`、log及worklog不得含KMS key URI、plaintext、wrapped key、object key或signed URL。

## Repository/local verification

1. Fresh migration與rollback-compatible舊revision啟動。
2. 以A→B→C改期、cancel、complete、no-show及duplicate/out-of-order events驗projection current-truth recompute、per-projector delivery/checkpoint replay，並證明不修改notification使用的shared outbox status。
3. 以兩tenant相同consumer及猜測customer/note/job IDs驗404 non-disclosure。
4. 用fake KMS驗random DEK/nonce、AAD tamper、key unavailable、rewrap與plaintext DB/log scan。
5. 以真實HTTP與database驗missing authentication、relationship/no-stream、cross-tenant 404、grant/withdraw/supersede/regrant、inactive tenant仍可withdraw、same idempotency key、current-safe replay、concurrent withdraw-wins及所有response的private no-store。
6. 用private fake storage驗customers/notes/tags/uncompressed/compressed/temp/time全部bounds、claim token/old-worker CAS、watermark invalidation、15分鐘expiry、60秒residual download、revoke與generation-match cleanup。
7. 390×844及desktop驗list/detail、role loss、tenant switch、no-store及無水平溢位。

## Staging activation order

1. 套用expand migration；部署相容API/worker，所有mode仍disabled。
2. 啟用projection shadow/backfill，對appointment SQL truth抽樣比對counts與first/last；確認無chain failure才切read。
3. Security/platform owner建立regional Cloud KMS key與rotation schedule，以exact service account授權；測試disable/rotation/rewrap及alert。
4. 建立private export prefix、CMEK、15分鐘lifecycle defense、CORS/referrer限制與bounded cleanup；驗證signed URL沒有進log。
5. Legal/product owner核准operational purpose、tenant identity render schema、`zh-TW` marketing document/version、retention與stop-use政策後，才建立ACTIVE consent document並啟用consumer grant。Withdrawal endpoint必須先部署且不可由grant feature flag關閉。
6. Tag owner核准non-sensitive taxonomy及拒絕清單後才啟用tags；不能用「使用者自行負責」取代分類控制。
7. 分別開notes/export staging；用合成PII完成authorization、expiry、revoke與incident drill後，才申請production activation。

## Monitoring

- Projection：oldest pending age、failed stream count、recompute duration、backfill cursor lag；label不得含consumer或customer。
- Consent：transition outcomes與conflict rate，只按event type/safe code聚合；不得記文案或actor identity。
- KMS：unwrap failure、disabled key、rewrap backlog；不得記cipher/wrapped key或完整resource URI。
- Export：pending age、failed/expired/revoked counts、cleanup backlog、artifact size bucket；不得記tenant/job/object/URL作metric label。
- Alert owner與on-call尚未核准時，production modes維持disabled。

## Projection worker與受控修復

- Private worker endpoint固定為`POST /internal/customer-projection/run`，需要Cloud Run IAM及`x-cloudscheduler: true` defense-in-depth。`CRM_PROJECTION_MODE=disabled`時不讀寫projection；`shadow`執行delivery/backfill但API尚不可切CRM read；`active`只可在shadow抽樣與owner核准後由後續IaC變更啟用。現有Terraform刻意把API/worker固定為`disabled`，本slice不建立新的Scheduler或繞過IaC修改環境。
- 每輪最多處理100筆delivery及100個backfill appointment cursor。Operational output只含projected/terminal/exhausted counts、blocked stream count、oldest pending age、backfill status及remaining count，不含tenant、consumer、customer、note或contact。
- 下列repair指令只能在已記錄incident/change ticket、資料invariant已用read-only查詢確認修復，且使用受控operator環境時執行。參數ID不得貼到一般聊天、metric或公開issue；指令不接受wildcard，也不提供全域reset。

Blocked stream修復會先在transaction內重新驗current truth；仍有corruption時回`still_corrupt`且不改任何狀態：

```bash
node infra/dev/run-with-env.mjs pnpm --filter @nook/database crm:projection:repair -- \
  repair-stream \
  --tenant-id <tenant-uuid> \
  --consumer-user-id <consumer-user-uuid> \
  --blocked-delivery-id <delivery-uuid> \
  --confirm-delivery-id <same-delivery-uuid>
```

Infrastructure retry exhaustion修復後，只重開exact delivery，不把它誤標成invariant：

```bash
node infra/dev/run-with-env.mjs pnpm --filter @nook/database crm:projection:repair -- \
  retry-delivery \
  --tenant-id <tenant-uuid> \
  --consumer-user-id <consumer-user-uuid> \
  --delivery-id <delivery-uuid> \
  --confirm-delivery-id <same-delivery-uuid>
```

Backfill `FAILED`原因修復後，以checkpoint現有cursor做compare-and-set；從未成功前進使用`none`：

```bash
node infra/dev/run-with-env.mjs pnpm --filter @nook/database crm:projection:repair -- \
  resume-backfill \
  --expected-cursor-id <cursor-uuid-or-none> \
  --confirm resume-backfill
```

任何指令回`false`／`not_blocked`代表state或expected value已改變，必須重新read-only檢查，不得盲目重送或直接改SQL。

## Incident與rollback

1. 疑似跨tenant或plaintext洩漏：立即關notes/export/tags read/write，保留database evidence，撤銷所有READY artifact並停用簽址；booking保持可用。
2. KMS key疑似洩漏：disable affected version、切新version、盤點引用並bounded rewrap；未完成前notes/export fail closed，不以舊明文backup恢復。
3. Consent eligibility錯誤：先停所有marketing producer，保持withdraw可用；以immutable events重建current state並抽樣驗證，不修改歷史event。
4. Projection錯誤：停projector與CRM read，以新projector version跑shadow backfill；禁止手改counts。
5. Object delete失敗：DB先標EXPIRED/REVOKED防下載，重試cleanup並告警；不得重新簽址驗證物件是否存在。

## Retention external gate

Legal未核准前，不宣告customer、consent evidence、note或job metadata的最終保存年限，也不啟用production data collection。Artifact技術TTL固定15分鐘，是access-control defense，不替代法定retention。P5-002負責DSAR、刪除／匿名化、legal hold與tenant closure adjudication。
