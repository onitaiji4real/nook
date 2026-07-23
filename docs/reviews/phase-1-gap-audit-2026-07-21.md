# Phase 1 文件與實作落差稽核

日期：2026-07-21
範圍：Phase 1 文件、應用程式、Terraform 與 CI/CD contract 之唯讀比對
結論：repository 內可重現的工程骨架已具備，但 Phase 1 整體仍為 `in_progress`；外部 gate 尚未完成。User status、部署 ownership/Scheduler、external-browser CORS、application readiness、identity error classification、5xx ratio、CI format gate、budget ownership 與 application-layer auth rate limit 已由 P1-007～P1-015 修復；首次 GCP runtime 部署前仍有外部帳務輸入、可信 edge rate limit與營運政策缺口需要處理。

本報告不變更既有 acceptance gate。`PASS` 只表示該 gate 已依既定範圍取得證據，不代表本報告新發現的相鄰風險已修復；未實際執行的 GCP、LINE、production 或 staging 驗證不標示為通過或失敗。

## 已確認 bug／落差

### 1. `User.status` 未阻擋登入或 tenant 存取

嚴重度：高

狀態：`RESOLVED`（P1-007，2026-07-21）

- `UserStatus` 已定義 `ACTIVE`、`SUSPENDED`、`DELETED`，且 `User.status` 預設為 `ACTIVE`：`packages/database/prisma/schema.prisma:10-14,50-63`。
- LINE identity lookup 只從 `UserIdentity` 取回 `userId`，未查詢關聯 `User.status`：`packages/database/src/identity-repository.ts:16-20,52-58`。
- LINE exchange 在取得 identity 後直接簽發 custom token：`apps/api/src/line-auth-application.service.ts:22-29`。
- Firebase bearer token 驗證後直接把 `uid` 當作 principal，未核對 local user 狀態：`apps/api/src/firebase-identity.adapter.ts:25-31`。
- Tenant membership 查詢只要求 membership 與 tenant 為 `ACTIVE`，未限制關聯 user 為 `ACTIVE`；`GET /v1/me` 也只依 `userId` 列 membership：`packages/database/src/tenant-repository.ts:109-142`、`apps/api/src/tenant-application.service.ts:95-98`。

因此 local user 即使已標為 `SUSPENDED` 或 `DELETED`，只要 tenant 與 membership 仍為 `ACTIVE`，目前仍可能取得或使用 token 存取 tenant。既有 `suspended membership` 測試只覆蓋 membership 狀態，不能證明 user suspension 生效。

改善建議：在 authentication/application 邊界強制查詢 active local user；LINE exchange 在簽發 token 前亦須拒絕非 active user。補上 suspended/deleted user 的 exchange、bearer access、`GET /v1/me` 與 tenant read integration tests。

修復證據：Identity repository 現提供 active-user lookup；LINE exchange、bearer guard 與 tenant create application service 皆強制檢查，tenant membership query 另以 user relation filter defense-in-depth。Database 4/4、API tenant 10/10、LINE 6/6 integration tests 證明 `SUSPENDED`、`DELETED` 與不存在的 local user 均回 `403 account_inactive`，且不簽發 custom token或建立 tenant。

### 2. Scheduler 會呼叫尚不存在的 worker endpoint

嚴重度：高

狀態：`RESOLVED`（P1-008，2026-07-21）

- `deploy_runtime=true` 時 Terraform 會建立每分鐘執行的 Scheduler job，呼叫 `POST /internal/notifications/dispatch`：`infra/terraform/modules/platform/main.tf:520-549`。
- Worker controller 目前只提供 `GET /health` 與 `GET /ready`：`apps/worker/src/health.controller.ts:7-23`。

一旦 runtime 被 apply，Scheduler 會持續收到 404 並依設定重試，造成錯誤 log、告警噪音與非必要成本。

改善建議：在 Phase 3 dispatcher 完成前不要建立 job，或以顯式 feature flag 建立為 paused；endpoint、authentication、idempotency 與 dispatcher tests 完成後再啟用。

修復證據：`enable_notification_dispatcher` 現預設為 false，必須與 `deploy_runtime=true` 搭配；dev/stg/prod examples 明確關閉。Terraform mock tests 證明一般 runtime plan 不建立 job、非法組合被拒絕、顯式合法組合才建立；static contract 防止範例被誤開。

