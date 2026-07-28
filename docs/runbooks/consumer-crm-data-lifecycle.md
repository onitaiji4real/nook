# Consumer CRM data lifecycle與activation runbook

## Safe defaults

- `CRM_PROJECTION_MODE=disabled`、`CRM_NOTES_MODE=disabled`、`CRM_TAGS_MODE=disabled`、`CRM_EXPORT_MODE=disabled`、`MARKETING_CONSENT_GRANT_MODE=disabled`為production預設。Consent state read與withdraw不受grant mode控制；migration一旦部署就必須保持可用。
- Expand migration及fake KMS/storage tests可先部署；disabled不代表可以保存明文、建立ACTIVE consent document或產生artifact。
- Repository、Terraform state/output、`.env.example`、log及worklog不得含KMS key URI、plaintext、wrapped key、object key或signed URL。

## Repository/local verification

1. Fresh migration與rollback-compatible舊revision啟動。
2. 以A→B→C改期、cancel、complete、no-show及duplicate/out-of-order events驗projection current-truth recompute、per-projector delivery/checkpoint replay，並證明不修改notification使用的shared outbox status。
3. 以兩tenant相同consumer及猜測customer/note/job IDs驗404 non-disclosure。
4. 用fake KMS驗random DEK/nonce、AAD tamper、key unavailable、rewrap與plaintext DB/log scan。
5. 驗relationship/no-stream、grant/withdraw/supersede/regrant、inactive tenant仍可withdraw、same idempotency key及concurrent withdraw-wins。
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

## Incident與rollback

1. 疑似跨tenant或plaintext洩漏：立即關notes/export/tags read/write，保留database evidence，撤銷所有READY artifact並停用簽址；booking保持可用。
2. KMS key疑似洩漏：disable affected version、切新version、盤點引用並bounded rewrap；未完成前notes/export fail closed，不以舊明文backup恢復。
3. Consent eligibility錯誤：先停所有marketing producer，保持withdraw可用；以immutable events重建current state並抽樣驗證，不修改歷史event。
4. Projection錯誤：停projector與CRM read，以新projector version跑shadow backfill；禁止手改counts。
5. Object delete失敗：DB先標EXPIRED/REVOKED防下載，重試cleanup並告警；不得重新簽址驗證物件是否存在。

## Retention external gate

Legal未核准前，不宣告customer、consent evidence、note或job metadata的最終保存年限，也不啟用production data collection。Artifact技術TTL固定15分鐘，是access-control defense，不替代法定retention。P5-002負責DSAR、刪除／匿名化、legal hold與tenant closure adjudication。