### 3. 外部瀏覽器的 web → API 跨來源契約尚未實作

嚴重度：高

狀態：`RESOLVED`（P1-009，2026-07-21）

- 產品要求同一套 Web 支援 LINE 外的一般瀏覽器：`docs/product/business-technical-plan.md:953`，並要求 API 使用 CORS allowlist：`docs/product/business-technical-plan.md:1238-1242`。
- API bootstrap 只註冊 request context 與 shutdown hooks，未啟用 CORS：`apps/api/src/main.ts:9-16`。
- Terraform 將 web 與 API 建為不同 Cloud Run services；目前的 CORS 設定只作用於 media bucket，不是 API：`infra/terraform/modules/platform/main.tf:136-155,334-360`。

在尚無同網域 Load Balancer routing 的 Cloud Run URL 模式下，瀏覽器對 API 的跨來源 request/preflight 會缺少必要回應 header。

改善建議：新增 typed、fail-closed 的 API origin allowlist，明確限制 methods/headers/credentials，並以 integration test 驗證允許與拒絕的 preflight；部署文件需說明 Cloud Run URL 與正式同網域 routing 的差異。

修復證據：Typed config 現只接受 unique exact HTTP(S) origins，拒絕 wildcard、path、credential、非 HTTP protocol 與重複值；API 只允許 GET/POST/OPTIONS 與 Authorization/Content-Type/X-Request-Id，不啟用 credentials。Config 12/12、CORS 3/3、Terraform 7/7 mocked tests，以及實際本機 allow/deny preflight 均通過；production Terraform input 強制 HTTPS。

### 4. Firebase verifier unavailable 被誤映射為 401

嚴重度：中

狀態：`RESOLVED`（P1-011，2026-07-21）

- Authentication guard 已能把 `verifier_unavailable` 映射為 503：`apps/api/src/authentication.guard.ts:38-59`。
- Firebase adapter 卻把 `verifyIdToken` 的所有例外一律轉成 `invalid_token`：`apps/api/src/firebase-identity.adapter.ts:25-31`。

因此 Firebase／網路暫時故障也會回 401，可能誤導前端清除 session 或要求使用者重新登入，且 guard 的 503 分支對此 adapter 實際不可達。

改善建議：依 Firebase Admin error code 區分憑證無效與 provider/unavailable；未知基礎設施錯誤應 fail closed 為 503。補上 revoked/expired/invalid 與 unavailable 的 adapter/guard contract tests。

修復證據：Firebase adapter 現以 `checkRevoked=true` 驗證；只有已知 token rejection codes 映射 401，其餘 Firebase/unknown failures fail closed為 503。Adapter 13 tests涵蓋 valid、7 類 token rejection 與 5 類 infrastructure/unknown failure；guard 4 tests直接保護 401/503 application mapping。API unit 28/28、lint/typecheck/build 通過。

### 5. 部署 smoke 未驗證三服務的 application readiness

嚴重度：中

狀態：`RESOLVED`（P1-010，2026-07-21）

- 發布 contract 宣稱 migration、smoke 或 readiness failure 會停止 workflow：`docs/ci-contract.md:19-26`。
- 部署 script 只呼叫 web/API 的 health endpoint，未呼叫其 readiness：`infra/ci/deploy-cloud-run.sh:43-52`。
- Worker 只讀取 Cloud Run `Ready` condition，未呼叫 application `/ready`：`infra/ci/deploy-cloud-run.sh:54-57`。

Cloud Run revision Ready 或 process health 不等於資料庫等依賴已可用；目前流程可能把 application readiness 失敗的 revision 切入流量。

改善建議：zero-traffic candidate 階段驗證 web/API/worker 的 application `/ready`。Worker 為 internal ingress，需透過具 OIDC 的受控 probe、Cloud Run job 或同網路執行者驗證，而非只讀 service condition。

修復證據：Cloud Run 三服務 startup probe 現分別呼叫 Web `/api/readiness`、API/worker `/ready`；依 Cloud Run contract，startup probe 成功後 revision 才可 ready/serve，因此 private worker 的 Ready condition 已包含 application dependency check。Deployment script另直接呼叫 public Web/API candidate readiness。Terraform 7/7 與 deployment static negative tests 3/3 會阻擋 TCP-only startup、health-only smoke 或把 worker check 移到 promotion 後；真實 staging run 仍屬 P1-E04 外部 gate。

### 6. 5xx 告警不是文件要求的 2% error ratio

嚴重度：中

狀態：`RESOLVED`（P1-012，2026-07-21）

- 產品門檻是「5xx rate > 2% 持續 5 分鐘」：`docs/product/business-technical-plan.md:1383`。
- Terraform 目前只篩選 5xx request count，經 `ALIGN_RATE`／`REDUCE_SUM` 後以 `0.05` 作絕對速率門檻：`infra/terraform/modules/platform/main.tf:551-585`。

這不是 5xx / 全部 request 的百分比。在低流量時可能過敏，在高流量時則不能表達 2% SLO。

改善建議：使用 numerator/denominator ratio、MQL/PromQL 或 log-based metric 建立百分比告警；另定義低流量策略，並以 synthetic metric 或 staging 演練驗證觸發與恢復。

修復證據：Alert 現以 5xx request_count 為 numerator、all request_count 為 denominator，threshold 0.02／duration 300 秒；第二條件要求同一 service 持續高於 1 request/minute，`AND_WITH_MATCHING_RESOURCE` 防止跨服務湊條件，missing data inactive。Terraform runtime assertions、五個 configuration validate、7/7 mocked tests 與 Trivy 0 通過；實際 notification firing/recovery 仍屬 P1-E07 external gate。

### 7. P1-002 要求的 budget alert 尚未落地或以 ADR 排除

嚴重度：中

狀態：`RESOLVED`（P1-014／ADR 0005，2026-07-21；真實 apply 仍受 P1-B05 阻塞）

- P1-002 要求「新增 budget/monitoring 最小告警，或以 ADR 說明由 organization policy 管理」：`docs/tasks/P1-002-terraform-cloud-foundation.md:6-11`。
- Terraform 僅啟用 `billingbudgets.googleapis.com` API：`infra/terraform/modules/platform/main.tf:1-22`；repository 中沒有 `google_billing_budget` resource，也未找到將 budget 明確交由組織層管理的 ADR。
- 產品風險表把預算告警列為雲端成本控制：`docs/product/business-technical-plan.md:1694`。

改善建議：由 owner 決定 environment/project budget 的管理位置。若由此 module 管理，新增 billing account、門檻、notification/pubsub contract 與驗證；若由 organization 層管理，補 ADR、owner、查核方式與 acceptance evidence。

修復證據：ADR 0005 指定 environment Terraform 管理 project-scoped budget；nullable input 在未取得 owner 帳務決策時不建立資源。Variable validation、預設無資源與 opt-in 正向 mock 共納入 9/9 Terraform tests；budget 保留 Billing IAM recipients、可帶入核准 Monitoring channels，並以 `prevent_destroy` 阻擋意外取消。Repository 沒有填入真實 account／金額，也沒有自動停用 billing；P1-B05／P1-E07 維持 `BLOCKED`。

### 8. Required CI 未執行 `format:check`

嚴重度：中

狀態：`RESOLVED`（P1-013，2026-07-21）

- Root script 已提供 `pnpm format:check`：`package.json:19-20`。
- Phase 1 static quality gate 明確要求 format、lint、strict typecheck：`docs/phase-1/acceptance-standard.md` 的 P1-A02。
- GitHub `verify` job 在 install 後執行 architecture、lint、typecheck、tests 與 build，但沒有 format step：`.github/workflows/ci.yml:57-82`；`docs/ci-contract.md:7` 也未列 format。

因此本機曾經通過 format 不代表未來 PR 的 formatting regression 會被 required check 阻擋。

改善建議：在 `verify` 加入 `pnpm format:check`，並同步 CI contract／workflow checker；避免只靠 lint 間接涵蓋格式。

修復證據：Required `verify` 現在 frozen install／architecture 後執行 full repository `pnpm format:check`，再進 lint/typecheck。CI quality tests 3/3 會阻擋 step 被移除或設成 `continue-on-error`；root architecture 共 14/14通過。下一次 phase1 push仍需取得 GitHub clean-run evidence。

## 風險／需決策

### 9. Terraform 與 deployment workflow 同時擁有 image 欄位

嚴重度：高

狀態：`RESOLVED`（P1-008／ADR 0004，2026-07-21）

- Terraform 管理三個 Cloud Run service image 與 migration job image：`infra/terraform/modules/platform/main.tf:334-360,452-475`。
- Deployment workflow 直接用 `gcloud run jobs update --image` 更新 migration image：`.github/workflows/_deploy.yml:54-66`，並用 `gcloud run services update --image` 更新三個 service：`infra/ci/deploy-cloud-run.sh:35-41`。

若 environment tfvars 仍保留舊 digest，後續 Terraform apply 可能把已部署版本改回舊 image；反之若 Terraform 要做唯一 owner，現行 CD 又繞過 state。因尚未實際 apply，這是可由 config 確認的 ownership 衝突風險，不宣稱已在 GCP 發生 drift。

改善建議：選定單一 ownership model並用 ADR 記錄。若 CD 擁有 image，Terraform 應對 service/job image 使用精確的 lifecycle ignore 並由 deploy/runbook 管理 drift；若 Terraform 擁有 image，release 應更新經審查的 digest input 並透過 plan/apply 部署。

修復證據：ADR 0004 指定 Terraform 管理 resource 與 image 以外的 runtime configuration、GitHub Actions 管理 bootstrap 後的 image revisions。Service/job 只忽略精確 image path；3 個負向 static tests 會阻擋 broad template ignore、implicit Scheduler 與誤開環境範例。五個 Terraform configuration validate、5 個 mock tests、isolation check 與 Trivy HIGH/CRITICAL 0 均通過。

### 10. `AuditLog.requestId` nullable，且 tenant deletion 會 cascade 稽核資料

嚴重度：中

狀態：`RESOLVED`（Phase 1 database safety；P1-017／ADR 0007，2026-07-21；保存年限仍待 owner／法遵決策）

- Data dictionary 說 AuditLog 必含 request ID：`docs/data-dictionary/identity-tenancy.md:19-21`。
- 稽核時 Prisma schema 的 `requestId` 可為 null，tenant relation 使用 `onDelete: Cascade`；目前契約已由下述 P1-017 修正。
- 現有 application write 有提供 request ID：`packages/database/src/tenant-repository.ts:94-102,159-167`；nullable 是先前 expand-only migration 的相容性選擇：`packages/database/prisma/migrations/20260714010000_audit_request_id/migration.sql:1-4`。

應先決定 audit retention 與帳號刪除／匿名化政策，再決定 constraint。直接改成 non-null 或禁止 tenant delete 都需要 migration 與資料生命週期設計，不宜在本次文件稽核代替產品／法遵決策。

改善建議：盤點舊 null row、完成 backfill 後以 contract migration 收緊 `request_id`；為 tenant deletion 定義 soft-delete、匿名化或獨立保留策略，並加 database constraint/integration tests。

修復證據：Contract migration 將舊 null row 回填為不含 PII 的 `legacy-<audit UUID>` 後收緊 `request_id NOT NULL`，並將 audit-to-tenant foreign key 改為 `ON DELETE RESTRICT`。Phase 1 明確以 `Tenant.status = CLOSED` 表達關閉，不提供 hard delete。Database contract 2/2、integration 7/7 與 API regression 17/17 證明缺 request ID 的 insert被PostgreSQL 23502拒絕，tenant delete被foreign key拒絕且audit仍存在。實際保存年限、legal hold、匿名化與purge仍需owner／法遵決策，不以本項resolved冒充完成。

### 11. Auth endpoint 尚無明確 rate limit

嚴重度：中

狀態：`RESOLVED`（Phase 1 application layer；P1-015／ADR 0006，2026-07-21）

- 產品要求 Auth、search、webhook 分別設計 rate limit：`docs/product/business-technical-plan.md:1238`。
- API／Terraform 目前未見 auth request throttling 或 Cloud Armor policy；Terraform 的 `rate_limits` 是 Cloud Tasks queue dispatch rate，不是 HTTP API 防護：`infra/terraform/modules/platform/main.tf:160-178`。
- 產品把 Cloud Armor 排在正式上線前，但公開 LINE exchange 在此前仍可能承受濫用或 provider amplification。

改善建議：決定 Phase 1/staging 與正式環境各自的防護層。至少為 auth exchange 建立 per-IP／失敗率／provider call 的限制與觀測，且不能只依 process memory；正式上線前再以 Cloud Armor 或同等 edge policy 補齊。

修復證據：P1-015 在 provider call 前以 PostgreSQL 原子 fixed-window buckets執行 environment-global 120/min 與 token SHA-256 fingerprint 5/min，跨 Cloud Run instances共享且不保存 raw token／subject／IP。Database concurrency 10 consumes 在 limit=5 時恰有 5 allowed；API integration證明第六次回 429＋`Retry-After`且 verifier僅呼叫五次。Config/Terraform bounds、TTL cleanup、failure 503、OpenAPI與 ADR均已建立。可信 per-IP edge rate limit仍是正式大量導流前的 Cloud Armor工作，不以本項 `RESOLVED` 宣稱完成。

### 12. 任務 `done` 與 Phase 1 `in_progress` 的語意容易誤讀

嚴重度：低

狀態：`RESOLVED`（P1-017 documentation contract，2026-07-21）

- 稽核時任務索引把 `done` 定義為「已驗收」，且 P1-001～P1-005 全列 `done`；目前語意已由下述 documentation contract修正。
- Phase 1 implementation plan 仍為 `in_progress`，完成定義包含 GCP、staging 與 production gate：`docs/phase-1/implementation-plan.md:3-4,32-42`。
- Acceptance evidence 仍有 P1-B05、D05、E04～E07、F02、F04 為 `BLOCKED`：`docs/phase-1/acceptance-evidence.md`。

任務文件實際想表達的是 repository implementation／local contract 已完成，但「done 已驗收」容易被解讀為整體或外部 acceptance 已完成。

改善建議：將 task 狀態語意拆成 implementation status 與 external acceptance status，或把 `done` 定義改為「任務範圍內實作完成」並強制連結 Phase 1 gate 表。本次稽核不改既有 task 狀態，以免破壞既有交接語意。

修復證據：Task index現在明確定義 `done` 只代表該任務 acceptance criteria在repository／local evidence範圍內完成，不代表Phase 1或外部gate通過；implementation plan與task交接規則都強制以acceptance evidence的required gate為整體狀態來源。Phase 1維持`in_progress`直到所有required gate為`PASS`。

### 13. 驗收文件日期與最新證據未同步

嚴重度：低

- `docs/phase-1/acceptance-evidence.md` 原最後更新為 2026-07-15，但內容已引用 2026-07-20 的 implementation commit `2354a66`。
- `docs/worklog.md` 已記錄 2026-07-20 的兩個 remote workflow successful runs，驗收表仍主要引用較舊 run。

本次已將驗收證據日期更新至 2026-07-21、補上最新 remote run，並連回本報告；未將任何 `BLOCKED` gate 改為 `PASS`。

## 外部 gate

以下狀態沿用 `docs/phase-1/acceptance-evidence.md`，本次未執行或推論其結果：

- `P1-B05`：三個 GCP project/state 與 foundation 的 owner-approved apply、post-apply query。
- `P1-D05`：真實 LINE channel 與 Identity Platform staging exchange。
- `P1-E04`：staging migration/deploy/smoke workflow run。
- `P1-E05`：production 未批准時停留等待的 workflow 證據。
- `P1-E06`：staging rollback 前後 digest 與 smoke 演練。
- `P1-E07`：applied logging query、notification channel 與 alert 演練。
- `P1-F02`：未參與者完成的真實 staging deployment dry run。
- `P1-F04`：draft PR 的 review、ready 與 merge 證據。

在上述 required gates 全部取得直接證據前，Phase 1 不可宣告完成。

## 本輪驗證

本次稽核以 repository 文件與 source/config 的唯讀比對為主。前一輪稽核執行並通過：

- architecture tests：5/5。
- workspace unit tests：26。
- 12 個 workspace strict typecheck。
- 12 個 workspace lint。
- 12 個 workspace production build。
- full repository Prettier check。

Database/API integration 未在前一輪重新執行，以避免改動本機測試資料；採用 `docs/worklog.md` 已保存的 2026-07-20 證據：database 3/3、API 11/11，且相同 head 的 GitHub clean runner `verify` 成功。這些既有證據不會替代本報告所列缺口的專門 regression test，也不會替代任何外部 gate。

本報告完成後另執行 Markdown Prettier check 與 `git diff --check`；結果記錄於 `docs/worklog.md`。

## 建議處理順序

1. 由 billing owner 提供並核准各環境 budget input／saved plan。
2. 正式大量導流前建立可信 edge／Cloud Armor per-client rate limit。
3. 決定 audit retention/constraint，整理 task 與 acceptance 狀態語意。
