# 工作報告

此檔採 append-only 紀錄。每個工作階段至少記錄範圍、異動、驗證、決策、風險與下一步。

## 2026-07-14 — Phase 1 repository kickoff

### 範圍

- 將原始商業暨技術規劃匯入 repository。
- 建立 Phase 1 的文件治理、工程規範、Terraform 基礎與首批垂直任務。

### 已完成

- 建立產品基準文件、文件索引與根目錄 `AGENTS.md`。
- 建立 Phase 1 執行計畫與交付完成定義。
- 建立 monorepo 目錄與設定骨架。
- 建立 Terraform bootstrap、platform module、dev/stg/prod stacks 與操作 runbook。
- 建立 `P1-001` 至 `P1-005` 垂直任務與狀態索引。

### 決策

- 原始文件保留為 `docs/product/business-technical-plan.md`，作為最高階基準，不直接改寫其內容。
- Terraform 拆成一次性 bootstrap 與每環境 platform stack，避免 project/state 建立形成循環依賴。
- 目前只建立可審查的骨架，不執行 Terraform apply，也不建立會產生雲端費用的資源。

### 驗證

- 原始文件與 repo 內副本以 `cmp` 比對，結果完全一致。
- `package.json`、`turbo.json`、`tsconfig.base.json` 可由 JSON parser 讀取；`pnpm-workspace.yaml` 可由 YAML parser 讀取。
- 必要文件與 Terraform root/module 檔案皆存在且非空；垂直任務數量為 5。
- credential/private-key pattern scan 無命中。
- 本機未安裝 Terraform/OpenTofu CLI，因此尚未執行 `fmt`、`init` 或 `validate`；必須在 P1-002 或 CI 補做，不能視為已部署。
- Git 預設分支已由 `master` 改為規劃指定的 `main`；尚未建立 commit。

### 風險與未決事項

- 尚未取得 GCP organization/folder、billing account 與 project ID。
- 尚未決定 GitHub Actions 或 Cloud Build；任務暫以 GitHub Actions 為預設。
- LINE channel 與正式網域資訊尚未提供。

### 下一步

- 執行 `P1-001-repository-foundation.md`。

## 2026-07-14 — Initial GitHub publication

### 範圍

- 建立 repository 初始 commit，並發布至 `onitaiji4real/nook` 的 `main` 分支。

### 發布前檢查

- 工作樹只有本次 Phase 1 啟動檔案，repo 尚無既有 commit 或 remote。
- 初始 commit：`dd8c0bf`（`chore: bootstrap phase 1 repository`）。
- 已設定 `origin` 為 `https://github.com/onitaiji4real/nook.git`，並成功推送、追蹤 `origin/main`。
- 本段發布結果將以後續 documentation commit 保存。

## 2026-07-14 — Protect main development workflow

### 範圍

- 後續開發改在 `phase1`，禁止直接 commit 或 push 至 `main`。

### 已完成

- 從 `main` 建立並切換至 `phase1`。
- 更新 `AGENTS.md` 與 README，建立 `docs/git-workflow.md`。
- 新增版本化的 `.githooks/pre-push`，阻擋遠端 `main` 更新。
- 已設定本機 `core.hooksPath=.githooks`，並以 synthetic pre-push input 驗證：`phase1` 可通過、`main` 被拒絕。

### 限制與下一步

- 執行環境沒有 GitHub CLI，無法直接套用遠端 branch protection。
- repository 管理員仍須依 `docs/git-workflow.md` 在 GitHub Settings 啟用 `main` ruleset；本機 hook 不能取代 server-side protection。
- 本次變更必須提交並推送至 `phase1`，不得更新 `main`。

## 2026-07-14 — Install Microsoft commit skill

### 範圍

- 審查並安裝 Microsoft VS Code repository 的 `commit` Agent Skill。

### 審查與結果

- 已檢查 SkillsMP 頁面、GitHub tree 與完整 `SKILL.md`；來源目錄只有 `SKILL.md`，無 companion scripts、references 或 assets。
- 風險：skill 在只有 unstaged changes 時會執行 `git add -A`；使用前仍需人工確認 status/diff 與 secrets。
- 偏好的 `npx skills add https://github.com/microsoft/vscode --skill commit` 無法辨識該內部路徑，未安裝檔案。
- 改用 Codex skill installer 的精確 GitHub tree URL，成功安裝至 `~/.codex/skills/commit`。
- 安裝後 Git blob hash 為 `2bd73ac44c966cd5700b5a7b52ae19f88c3af3bc`，與審查來源完全一致；檔案數為 1。

### 後續

- Skill 將從下一個 turn 開始可用。

## 2026-07-14 — Start P1-001 repository foundation

### 範圍

- 將 monorepo 文件骨架實作為可安裝、可編譯、可測試的 Next.js／NestJS／Prisma workspace。

### 基線決策

- 任務狀態改為 `in_progress`，所有變更留在 `phase1`。
- Context7 未掛載，改以 Next.js、NestJS、Prisma、Turborepo 官方文件與 npm registry 核對設定。
- 目前 Node 為 20.17.0；Next.js 16 與 NestJS 11 相容，但 Prisma 7 要求 Node 20.19 以上，因此 Phase 1 鎖定 Prisma 6.19，避免無法在目前開發環境驗證。
- 採 Vitest 3、ESLint 9、TypeScript 5.9；不在 Phase 1 引入預約或公開業務 endpoint。

### 驗證

- 官方 `postgis/postgis:16-3.5` 無 ARM64 manifest；本機 compose 明確指定 `linux/amd64` 模擬，避免 Apple Silicon 啟動失敗。CI Ubuntu amd64 不受影響。
- Docker 首次下載 image 時因主機只剩約 2.0 GiB 而回報 `no space left on device`；使用者清出空間後已解除，未由自動化清除任何既有 images、volumes 或使用者檔案。

### 已完成

- 建立 13-project pnpm／Turborepo workspace，包含 Next.js web、NestJS API、NestJS worker 與共用 packages。
- 建立 PostgreSQL 16 + PostGIS Docker Compose、Prisma client、初始 schema 與顯式 deploy migration；application startup 不會自動執行 migration。
- 建立 web、API、worker 的 health/readiness endpoint；API 與 worker readiness 會探測資料庫並在不可用時回傳 503，但不揭露 DSN。
- 建立 request ID middleware、結構化安全 request log、敏感欄位 redaction 與對應 unit test。
- 建立 GitHub Actions CI，依序執行 frozen install、lint、typecheck、unit test、migration、integration test 與 build。
- 同步本機啟動 README、ADR 0001、任務狀態與 handoff；P1-003 解除依賴並改為 `ready`。

### 實際驗證

- `CI=true pnpm install --frozen-lockfile`：成功，13 個 workspace project 由 lockfile 重建，Prisma Client 6.19.0 成功產生。
- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`：全部成功；lint/typecheck/build 各 12 個 project 通過，unit test 共 9 項通過。
- fresh PostGIS database 已套用 `20260714000000_phase1_foundation`；再次執行 `pnpm db:migrate` 顯示無 pending migration。
- `pnpm test:integration`：3 項通過，確認 PostGIS extension、UserIdentity unique constraint 與 Membership tenant/user unique constraint。
- web production server 的 `/api/health`、`/api/readiness` 均回傳 200；API 與 worker 的 health 回傳 200，無 DB 時 readiness 回傳 503，連接 DB 後回傳 200。
- API 與 worker 的 smoke test 均回傳 `x-request-id`，結構化 log 未包含 database URL。
- Prisma schema validate、CI/workspace YAML parse、root JSON parse、`git diff --check` 與原始產品文件 `cmp` 均通過。

### 決策與風險

- 目前開發機 Node 20.17.0 不符合 Prisma 7 的最低 Node 20.19，因此鎖定 Prisma 6.19；升級 Node 後需另開 dependency upgrade 任務評估 Prisma 7 migration。
- Apple Silicon 本機透過 `linux/amd64` 執行官方 PostGIS image，啟動速度可能比原生 image 慢；GitHub Actions amd64 runner 不受影響。
- CI workflow 已完成本機語法與等價命令驗證，但尚未取得遠端 GitHub Actions run 結果；推送 `phase1` 後需確認第一個 workflow。
- Terraform CLI 驗證與 GCP apply 不屬於本任務，維持在 P1-002；未建立任何雲端付費資源。

### 下一步

- 開始 P1-003 Tenant onboarding and RBAC，或並行處理 P1-002 Terraform cloud foundation；兩者都必須使用獨立 task branch 或 `phase1`，不得直接更新 `main`。

## 2026-07-14 — Phase 1 acceptance baseline and P1-002 start

### 範圍

- 將 Phase 1 完成定義拆成可重現、可追溯的 required gates。
- 開始 P1-002 Terraform cloud foundation；不執行任何 Terraform apply。

### 決策

- 驗收狀態固定為 `PASS`、`FAIL`、`BLOCKED`、`NOT_RUN`；只有所有 required gate 為 `PASS` 才能宣告 Phase 1 完成。
- 明確分離 local/static、provider plan 與 actual cloud evidence，避免以 mock 或語法檢查冒充已部署。
- 後續每個 scoped commit 的第一行只放重點，body 同時使用中文與英文記錄範圍、原因、驗證與風險。

### 驗收基準

- 建立 `docs/phase-1/acceptance-standard.md`，涵蓋 repository、database、Terraform/GCP、tenancy/RBAC、LINE/Identity Platform、CI/CD、observability 與交接。
- B05、D05、E01、E04～E07 需要外部 GCP、LINE 或 GitHub 管理權限；在取得直接證據前即使本機實作完成也不得標記 Phase 1 完成。

### 下一步

- 完成 P1-002 的 Terraform security/runtime/WIF/monitoring contract與自動化驗證。

## 2026-07-14 — Complete P1-002 Terraform cloud foundation

### 已完成

- 為 dev/stg/prod 建立環境專用 GitHub deployer service account 與 WIF pool/provider；condition 同時限制 `onitaiji4real/nook` 與對應 GitHub Environment。
- `deploy_runtime=true` 強制 web/api/worker 三個 image 全部使用 sha256 digest；worker 維持 internal ingress，web/api 才能 public invoke。
- Cloud Run runtime contract 加入 startup/liveness probe 與最小 Secret Manager 注入；worker 不再取得 LINE secret。
- Cloud SQL 強制 private IP 與 `ENCRYPTED_ONLY`；新增 Cloud Run 5xx alert、platform-oncall owner 與 runbook link。
- 建立 Terraform mocked tests、dev/stg/prod isolation/credential check 與可重現的 validation script。
- 更新 Terraform runbook、P1-002 handoff 與 Phase 1 acceptance evidence；P1-005 因 runtime contract 完成改為 `ready`。

### 實際驗證

- 安裝並使用 Terraform 1.15.8；五個 configuration 以 Google provider 6.50.0 完成 `init -backend=false` 與 `validate`。
- `terraform test`：3 passed，涵蓋 foundation-only、mutable/incomplete image 拒絕、immutable runtime/private worker。
- `node infra/terraform/scripts/check-isolation.mjs`：通過 dev/stg/prod project example、backend prefix、environment、WIF repo 與 credential pattern 檢查。
- Trivy 0.72.0 首次找到三環境 Cloud SQL 未強制 TLS；加入 `ssl_mode = "ENCRYPTED_ONLY"` 後重掃，HIGH/CRITICAL finding 為 0。
- `terraform fmt -check -recursive` 與 `git diff --check` 通過。

### 未執行與風險

- 沒有 GCP credentials、organization/folder、billing account 與唯一 project IDs，因此未執行 provider-level dev plan、bootstrap、apply 或 post-apply query；P1-B05 保持 `BLOCKED`，不得稱為已部署。
- notification channel resource names 尚未提供；alert policy contract 已建立，但實際通知路由必須在 apply checklist 補齊。
- WIF 使用 GitHub `environment` claim；後續 workflow 必須宣告完全相同的 dev/stg/prod environment，否則 token exchange 會 fail closed。

### 下一步

- 執行 P1-003 Tenant onboarding and RBAC。

## 2026-07-14 — Complete P1-003 tenant onboarding and RBAC

### 已完成

- 建立 `POST /v1/tenants`、`GET /v1/tenants/:tenantId`、`GET /v1/me`，以 Zod 驗證輸入並以 RFC 9457 Problem Details 回應穩定錯誤碼與 requestId。
- 建立可替換 `IdentityTokenVerifier`、Nest authentication guard 與 fail-closed default；沒有加入可被 production 使用的測試 header 或 development token bypass。
- 建立 Prisma tenant repository 與 application service；tenant + OWNER membership + tenant.created audit 使用單一 transaction。
- tenant read 每次顯式帶 `tenantId` 並查 ACTIVE membership；跨租戶與 suspended membership 都拒絕，並寫入 authorization.denied audit。
- AuditLog 以 expand-only migration 新增 nullable request_id 與 tenant/request index；新事件不保存 name、profile、request body 或 token。
- 新增 OpenAPI 3.1、identity/tenancy data dictionary、RBAC threat notes 與 architecture tests。

### 實際驗證

- migration `20260714010000_audit_request_id` 已成功套用到本機 PostGIS；Prisma schema validate 通過。
- `pnpm test`：新增 duplicate slug/membership conflict classifier 與 controller/repository architecture tests，全套 unit tests 通過。
- `pnpm test:integration`：database 3 tests + API 7 tests 全部通過；API suite 涵蓋 atomic create、rollback、duplicate slug、cross-tenant denial、suspended membership、`GET /v1/me`、missing auth。
- captured logs 證明 authorization.denied 不包含 synthetic tenant/user name；audit row 只含 safe IDs、action、resource、requestId。
- OpenAPI YAML parse 且三個規定 path 完整；controller static test 證明沒有 Prisma import。
- 初次 e2e 發現 Vitest transpilation 不產生 constructor metadata，導致 controller service undefined；改用明確 `@Inject(TenantApplicationService)` 後完整 suite 通過，production/test DI 行為一致。

### 決策與剩餘風險

- P1-003 不自行信任 LINE token；default verifier 回 503 fail closed。P1-004 必須以 Identity Platform ID token verifier 完成 production authentication。
- 無 active membership 統一回 403，不區分 tenant 不存在或無權限，降低 IDOR enumeration。
- P1-003 只定義 OWNER/MANAGER/STAFF/VIEWER enum 與 active membership gate；逐操作 permission matrix 隨 Phase 2 resource contract 定義。

### 下一步

- 執行 P1-004 LINE login exchange 與 Identity Platform adapters。

## 2026-07-14 — Start P1-004 LINE login exchange

### 範圍與安全決策

- 登入端點只接受 raw LINE ID token 與 nonce；不接受前端提供的 LINE userId 作為身分證明。
- LINE adapter 驗證 issuer、channel audience、expiry 與 nonce，並對外部呼叫設定 timeout；錯誤回應不揭露 token、email 或 provider subject。
- Identity Platform 使用 Application Default Credentials 與 service account impersonation/signBlob；不建立或提交 service-account JSON key。
- local identity 以 `(provider, providerSubject)` unique constraint 與 transaction 保證重試及 concurrent exchange 的 idempotency。

### 進度

- 任務狀態改為 `in_progress`；開始建立 typed config、adapter contract、application service、API 與測試。

## 2026-07-14 — Complete P1-004 LINE login exchange

### 已完成

- 新增 `POST /v1/auth/line/exchange`；request 僅允許 raw ID token 與至少 16 字元 nonce，成功只回 `customToken` 與 `expiresIn=3600`，不建立 cookie。
- LINE adapter 呼叫官方 verify endpoint，設定 3 秒 timeout，並 defense-check issuer、channel audience、expiry、nonce 與 subject；invalid identity 回 401，timeout/unavailable 回 503 Problem Details。
- 新增 Prisma identity repository；transaction 與 `(provider, providerSubject)` unique constraint 保證重試與 concurrent exchange 只留下單一 User/UserIdentity。
- 新增 Firebase Admin adapter，使用 ADC 建立 custom token並驗證後續 bearer ID token；`AUTH_ADAPTER_MODE=disabled` 預設 fail closed，firebase mode 缺必要 typed config 時啟動失敗。
- Terraform API runtime 注入非秘密的 LINE channel/project/service account identifiers；API service account 只取得對自身的 token creator binding。移除目前流程不使用的 LINE channel secret 與 accessor。
- 新增 ADR 0002、OpenAPI、login sequence、profile allowlist 與 runtime 設定文件；`firebase-admin` 13.9.0 鎖版，支援目前 Node 20 runtime。

### 實際驗證

- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`：12 個 workspace project 全部成功；相關 unit tests 16 項通過。
- 本機 PostGIS 啟動後，database integration 3 項通過；API integration 共 11 項通過，其中 LINE exchange 4 項、tenant/RBAC regression 7 項。
- concurrent exchange 兩個 request 都回 200，資料庫只有一個 synthetic LINE identity 與一個 user；captured log 不含 raw token、LINE subject 或 synthetic email。
- `infra/terraform/scripts/validate.sh`：bootstrap、module、dev/stg/prod 五個 configuration validate，3 個 mocked tests與 isolation check 全部通過。
- Trivy Terraform HIGH/CRITICAL finding 為 0；OpenAPI YAML 與 workspace formatting 通過。

### 修正紀錄與風險

- 初次 integration run 因 shell 未帶 `DATABASE_URL`、本機 PostGIS 未啟動而失敗；補齊既有 `.env.example` 連線並啟動容器後通過。
- 新增 workspace dependency 後，首次 API integration 無法解析 `@nook/line`；更新 lockfile importer、重新連結並先 build workspace packages 後通過。
- 新 controller 初次未套 Problem Details filter，讓 application error 變成 Nest 500；補上 filter 後 401/503 contract 通過。
- P1-D05 仍 `BLOCKED`：沒有真實 staging LINE channel/Identity Platform 設定與批准，因此未執行 provider exchange，也未建立任何外部登入或雲端資源。

### 下一步

- 執行 P1-005 CI/CD and observability；dependency/container scan 必須涵蓋新增的 `firebase-admin` runtime dependency。

## 2026-07-14 — Start P1-005 CI/CD and observability

### 範圍與部署界線

- PR CI 不取得 GCP credential，只執行可重現的 code/database/Terraform/dependency/container checks。
- staging 與 production 分別使用 `stg`、`prod` GitHub Environment 與對應 WIF principal；production 必須由 Environment reviewer 人工批准。
- migration 是獨立 deployment step/job；application startup 不執行 migration，migration 或 smoke 失敗時 workflow 立即停止。
- deploy 只使用 commit SHA tag 解析出的 image digest；Cloud Run runtime contract 不接受 mutable tag。

## 2026-07-14 — Complete P1-005 CI/CD and observability implementation

### 已完成

- 建立 SHA-pinned GitHub Actions PR CI、staging reusable deployment 與 manual-only production workflow；PR jobs 只有 read permission，部署才透過 environment-bound OIDC/WIF 取得短期憑證。
- 建立 web/API/worker multi-stage Dockerfiles。runtime 固定 Google distroless Node 24 Debian 13 digest，以 `65532:65532` 執行且不含 shell/package manager；API/worker production prune 後在 image build 明確產生 Prisma Client。
- 建立 Cloud Run migration Job，直接透過 distroless Node binary 執行 Prisma CLI；application startup 不執行 migration。部署先 migration，再建立 zero-traffic candidate、smoke/Ready、promote，失敗時 best-effort 回復先前 revisions。
- 建立 request/security log 的 service/version/environment/requestId 維度與 redaction tests；Terraform 新增 service health dashboard，既有 5xx alert 綁 owner/runbook。
- 新增 CI contract、deployment/rollback runbook、Docker/runtime 說明與 ADR 0003；Node 基線由已 EOL 的 20.17 升級至 24.17，workspace 使用 pnpm 11.7 與 Node 24 types。
- pnpm 11 啟用 supply-chain lockfile policy、明確允許必要 dependency build scripts、workspace injection；鎖定成熟 Turbo/`@types/superagent`，並將有 advisory 的 `effect`、Vite、Vitest 升級到修補版本。

### 實際驗證

- Node 24.14 / pnpm 11.7：frozen install、format/check、lint、typecheck、unit tests、build 全數成功；12 個 workspace project lint/typecheck/build 通過。
- 本機 PostgreSQL/PostGIS migration 顯示 2 migrations、無 pending；序列化後 `pnpm test:integration` 連續兩輪皆為 database 3 tests + API 11 tests 通過。
- workflow security/ordering checker與 `bash -n infra/ci/deploy-cloud-run.sh` 通過；production dependency audit 無 HIGH/CRITICAL，尚有 2 個 moderate。
- Terraform bootstrap/module/dev/stg/prod 五個 configuration validate、3 個 mock tests、environment isolation 全數通過；Trivy Terraform HIGH/CRITICAL 為 0。
- web/API/worker images 建置成功，`Config.User` 均為 `65532:65532`；三服務 health/readiness、Docker healthcheck 與 distroless migration command 均成功。
- Trivy 使用最新本機 database 掃描最終三個 images：web 0、API 0、worker 0 個 HIGH/CRITICAL finding。

### 修正紀錄與決策

- pnpm 11 首次安裝拒絕 24 小時內發布的 Turbo 2.10.5 與 `@types/superagent` 8.1.11；未放寬 policy，改釘選成熟版本並依官方提示重建 lockfile。
- pnpm 11 `deploy` 要求 workspace injection；啟用 `injectWorkspacePackages`，並在 API/worker 明確宣告 runtime Prisma Client，避免 production prune 遺漏 generated client。
- 初版 worker image 仍使用 default 8081，與 Cloud Run 8080 contract 不符；runtime 明確設定 `PORT=8080` 後 smoke 通過。
- 官方 Node 20 slim image掃出 Debian 16 與 npm 12 個 HIGH；升至 Node 24 後最新 Trivy 又出現 Debian 12 無 fix 的 16 HIGH/3 CRITICAL。未建立 ignore，改用 digest-pinned Google distroless Debian 13，最終三 image 歸零。
- integration suites 原先由 Turbo 平行清理同一 database schema，最後重跑捕捉到 membership FK race；root integration contract 改為 `--concurrency=1`，連續兩次通過。

### 外部 gate 與下一步

- P1-005 repository implementation 標記 `done`；P1-E02、E03 有直接本機/config evidence。
- P1-E01、E04～E07 仍 `BLOCKED`：尚缺 GitHub ruleset/Environment reviewer、遠端 successful run、staging deploy/rollback、applied dashboard query 與 notification channel。沒有執行 Terraform apply、推送 branch、建立 PR 或任何 production 變更。
- repository admin 與 platform owner 解除外部 gate 後，從 clean checkout 執行 final acceptance，再以 reviewed PR 將 `phase1` 合併到 `main`。

## 2026-07-14 — Phase 1 repository handoff checkpoint

### Implementation commit inventory

- `b073bb5` — repository foundation。
- `ed804a1` — Phase 1 acceptance gates。
- `1d1f959` — Terraform cloud foundation contract。
- `1845586` — tenant onboarding and RBAC vertical slice。
- `9dda3e8` — LINE identity exchange vertical slice。
- `4da34f3` — secure CI/CD and observability delivery baseline。

### 交接狀態

- P1-001～P1-005 repository tasks 皆完成並留在 `phase1`；未直接 commit 或 push `main`，也尚未推送本輪六個 commits。
- 文件/contract gate P1-F01、worklog gate P1-F03 可由 repository 直接驗證，標記 `PASS`。
- P1-F02 尚缺 staging deployment dry run；P1-F04 尚缺 GitHub ruleset 與 reviewed PR，維持 `BLOCKED`。
- 整體 Phase 1 尚未完成：B05、D05、E01、E04～E07、F02、F04 必須取得外部直接證據後才能宣告完成。

## 2026-07-14 — Clean-checkout final acceptance and remote audit

### 唯讀 GitHub 證據

- `git ls-remote --heads origin` 確認遠端只有 `main@dd5f146` 與舊的 `phase1@d1ea43d`；本機仍未 push。
- GitHub public repository API 確認 default branch 為 `main`；Actions API 回報 `total_count: 0`，因此 P1-E01 沒有 remote successful run 可引用，維持 `BLOCKED`。
- 本機沒有 `gh` CLI，也沒有使用或輸出任何 GitHub credential；未嘗試修改 ruleset、Environment 或 repository settings。

### Clean checkout 驗證

- 從 `phase1@7e0f70b` 建立無 hardlink 的 `/private/tmp/nook-phase1-final` clone；初始工作樹乾淨。
- clean checkout 以 pnpm 11.7 supply-chain policy 與 frozen lockfile 重建 13 個 workspace projects；format、12-project lint/typecheck/build、unit tests 全數通過。
- 本機 PostGIS migration 顯示 2 migrations、無 pending；database 3 tests、API 11 tests 通過。
- workflow security/ordering、deploy shell syntax、Terraform 五個 validate/3 mocks/isolation、Terraform Trivy、production audit 全數符合 gate；audit 僅有 2 moderate。

### Provider lockfile 修正

- clean checkout 的 Terraform init 重新建立五份 `.terraform.lock.hcl`，證明既有 ignore policy 讓 CI provider resolution 可漂移。
- 移除 lockfile ignore，為 bootstrap/module/dev/stg/prod 固定 Google provider 6.50.0，納入 `darwin_arm64` 與 `linux_amd64` 已簽署 checksums。
- `validate.sh` 改用 `-lockfile=readonly`；未來 provider 升級必須顯式更新並審查 lockfile，CI 不得靜默改寫。

## 2026-07-14 — Exact-head clean-checkout acceptance

### 驗收基準

- 以含 provider lockfile 修正的 `phase1@a8e1db4` 建立 `/private/tmp/nook-phase1-final-locked` clean checkout；本節驗證的是程式與基礎設施 exact head，後續文件紀錄 commit 不改變該驗收內容。
- frozen install 與 pnpm 11 supply-chain policy 通過；format、12-project lint/typecheck/build、18 個 unit task、database 3 tests 與 API 11 tests 全數成功。

### Infrastructure、供應鏈與映像證據

- workflow security/ordering checker與 deploy shell syntax 通過；Terraform bootstrap/module/dev/stg/prod 均以 committed lockfile readonly init/validate 成功，3 個 mock tests、environment isolation 與 Terraform Trivy HIGH/CRITICAL 0 全數通過。
- production `pnpm audit --prod --audit-level high` exit 0；目前只有 2 個 moderate，沒有 high/critical。
- 從 clean checkout 重建 web/API/worker images；三者 `Config.User` 均為 `65532:65532`，Trivy image HIGH/CRITICAL 均為 0。
- distroless API image 執行 `prisma migrate deploy` 成功，確認 2 個 migrations 且無 pending；application startup 沒有執行 migration。
- web、API、worker 容器皆達 Docker `healthy`；各自 health/readiness 共六個 endpoint 均成功並回報版本 `a8e1db4`，臨時驗收容器已清除。
- 所有驗證結束後 clean checkout 維持乾淨，證明 readonly Terraform init 沒有改寫 committed provider lockfiles。

### Handoff 與剩餘 gate

- repository 內可完成的 Phase 1 自動化驗收已在 exact head 通過；P1-001～P1-005 task 狀態維持 `done`。
- Phase 1 整體仍不可宣告完成：B05、D05、E01、E04～E07、F02、F04 仍需要 GCP/LINE staging、GitHub ruleset與 Environment、遠端 workflow、部署/rollback、observability notification 及 reviewed PR 的直接證據。
- 本輪未執行 Terraform apply、未建立或修改外部資源、未 push，亦未更新 `main`。

## 2026-07-14 — Harden Phase 1 request correlation evidence

### Completion audit 發現

- 逐項比對 P1-A04 必要證據時，確認 API/worker middleware 會回 `x-request-id`，但 Next.js web health/readiness routes 只有 body 與 `Cache-Control`；先前 runtime smoke 因只記錄 JSON body，未證明三服務 correlation contract。
- 共用 HTTP request log 原有 service/version/environment/requestId，但缺少 AGENTS.md 要求的 operation/outcome；401/403 也無一致 failure outcome 可供查詢。

### 修正

- 新增 web probe response helper：只接受 1～128 字元安全 request ID，否則產生 UUID；health/readiness 均回 `x-request-id`、`Cache-Control: no-store` 與既有固定 body schema。
- web 透過既有 `@nook/observability` 輸出結構化 request completion log，不記錄任意 request headers、token 或 PII。
- 共用 request log 新增 `operation=http.request`；HTTP status 400 以上為 `outcome=failure`，500 以上才使用 ERROR severity。
- 新增 web route tests 與 observability 2xx/4xx/5xx outcome tests；workspace lockfile 明確加入 web 對 observability package 的依賴。

### 實際驗證

- frozen install 與 pnpm supply-chain policy、format、12-project lint/typecheck、18 個 unit tasks、database 3 tests、API 11 tests與 12-project build 全部通過。
- 從目前工作樹重建 web/API/worker 三個 distroless production images；三者皆為 `healthy`、`65532:65532`，六個 health/readiness endpoints 均回 200、固定 schema 與傳入的安全 `x-request-id`。
- web runtime 另驗證不安全 request ID 被 UUID 取代；三服務 container logs 均含 service/version/environment/requestId/operation/outcome。
- Trivy 掃描三個最終 images，HIGH/CRITICAL findings 分別為 0、0、0。

### 修正過程與剩餘風險

- 第一次 web test 直接執行 package script時讀到舊的 observability dist；依 Turbo `^build` 契約先重建 dependency 後通過，完整 root test 亦通過。
- 第一次 integration 未注入 `DATABASE_URL`，第二次在受限 sandbox 無法連 localhost；確認 PostGIS container healthy 後，以允許本機 Docker 網路的相同 DSN 重跑即全部通過。
- P1-E07 仍為 `BLOCKED`：本輪補的是 repository/runtime log 證據，尚未取得 applied Cloud Logging query、alert notification channel 與 staging 通知演練。
- 本輪未 push、未 apply Terraform、未建立外部資源，也未更新 `main`。

## 2026-07-14 — Verify request correlation from exact-head clean checkout

### 驗收基準與結果

- 從 implementation commit `phase1@4fa1719` 建立 `/private/tmp/nook-phase1-correlation-final` 無 hardlink clone；初始與最終工作樹皆乾淨。
- clean checkout frozen install 與 pnpm supply-chain policy 通過；無 Turbo cache 的 format、12-project lint/typecheck/build、18 個 unit tasks、database 3 tests、API 11 tests全部成功。
- workflow security/ordering、deploy shell syntax、Terraform 五個 readonly validate、3 mocks、environment isolation、Terraform Trivy 與 production audit 全數通過；audit 維持 2 moderate、無 high/critical。
- 從 clone 重建 web/API/worker exact-head images；distroless migration command 確認 2 migrations、無 pending，三個容器皆 `healthy` 且以 `65532:65532` 執行。
- 六個 runtime probes 均回 200 與傳入的安全 `x-request-id`；三服務 logs 直接顯示 `version=4fa1719` 及完整 correlation/operation/outcome 維度。
- exact-head web/API/worker images 的 Trivy HIGH/CRITICAL findings 分別為 0、0、0；臨時 runtime containers 均已清除。

### 結論

- P1-A04 的 repository/runtime 直接證據現已完整；P1-E07 的 repository/runtime 部分也已可重現。
- P1-E07 仍不能標為 PASS，因 applied Cloud Logging query、notification channel 與 staging alert 演練屬外部 gate；其餘 B05、D05、E01、E04～E06、F02、F04 亦維持 `BLOCKED`。
- 本輪未 push、未 apply Terraform、未修改 GitHub/GCP/LINE 外部設定，也未更新 `main`。

## 2026-07-14 — Refresh read-only GitHub gate evidence

### 唯讀結果

- `git ls-remote --heads origin` 顯示遠端仍為 `main@dd5f146`、`phase1@d1ea43d`；本機 `phase1` 領先 11 commits，沒有自動 push。
- 不帶 credential 的 GitHub Actions API 回 `HTTP 200`、`total_count=0`；沒有 successful run 可作 P1-E01 直接證據。
- rulesets API 回 `HTTP 200` 與空陣列；目前沒有 required checks 或 main protection ruleset 可作 P1-E01/F04 證據。
- environments API 回 `HTTP 200`、`total_count=0`；目前沒有 `stg`/`prod` Environment 或 reviewer protection 可作 P1-E05 證據。

### 結論與安全界線

- P1-E01、E05、F04 維持 `BLOCKED`，解除順序為：明確批准 push `phase1`、repository admin 建立 ruleset/environments、遠端 CI 通過，再建立 reviewed `phase1` → `main` PR。
- 查詢全程未使用或輸出 GitHub token，未修改任何 repository setting；本輪仍未 push 或更新 `main`。

## 2026-07-14 — Push Phase 1 and verify remote CI

### Push 安全界線

- 使用者在明確得知下一步為 push `phase1` 後指示繼續；推送前確認工作樹乾淨、本機 `phase1@d038606` 領先遠端 12 commits。
- `git push origin phase1` 成功，遠端由 `d1ea43d` fast-forward 至 `d038606`；再次查詢確認 `main` 仍為 `dd5f146`，沒有直接更新或合併 main。

### GitHub Actions 直接證據

- push 自動觸發 CI [run #1](https://github.com/onitaiji4real/nook/actions/runs/29344526296)，head branch `phase1`、head SHA `d038606`、event `push`。
- run 於 2026-07-14T15:17:12Z 完成，結論 `success`；`verify`、`terraform`、`container-images (web)`、`container-images (api)`、`container-images (worker)` 五個 jobs 全部 success。
- remote verify job 涵蓋 frozen install、lint、typecheck、unit、migration、integration、build 與 production audit；Terraform job 涵蓋 readonly contract validation 與 config scan；三個 image jobs涵蓋 build、non-root assertion 與 Trivy scan。

### Gate 更新與剩餘限制

- P1-E01 現已有 successful workflow run，但 GitHub rulesets API 仍為 `[]`，checks 尚未被設定為 required，因此 gate 維持 `BLOCKED`。
- P1-E02 新增 remote CI 直接證據並維持 `PASS`；P1-F04 的 push 部分已完成，但仍缺 ruleset 與 reviewed `phase1` → `main` PR。
- 嘗試只檢查 Git credential helper 是否可提供管理憑證時，被安全政策判定為不必要的 credential probing 而拒絕；沒有讀取、輸出或繞過取得 token，也沒有修改 GitHub settings。

## 2026-07-15 — Establish GitHub protection and draft Phase 1 review

### 授權與 credential 安全

- 使用者明確授權使用現有 Git credential helper 的 GitHub credential，並允許建立 ruleset、Environments 與 draft PR。
- Credential 只在單次 shell process 的記憶體變數中傳給 GitHub API；未顯示、未寫入 repository/暫存檔/log，命令結束前已 unset。
- Authenticated readback 確認 `onitaiji4real` 對 repository 具 admin 權限；本輪沒有設定 GCP/LINE secrets、沒有觸發 production deployment，也沒有更新或合併 `main`。

### GitHub 保護設定

- 建立並讀回 active `main` ruleset `Protect main via reviewed PR` #18939233；僅套用 `refs/heads/main`，無 bypass actor。
- Ruleset 禁止 deletion 與 non-fast-forward，要求 linear history、pull request、review thread resolution，並只允許 squash/rebase merge。單一 maintainer 情境的 required approval count 為 0，但 Phase 1 handoff gate 仍要求實際 review 證據。
- Strict required checks 為 `verify`、`terraform`、`container-images (web)`、`container-images (api)`、`container-images (worker)`；完全對應 CI job contexts。
- 建立 `stg` 與 `prod` GitHub Environments，兩者的 custom deployment branch policy 都只允許 `main`；`prod` 要求 `onitaiji4real` reviewer，`prevent_self_review=false` 保留單一 maintainer 的手動核准流程。
- Environments 中未寫入任何虛構或尚未批准的 GCP variables/secrets。`P1-E05` 仍維持 `BLOCKED`，因尚未觸發 production workflow 以取得未核准時停留等待的直接證據。

### Draft PR 與遠端 CI

- 建立 draft PR [#1 Phase 1 平台骨架 / Phase 1 platform foundation](https://github.com/onitaiji4real/nook/pull/1)：base `main@dd5f146`、head `phase1@22ec58b`，API 讀回為 open/draft/mergeable/clean。
- PR body 明確要求不合併，並列出 GCP apply、真實 LINE/Identity Platform staging、staging deploy/rollback/observability 與最終 review/checks 等未完成 gate。
- Pull request 觸發 [CI run #3](https://github.com/onitaiji4real/nook/actions/runs/29348356639)，`verify`、`terraform` 與 web/API/worker 三個 container jobs 全部 completed/success；此 run 與 active ruleset 讀回共同完成 `P1-E01` 直接證據。

### 文件驗證

- 以 repository 已安裝的 Prettier 針對本輪三個 Markdown 檔執行 check，結果全部符合格式；`git diff --check` 亦通過。
- Root `pnpm format:check` 首次因系統 Node 20/pnpm 9 低於專案要求而拒絕；改用 bundled Node 24.14/pnpm 11.7 後，pnpm 因現有 `node_modules` 由不同 runtime 建立而要求重建。本輪為純文件變更，為保留使用者依賴目錄而沒有執行 purge/reinstall，改以相同 committed Prettier 驗證。

### 剩餘 gate 與下一步

- `P1-B05`：需 GCP organization/folder/billing、三個唯一 project ID 與 owner-approved Terraform apply。
- `P1-D05`：需真實 LINE channel 與 Identity Platform staging 驗證。
- `P1-E04`～`P1-E07`：需 staging deployment、production approval wait、rollback、applied dashboard/log query/notification 直接證據。
- `P1-F02`需 staging dry run；`P1-F04` 已有 ruleset/draft PR/CI，但仍需 review、ready 與 merge 證據。上述完成前 PR 維持 draft，不合併 `main`。

## 2026-07-15 — Enforce repository structure and workspace boundaries

### 目標與分層稽核

- 從 Phase 1 repository foundation 選定「將專案分層轉成可執行 contract」作為本輪可本機閉環的目標；不擴張至 Phase 2 店家功能。
- 實際盤點確認根目錄的 `apps`、`packages`、`infra`、`docs`、`tests` 與 `.github/workflows` 符合產品規劃；三個 deployable apps、九個 Phase 1 shared packages 與 dev/stg/prod Terraform stacks 齊全。
- `apps/api/src` 目前僅有 health、identity、tenancy 三組 Phase 1 capability，平面檔案仍可接手；Phase 2 開始 merchant/location/staff/service vertical slices 時必須依 module 建立子目錄，不得繼續把新 controller/service 堆在 app root。
- 發現 README 仍列 Node 20.17/pnpm 9.9，與實際 `package.json` Node 24.14/pnpm 11.7 contract 不一致；本輪已更正並指定 `package.json`/`.nvmrc` 為權威來源。

### 實作與負向 contract

- 新增 `infra/ci/check-repository-structure.mjs`，檢查必要目錄、workspace manifest 命名/private/scripts、`.nvmrc`/engine/pnpm workspace 一致性，並要求內部依賴使用 `workspace:` protocol。
- Source boundary 禁止 app 直接依賴另一 deployable app、shared package 依賴 app、relative import 逃出 workspace，或使用未在 manifest 宣告的 `@nook/*` import。
- Tracked-file contract 阻擋 `node_modules`/dist/Next/Turbo/pnpm/Terraform cache、Terraform state/plan、`.DS_Store` 與非 example `.env` 進入 Git。
- 新增 5 個 Node test，直接驗證 module specifier 擷取、產物拒絕、未宣告/跨界 import 拒絕與合法 package-to-package import。
- `pnpm check:architecture` 會先 lint 所有 `infra/ci/*.mjs`，再執行負向測試、live repository checker 與既有 workflow security/order checker；GitHub `verify` job 已在 lint 前強制執行。

### 本機驗證與限制

- 鎖定 Node 24.14 直接執行：5 個 architecture tests、live repository structure/dependency checker、workflow security/order checker、full repository Prettier 與原 package scopes ESLint 全數成功。
- apps/web/api/worker 與九個 packages 共12 個 strict typecheck 通過；九個 package builds、API/worker TypeScript build 與 Next.js production build 通過。
- 原有 workspace unit suites 全數通過：API 6、web 2、worker 2、config 4、contracts 1、database 2、LINE 5、observability 4，共 26 tests；無 test 的界面 package 依既有 `passWithNoTests` contract 通過。
- Integration suites 在 sandbox 中無法連入已確認 healthy 的 localhost PostGIS，因此本機這次 run 是環境性失敗，不計為通過；本輪沒有 schema/dependency/lockfile 變更，推送後必須以 GitHub clean runner 的 migration + database/API integration 結果完成驗收。
- 隔離副本 frozen install 成功，但 Codex fallback pnpm 在 Turbo 子程序重複要求重裝；Prisma cache 擴權又因 Codex 額度限制被系統拒絕。沒有繞過權限，也沒有清除原 workspace 依賴。

### 下一步

- 建立 scoped commit 並推送 `phase1`，確認 draft PR 新 head 的 `verify`、`terraform` 與三個 container jobs 成功。
- GitHub clean runner 通過後，再以獨立文件 commit 記錄 run URL 與 final evidence；不合併 `main`。

## 2026-07-20 — Complete repository boundary local acceptance

### Commit 與 Git 狀態核對

- Repository boundary implementation 已以 scoped commit `2354a66 build(ci): 強制專案分層 / enforce repository boundaries` 完成；commit body 以中英文記錄範圍、原因、驗證與風險，首行僅保留單一重點。
- 首次 `git push origin phase1` 因當時 Codex 工具額度上限被自動核准系統拒絕；未繞過、未更換 credential 傳遞方式，GitHub 沒有收到該次 push。
- 2026-07-20 以不帶 credential 的 `git ls-remote --heads origin main phase1` 再次確認：遠端 `main@dd5f146`、`phase1@bbfb93d`；本機 `phase1@2354a66` 領先一個 commit。`main` 未被更新或合併。

### 本機最終驗證

- 先前 integration run 在預設 sandbox 內無法連線 `localhost:5432`，因此明確記為環境性失敗，沒有將失敗結果冒充為通過。
- 工具額度恢復後，在允許本機網路且不更動 database/schema 的相同 `DATABASE_URL` 下重跑：PostGIS/database integration 3/3 通過；API integration 11/11 通過。
- Database suite 再次驗證 PostGIS extension、provider identity unique constraint 與 membership tenant/user unique constraint。
- API suite 再次驗證 tenant atomic create/rollback、duplicate slug、cross-tenant denial、suspended membership、`GET /v1/me`、missing auth，以及 LINE exchange success、concurrency idempotency、invalid token 與 timeout mapping。
- 結合 2026-07-15 同一 implementation head 的結果，本輪最終本機證據為：architecture 5 tests、unit 26 tests、integration 14 tests、12 strict typechecks、full format/package-scope lint、9 package builds 與 web/API/worker production builds 全部通過。

### 結論與下一步

- Phase 1 頂層分層為可接手狀態，且現已有自動邊界 contract；`apps/api/src` 的平面 Phase 1 檔案不阻擋本輪驗收，但 Phase 2 新 vertical slices 必須依 module 建立子目錄。
- 本輪指定的 repository boundary 目標在本機已完成且測試通過；遠端 clean-runner 證據仍依賴推送 `phase1`。
- 下一個授權動作是 `git push origin phase1`；push 後必須確認 draft PR 新 head 的 verify/terraform/三個 container jobs，再以獨立文件 commit 記錄 run URL。

## 2026-07-20 — Review API structure for Phase 2 maintainability

### 稽核結論

- Repository 頂層以 `apps/web`、`apps/api`、`apps/worker`、共享 `packages`、`infra`、`docs` 與 `tests` 分離，符合 modular monolith 與三個 deployable applications 的既定方向，無須改成微服務。
- `apps/api/src` 目前只有 health、identity 與 tenancy 等 Phase 1 能力，共 21 個來源檔、約 710 行；現階段仍可維護，但所有 controller、application service、adapter、token 與共用 HTTP 元件平放在同一層，不能沿用到 Phase 2 的 merchant/location/staff/service/schedule/booking 功能。
- 現有 architecture checker 能阻止 workspace 間的非法依賴、未宣告的 `@nook/*` import、app-to-app import 與追蹤 generated artifacts，但尚未限制 `apps/api` 內部 feature/module 之間的依賴方向。
- Controller 沒有直接存取 Prisma；`AppModule` 只在 composition root 建立 `@nook/database` repository adapter，符合目前規則。不過若持續把 provider registration 集中在 root module，該檔會成為後續擴充瓶頸。

### Phase 2 前建議邊界

- 保留 `apps/api` 作為 deployable/composition root，將共用 HTTP、認證、設定與 health 能力移入 `common` 或 `platform` 子目錄。
- 每個業務能力建立獨立 Nest module，例如 `modules/tenancy`、`modules/identity`、`modules/merchant`、`modules/staff`、`modules/service-catalog`、`modules/scheduling` 與 `modules/booking`；module 內再依需要分 `api`、`application`、`domain`、`infrastructure`，避免為小模組建立空層級。
- Root `AppModule` 僅組裝 feature modules；Prisma repository 與外部 adapter 的 provider registration 由各 feature module 管理。跨模組互動透過公開 application interface/domain event，不直接 import 對方內部檔案。
- 在第一個 Phase 2 vertical slice 開始前完成現有 health/identity/tenancy 的機械式搬移，並擴充 architecture checker，阻止跨 feature 深層 import；搬移不得同時改變 API contract 或業務行為。

### 風險與下一步

- 現況不是立即性的維護問題，但若先新增 booking 等核心功能再重構，測試、DI provider 與 import path 的搬移成本會快速增加。
- 建議下一個本機任務定義為「P2 API module foundation」：先寫 ADR/目錄與依賴規則，再搬移 Phase 1 能力、補負向 architecture tests，最後才開始 merchant onboarding 或 booking vertical slice。
- 本輪只做唯讀架構稽核與工作紀錄，未調整 production source、API contract、dependency、database schema 或外部資源。

## 2026-07-20 — Push repository boundaries and verify remote CI

### Push 與分支證據

- 使用者明確指示推送後，`git push origin phase1` 將遠端 `phase1` 由 `bbfb93d` fast-forward 至 `e634f50`，包含 repository boundary implementation、local acceptance evidence 與 API modularity review 三個 scoped commits。
- 推送後唯讀核對確認 `origin/phase1@e634f50`，Draft PR #1 head 亦為 `e634f50`；`origin/main` 維持 `dd5f146`，沒有直接 push、merge 或修改 main。
- Git credential helper 只由 Git push process 使用；未輸出或寫入 token，也未修改 GitHub/GCP/LINE secrets。

### GitHub Actions 直接證據

- Push workflow [run #29757249654](https://github.com/onitaiji4real/nook/actions/runs/29757249654) 在 `phase1@e634f50` 完成，結論為 `success`。
- Draft PR workflow [run #29757255352](https://github.com/onitaiji4real/nook/actions/runs/29757255352) 在相同 head 完成，結論為 `success`。
- 兩個 workflow 的 `verify`、`terraform`、`container-images (web)`、`container-images (api)` 與 `container-images (worker)` 全部 completed/success；repository structure 與 workspace boundary contract 已取得 GitHub clean runner 證據。

### 剩餘限制

- Draft PR #1 維持 open/draft，本輪未改為 ready、未 review、未合併；P1-F04 仍需完成 review/ready/merge 證據。
- Phase 1 仍受 GCP apply、真實 LINE/Identity Platform staging、staging deployment/rollback、production approval wait 與 applied observability notification 等外部 gate 阻塞。

## 2026-07-21 — Phase 1 文件與實作落差稽核

### 範圍與結論

- 依 `AGENTS.md` 重新閱讀產品技術規劃、Phase 1 implementation/acceptance、P1-001～P1-005 task 與完整既有 worklog，再以唯讀方式比對 application、Prisma、Terraform、workflow、部署 script 與文件契約。
- 新增完整報告：`docs/reviews/phase-1-gap-audit-2026-07-21.md`。報告分開記錄已確認 bug／落差、仍需 owner 決策的風險、外部 gate 與本輪驗證，避免把 static/local evidence 冒充為 GCP／LINE staging 證據。
- 結論維持 Phase 1 `in_progress`。Repository 內可重現的骨架品質良好，但首次 GCP runtime 部署前至少應先處理 User suspension、Terraform/CD image ownership、尚不存在的 Scheduler endpoint、API CORS 與 readiness smoke。

### 主要發現與優先順序

1. `User.status` 未參與 LINE exchange、Firebase principal 或 tenant authorization，suspended/deleted user 仍可能取得或沿用存取權。
2. Terraform 與 deployment workflow 同時管理 Cloud Run service/job image，可能在後續 apply 發生回滾式 drift。
3. Scheduler 每分鐘呼叫尚未存在的 `/internal/notifications/dispatch`；`deploy_runtime=true` 後會持續失敗與重試。
4. API 尚無 CORS allowlist；Cloud Run web/API 不同 origin 時不符合 external-browser flow。
5. Firebase verifier 把 unavailable 一律映射成 invalid token 401；deploy smoke 未驗證三服務 application readiness。
6. Cloud Run 5xx policy 是絕對 request rate，不是要求的 2% ratio；budget resource／organization ADR 尚缺。
7. Required CI 沒有執行 `pnpm format:check`；auth endpoint 尚無明確 rate limit。
8. AuditLog 的 nullable request ID 與 tenant cascade delete 需要 retention／migration 決策；task `done` 與 Phase 1 `in_progress` 的狀態語意及驗收文件日期需持續同步。

### 證據與驗證

- 前一輪稽核執行並通過 architecture 5 tests、26 unit tests、12 workspace lint、12 strict typecheck、12 production build 與 full repository Prettier。
- 為避免清除或重設本機測試資料，前一輪未重跑 integration；採用本 worklog 2026-07-20 已保存的 database 3/3、API 11/11 與相同 head GitHub clean runner successful evidence，不把它延伸解讀為本次新發現已測試通過。
- 本次只更新文件；未修改 production code、test、Terraform、workflow，未執行 apply/deploy、未改 GitHub／LINE／GCP 外部設定，也未把任何 `BLOCKED` gate 改為 `PASS`。
- `docs/phase-1/acceptance-evidence.md` 日期更新至 2026-07-21，引用最新已記錄的 PR run，並連結 gap audit；既有 gate 狀態保持不變。
- 本輪文件完成後，以 repository 鎖定的 Prettier 執行 Markdown check，並執行 `git diff --check`；結果均通過。

### 限制與下一步

- 外部 GCP foundation、真實 LINE/Identity Platform exchange、staging deployment/rollback、production approval wait、applied logging/alert notification 仍未於本輪驗證，狀態維持 `BLOCKED`。
- 建議依序處理：User suspension → image ownership → Scheduler activation → CORS/readiness → Firebase error classification → 5xx ratio/budget → CI format/rate limit → audit retention 與文件狀態語意。

## 2026-07-21 — Make local API and worker startup reproducible

### 問題與根因

- 使用者依 README 執行 `pnpm install`、`pnpm dev:services`、`pnpm db:migrate`、`pnpm dev`；套件安裝、PostGIS 與 Web 成功，但 migration 因缺少 `DATABASE_URL` 失敗，API/worker 也在 startup fail closed。
- 根目錄 `.env` 已建立，但 shell、Prisma 與 Turbo 不會自動載入。加入載入後又確認 `.env.example` 的空白 optional identity values 會在 `AUTH_ADAPTER_MODE=disabled` 時被 Zod 提前拒絕。
- API/worker 能啟動後，四個 probes 首次皆回 500。即時 stack trace 證明 `tsx watch` 不產生 Nest 所依賴的 decorator metadata，HealthController 與 HealthService 未明確標註的 class dependency 因此為 `undefined`；production `tsc` build 未呈現此問題。

### 修正

- 新增 `infra/dev/run-with-env.mjs`，使用 Node 24 已穩定的 `process.loadEnvFile()` 載入 repository root `.env`，保留 shell/CI 既有環境變數優先權，並從 repository root 啟動 child command；沒有新增第三方 dependency，也不記錄 `.env` 內容。
- `pnpm db:migrate` 與 `pnpm dev` 改由相同 wrapper 執行；dev 移除 Turbo 已棄用的 `--parallel`。Architecture check 現在會 lint 並執行 3 個 env wrapper tests。
- Config 將空白 optional LINE/Identity Platform values正規化為 absent；disabled mode 可使用 `.env.example`，firebase mode 仍 fail closed 要求 channel/project，非空 service account 仍須為 email。
- API/worker HealthController 與 HealthService 對 class dependency 加上明確 `@Inject(...)`，使 `tsx` development 與 `tsc` production 使用相同 DI 契約；API architecture test 同時保護兩個 app。
- README 補充 root commands 自動載入 `.env`，並新增完成的 P1-006 task；真實 LINE/GCP 設定與 production secret injection 均未變更。

### 驗證與失敗重跑

- `pnpm db:migrate` 透過新 wrapper 成功讀取 root `.env`，連線 `localhost:5432`，確認 2 個 migrations 且無 pending；PostGIS container healthy。
- Env wrapper 3/3、repository architecture 5/5（合計 Node tests 8/8）、config 5/5、API package unit/architecture 7/7 通過；full repository Prettier、source lint 與 12 個 workspace strict typecheck 通過。
- 第一次從 repository root 直接跑 Vitest 時，API architecture tests 因既有 cwd 契約出現 3 個 `ENOENT`；改由 `apps/api` 執行後 7/7 通過。第一次 integration 亦因 root cwd 找不到 tests，第二次進入 `apps/api` 後讀到未重建的 config dist；先重建 config package 再重跑，API integration 11/11 通過。
- 九個 shared packages 與 API/worker production TypeScript builds 通過。Web production build 未重跑，因使用者的 Next dev server 正在使用 `.next`，且本輪未修改 Web production code。
- 實際 runtime 驗證 web、API、worker 的 health/readiness 共六個 endpoints 全部 HTTP 200；API/worker logs 含安全的 requestId/operation/outcome，臨時 API/worker 驗收程序已停止，使用者原有 Web dev server未中斷。

### 工作樹與限制

- 開始本輪前已有未提交的 Phase 1 gap audit、acceptance evidence、docs index 與 `apps/web/next-env.d.ts` 變更；本輪保留且未覆寫。`next-env.d.ts` 是使用者啟動 Next dev 時產生的變更，不納入 P1-006 範圍判定。
- 本輪未 commit、未 push、未修改 `main`，也未讀取、輸出或提交 `.env`。外部 GCP/LINE/staging gates 維持原狀。

## 2026-07-21 — Enforce local user status revocation

### 商業與安全決策

- Gap audit 的最高風險 repository-local 缺口是 `User.status` 未參與 LINE token issuance 或 tenant access；對付費 SaaS 而言，濫用、帳號接管、退款爭議或法遵停權若不能即時撤權，營運控制無法成立。
- P1-007 將本機 PostgreSQL user status 定為授權來源，不依賴 Firebase custom claims 的更新速度。`ACTIVE` 維持既有流程；`SUSPENDED`、`DELETED` 與不存在的 local user 統一回 RFC 9457 `403 account_inactive`，讓前端區分帳號停用與 token 失效。
- Nest/Prisma 文件查詢 skill 所需 Context7 未提供，改採官方 Prisma relation-filter 文件與 repository 現有 DI/repository contracts；未新增 dependency 或 GCP service。

### 實作

- `IdentityRepository.isActiveUser` 只對 PostgreSQL `UserStatus.ACTIVE` 回 true；`UserAccessService` 將 inactive/missing 映射為 403，database lookup failure fail closed 為 `503 user_status_unavailable`。
- AuthenticationGuard 在 Firebase verifier 接受 bearer token 後、建立 principal 前要求 active local user；LINE exchange 在 custom-token issuer 前做相同檢查並保留 ApplicationError，不將停權誤映射為 provider 503。
- Tenant create application service 再次驗證 active user，符合 write authorization 規則；tenant membership read/list query 同時加入 active user relation filter 作 defense-in-depth。
- OpenAPI 為 LINE exchange、tenant create 與 `/v1/me` 補上 403；新增 P1-007 task，並將 gap audit 的第一項標為 resolved。

### 驗證與失敗重跑

- User access unit tests 3/3、API package unit/architecture 10/10、workspace unit tests 31、Node architecture/env tests 8/8 全數通過；database integration 4/4、tenant integration 10/10、LINE integration 6/6 通過。
- 第一次 static command 在 `apps/api` cwd 使用 root-relative Prettier path，立即以 no-such-file 失敗；回 repository root 後 formatter、source lint、database/API typecheck 與 API unit tests通過。
- 第一次 tenant revocation integration 把三個 Supertest request 物件先放入陣列，ephemeral server lifecycle 競爭造成兩個 `ECONNREFUSED`；改成逐一 await 後，`SUSPENDED`/`DELETED` 的 tenant read、`/v1/me`、tenant create 全部穩定回 403，blocked tenant count 維持 0。
- Full repository Prettier、source lint、12 個 workspace strict typecheck、9 個 shared package builds、API/worker TypeScript builds與 Next.js production build通過。
- 以真正的 root `pnpm dev` 自動載入 `.env` 並啟動三服務；web/API/worker health/readiness 共六個 endpoints 全部 HTTP 200，logs 含 requestId/operation/outcome。驗收後 Ctrl+C 停止 persistent dev，pnpm 的 ELIFECYCLE 是手動中止結果。

### 限制與下一步

- 本輪沒有建立 admin 停權 API/UI；目前 status 仍須由受控資料或未來 platform-admin flow 更新。Firebase/LINE/GCP 真實 staging gate 未執行。
- 下一個不需外部帳號且優先的工作是決定 Terraform/CD image ownership 並暫停尚未有 dispatcher endpoint 的 Scheduler activation；之後處理 external-browser CORS 與 deploy readiness。
- 本輪尚未 commit、push 或修改 `main`。開始前既有的 gap audit/acceptance/docs index 變更已保留，`.env` 未讀出或加入 Git。

## 2026-07-21 — Separate Cloud Run release ownership and gate Scheduler

### 決策與實作

- P1-008 解決 gap audit 的兩個首次 runtime apply 高風險：Terraform/CD 同時管理 Cloud Run image，以及尚未存在的 dispatcher endpoint 被 Scheduler 每分鐘呼叫。
- ADR 0004 指定 Terraform 管理 Cloud Run service/job existence、IAM、network、environment、probe、scaling 與其他 image-independent configuration；GitHub Actions 管理首次 bootstrap 後的 service/job image revisions。
- Service 與 migration job 各只對精確 container image path 使用 `lifecycle.ignore_changes`。沒有忽略整個 `template` 或 resource，因此 image 以外的 drift 仍由 Terraform reconciliation。
- 新增 `enable_notification_dispatcher`，預設 false 且 validation 要求 `deploy_runtime=true`。dev/stg/prod 均明確傳入，三份 tfvars example 保持關閉；Phase 1 runtime provisioning 不再建立會回 404 的 Scheduler job。
- 更新 Terraform/CI/deployment runbooks，明確記錄 bootstrap digest、release digest evidence 與 dispatcher 啟用前的 endpoint、OIDC、idempotency、retry、staging smoke gate。

### 自動化防退化

- Terraform mocked tests 從 3 增至 5：保留 foundation/image/private-worker contract，新增 dispatcher-without-runtime 拒絕與 explicit activation 正向案例；一般 runtime case 直接斷言 Scheduler count 為 0。
- 新增 release ownership checker 與 3 個 Node tests，阻止移除窄範圍 image ignore、改成 broad template ignore、恢復 runtime 隱式 Scheduler 或把任一環境 example 預設開啟。Terraform validation script 現在強制執行這些 checks。
- Gap audit 的 Scheduler 與 image ownership 項目標為 `RESOLVED`；Phase 1 整體仍為 `in_progress`，因 GCP/LINE/staging 等外部 gates 與 CORS/monitoring 等後續 repository gaps 尚未完成。

### 驗證與失敗重跑

- `terraform fmt -recursive` 完成；Terraform 1.15.8 搭配鎖定 Google provider 6.50.0，bootstrap、module、dev、stg、prod 的 readonly init/validate 全數成功，mocked tests 5/5、release ownership tests 3/3、live checker 與 environment isolation checker 通過。
- Release ownership tests 第一次因 checker 寫死 `terraform fmt` 前的空白對齊而有 2 個 fixture failures；改成 whitespace-insensitive regex。第二次發現 example 的說明註解含 `false` 造成負向 fixture false positive；收斂為 anchored assignment 後 3/3 通過。
- 第一次 validation 在 sandbox 因 registry.terraform.io DNS 被拒絕而失敗；依權限流程以 readonly network access 重跑成功，沒有 plan/apply 或 GCP credential。
- 第一次 Trivy 因本機 Docker credential helper 無法更新 checks bundle而退回 stale embedded policy，誤判三環境已使用 `ssl_mode = "ENCRYPTED_ONLY"` 的 Cloud SQL TLS。使用 `/tmp` 隔離空 Docker config 匿名讀取現有最新 checks cache 後重跑，Terraform HIGH/CRITICAL findings 為 0；未讀取、輸出或寫入 credential。
- Full repository Prettier 與 `git diff --check` 通過。此任務只改 Terraform/config tests/docs，沒有 application/schema/dependency 變更，因此不重跑應用 unit/integration/build；P1-007 的完整驗證仍保存在前一節。

### 限制與下一步

- `lifecycle.ignore_changes` 尚未以真實 remote state drift plan 驗證；目前證據為官方語意、Terraform validate/mock plan 與 static negative contract。首次 GCP runtime apply 後須建立 CD 新 revision，再以 read-only plan 證明 image 不回滾且其他 drift 仍可見。
- Dispatcher flag 不得在 routine deploy 中開啟；真正啟用屬後續通知 vertical slice，需先完成 worker endpoint/authentication/idempotency 與 staging evidence。
- 本輪未執行 Terraform apply、Cloud Run deploy、Scheduler 建立、commit、push 或 `main` 更新，也未讀取 `.env`。

## 2026-07-21 — Add a fail-closed API CORS allowlist

### 商業與安全決策

- P1-009 修復 LINE 內建瀏覽器與一般 external browser 在 Web/API 不同 origin 時無法安全呼叫 API 的缺口。採 exact allowlist，不使用 `*`、origin reflection、cookie credential 或寬鬆 default。
- `API_CORS_ALLOWED_ORIGINS` 接受 comma-separated unique HTTP(S) origins；application startup 拒絕 wildcard、path、embedded credential、非 HTTP protocol 與重複值。空值代表不授權任何 cross-origin browser access，same-origin、server-to-server 與無 Origin request 不受影響。
- API 只宣告目前 contract 使用的 GET、POST、OPTIONS 與 Authorization、Content-Type、X-Request-Id；`credentials=false`，preflight max-age 600 秒。未允許 origin 可收到無 allow-origin 的 OPTIONS response，但瀏覽器不會授權後續跨來源 request。
- `.env.example` 允許 `http://localhost:3000`。Terraform 使用每環境 list input 注入 API；dev/stg/prod 預設空 list，取得實際 Web URL 後才顯式填入，production validation 強制 HTTPS。
- 依 documentation-lookup skill 檢查官方 Nest CORS 與 Express cors options；Context7 tool 不在本環境，採官方 NestJS/Express 文件作 fallback。沒有新增 dependency、GCP service 或 architecture decision，因此不另建 ADR。

### 測試與部署契約

- Config tests 增至 12，涵蓋 safe empty default、兩個合法 origins，以及 wildcard/path/credential/protocol/duplicate 六類負向輸入。
- 新增 3 個 in-process Nest/Supertest CORS tests：exact origin preflight、unconfigured origin 不取得 allow header、無 Origin request 正常；同時驗證 method/header/credentials/Vary contract。
- Terraform mocked tests由 P1-008 的 5 增至 7，新增 unsafe origin 與 production HTTP 拒絕；immutable runtime case直接證明 API container 收到 join 後的 allowlist。五個 configuration readonly validate、release ownership 與 environment isolation contracts 維持通過。
- README 與 Terraform runbook 補上 local、多 origin、production HTTPS 與 cloud URL/custom domain 設定方式；gap audit 的 CORS 項目標為 `RESOLVED`。

### 驗證與失敗重跑

- Config 12/12、API unit 13/13（含 CORS 3/3）、worker health 2/2 通過；affected config/API/worker lint、strict typecheck 與 production TypeScript builds 通過。Repository architecture/env 8/8 與 workflow/repository checkers 通過。
- CORS config 負向測試首次發現 Node `URL` parser 會接受 `https://*.nook.example`；新增明確 wildcard reject 後 config 12/12。
- CORS integration 在 sandbox 首次因 Supertest listener 綁定被拒絕而 3 個 `EPERM`；依既有 integration 驗收方式允許 loopback listener 後 3/3。
- 第一次從 repository root 合併跑 affected suites 時，既有 API architecture tests 因其 package-cwd contract 產生 3 個 `ENOENT`；改由 `apps/api` 執行後完整 API unit 13/13。
- API typecheck 首次指出四個 health fixture 尚未提供新增的 required config field；補上 empty allowlist後 config/API/worker typecheck 全數通過。
- Terraform 首次 7-case run 為 6/7：CORS 正向值誤放在 mutable-image fixture，使 runtime assertion讀到空值；移到 immutable runtime fixture 後 7/7。
- Full Turbo lint/typecheck/test regression 在 architecture 8/8 與 25/36 tasks 成功後超過 1 分 40 秒無進度，手動中止並改跑 affected direct suites；不將該中止 run 視為成功。前一個 P1-007 full workspace 31 tests／12 typechecks／12 lint／all builds evidence仍有效，本輪改動的 affected scopes已直接重跑。
- 臨時 runtime 首次從 root 直接呼叫 `tsx`，因未使用 API tsconfig 的 decorator setting而 transform fail；改用正式 `pnpm --filter @nook/api dev` package script後成功啟動。既有使用者 `.env` 尚無新欄位時，health 200且 CORS安全預設空；以單次非秘密 process override 設定 localhost origin 後，允許 preflight 回 `Access-Control-Allow-Origin: http://localhost:3000`，attacker origin 沒有該 header，兩者均無 credentials header。驗收程序已停止，沒有修改 `.env`。
- Terraform Trivy 使用隔離空 Docker config 與最新 checks cache，HIGH/CRITICAL findings 0。Full repository Prettier 與 `git diff --check` 通過。

### 限制與下一步

- Repository 不知道尚未建立的 Cloud Run Web URL；首次 cloud runtime apply 的 empty allowlist 是預期 fail-closed 狀態。取得 Web URL/custom domain 後需更新該環境 tfvars、approved plan/apply，再以真實 browser preflight 取得 staging evidence。
- CORS 是瀏覽器授權控制，不替代 bearer authentication、tenant authorization、rate limiting 或 CSRF/session設計；目前 API 不使用 cookie credential。
- 下一個 repository-local gap 是 deploy workflow 未驗證三服務 application `/ready`，其中 private worker 需先選定可驗證 OIDC 與內部 ingress 的 probe 方式。
- 本輪未執行 Terraform apply、外部 deploy、commit、push 或 `main` 更新，`.env` 未讀取或改寫。

## 2026-07-21 — Gate release promotion on application readiness

### 決策與實作

- P1-010 修復 deploy workflow 只驗證 Web/API health 與 worker control-plane Ready、沒有證明 application dependencies 可用的缺口。
- 依官方 Cloud Run health-check 文件，startup probe 成功後 container 即被視為可接流量，官方亦建議 startup logic包含 readiness。因此三服務 startup probe 從 TCP port 改為 HTTP application readiness：Web `/api/readiness`、API/worker `/ready`。
- Liveness 保留 Web `/api/health`、API/worker `/health`，避免資料庫暫時失效時用 instance restart 放大事故。API/worker readiness 會查 database，health 不查依賴。
- Deployment script 對 public Web/API candidate URL 改呼叫 readiness。Worker 維持 internal-only；Cloud Run 在 instance 內執行 `/ready` startup probe，workflow 再於 promotion 前要求 revision Ready=True，不新增 public invoker、probe job 或第三方服務。
- 既有 `set -euo pipefail` 與 `trap rollback ERR` 不變；update/startup、candidate curl 或 worker check 任一步失敗都在 promotion loop 前中止並回復先前 routed revisions。

### 防退化與文件

- Terraform immutable runtime mock 新增三服務 startup probe exact-path assertion，7 個既有 cases 全部通過。
- 新增 deployment readiness checker 與 3 個 negative tests，阻止 TCP-only startup、health-only candidate smoke 或把 worker check 移到 traffic promotion 後；root `check:architecture` 現強制執行 live checker。
- CI contract、Terraform/deployment runbooks 與 P1-E04 evidence 更新 readiness 語意；gap audit 第 5 項標為 `RESOLVED`，但真實 staging deployment gate 維持 `BLOCKED`。
- documentation-lookup skill 的 Context7 tool 未提供，改用官方 Google Cloud Run health-check 文件；未新增 dependency、GCP service 或需 ADR 的 architecture component。

### 驗證

- Terraform 1.15.8／Google provider 6.50.0：bootstrap、module、dev、stg、prod readonly init/validate 全數通過；mocked tests 7/7、release ownership tests 3/3、environment isolation通過。
- Deployment readiness tests 3/3；連同 repository structure 5 與 env wrapper 3，共 Node tests 11/11。ESLint、live repository/workflow/readiness checkers、`bash -n infra/ci/deploy-cloud-run.sh` 與 Terraform fmt 均通過。
- Trivy Terraform HIGH/CRITICAL 0；full repository Prettier 與 `git diff --check` 通過。
- 本輪只改 Terraform/deploy contract/tests/docs，沒有改 application endpoint implementation、schema 或 dependency，因此沿用 P1-009 已完成的 config/API/worker tests/build與實際本機 readiness 200 證據。

### 限制與下一步

- 未執行真實 Cloud Run deployment，因此尚未直接證明 target project 的 startup probe failure、zero-traffic candidate stop 與 rollback；P1-E04/E06 仍需 GCP/staging owner批准後取得 workflow evidence。
- Worker Ready condition 現可信賴的前提是 Terraform runtime config 已被 apply；deployment preflight 必須確認 approved Terraform plan已生效，不能只部署 image到舊 TCP-probe service。
- 下一個 repository-local gap 是 Firebase verifier 把 provider unavailable 誤分類為 invalid token 401；之後再處理 5xx ratio、budget ownership 與 required CI format。
- 本輪未執行 Terraform apply、外部 deploy、commit、push 或 `main` 更新。

## 2026-07-21 — Classify Firebase token rejection separately from outages

### 安全與產品決策

- P1-011 修復 Firebase Admin `verifyIdToken` 所有 exception 一律被映射為 `401 invalid_token` 的問題。Infrastructure outage 若偽裝成 token rejection，Web 可能清除仍有效 session、導致重複登入與客服噪音，也讓既有 guard 的 503 branch 實際不可達。
- Adapter 現以 `verifyIdToken(token, true)` 檢查 revoked token 與 disabled user。`auth/id-token-expired`、`auth/id-token-revoked`、`auth/invalid-id-token`、argument/tenant mismatch、disabled/user-not-found 等已知 client token rejection 回 internal `invalid_token`。
- Certificate fetch、permission、credential、Firebase internal/network 與所有 unknown exception 統一 fail closed 為 `verifier_unavailable`；guard 對外回 `503 identity_verifier_unavailable`，不把 provider code/message 或 token帶入 response/log。
- Firebase revocation check 與 P1-007 PostgreSQL `User.status` 各自保留：前者處理 provider session，後者是平台營運停權的 authoritative authorization source。Provider 503 不會繞過 local authorization。
- 依 documentation-lookup skill 查核官方 Firebase Admin Node error codes、`verifyIdToken(checkRevoked)` 與 session revocation文件；Context7 tool 未提供，採官方 Firebase 文件 fallback。沒有新增 dependency、外部 service 或 public API shape。

### 測試與文件

- Firebase adapter tests 從 2 增至 13：valid issue/verify 並斷言 `checkRevoked=true`、7 類 token rejection、4 類具 code infrastructure failure與 1 個 unknown Error。
- 新增 AuthenticationGuard 4 tests：成功 principal/local status、invalid 401、unavailable 503、unknown exception 503。完整 API unit suite現為 28/28。
- LINE/Identity security sequence 補上 provider revocation、local active-user check 與 client 對 401/503 的處理語意；gap audit 第 4 項標為 `RESOLVED`，P1-D05 真實 staging provider gate不變。

### 驗證

- API source/test ESLint、strict typecheck、production TypeScript build通過；API unit 6 files、28 tests 全數通過，包含 P1-009 的 CORS listener regression。
- Full repository Prettier 與 `git diff --check` 通過。此任務未修改 schema、Terraform、dependency 或其他 app，因此不重跑 database integration、Terraform 或 worker/web build；相鄰 P1-007～P1-010 證據仍保存在前節。

### 限制與下一步

- `checkRevoked=true` 會讓 authenticated request 依賴 Firebase Auth backend，換取 token revocation/disabled-user即時性；真實 latency、quota 與 outage behavior 需 P1-D05 staging evidence觀察。若後續導入 cache，必須先定義最大撤權延遲與不可 cache 的高風險操作。
- Error code allowlist採「只有確認是 client token rejection 才回 401」；Firebase 新增或未知 code 預設 503，需由 observability evidence審查後才能加入 401 list。
- 下一個 repository-local優先項目是把 Cloud Run 5xx alert改成文件要求的 2% ratio，並決定 low-traffic floor；budget ownership需 owner決策，不應偷設金額。
- 本輪未呼叫真實 Firebase、未執行外部變更、commit、push 或 `main` 更新。

## 2026-07-21 — Correct Cloud Run paging to a 2% 5xx ratio

### 監控與商業規則

- P1-012 修復原 alert只計算 5xx request_count absolute rate、卻以 `0.05` 命名為 rate的落差。產品門檻要求的是同一 Cloud Run service 在五分鐘內 `5xx / all requests > 2%`。
- Ratio condition 現以 response_code_class=5xx 為 numerator、全部 request_count 為 denominator；兩側使用相同 60 秒 ALIGN_RATE、REDUCE_SUM 與 service_name grouping，threshold 0.02、duration 300 秒。
- 為降低早期低流量 paging noise，第二條件要求同一 service 的全部 request rate持續高於 1 request/minute五分鐘；policy使用 `AND_WITH_MATCHING_RESOURCE`，不能由 A service的高錯誤率與 B service的流量湊成 incident。
- 兩條件 missing data皆為 inactive，Cloud Run scale-to-zero不視為故障。低於 floor 的錯誤仍保留於 dashboard/log供例行檢查，不 page on-call。
- 1 request/minute 是 Phase 1 起始 operational threshold；真實流量與 incident evidence出現後應調整。Budget ownership仍需 billing/owner決策，本輪沒有偷設費用或 notification channel。
- 依 documentation-lookup skill 查核官方 Cloud Monitoring ratio denominator、alignment與 matching-resource combiner語意；Context7 tool未提供，採官方 Google Cloud/HashiCorp provider文件 fallback。

### 實作與驗證

- Alert documentation明確列出 2%、五分鐘與 traffic floor。Terraform runtime mock assertions直接驗證 combiner、5xx numerator、request denominator、matching grouping、0.02 threshold、all-request floor與 300秒 duration。
- Terraform 1.15.8／Google provider 6.50.0 的 bootstrap、module、dev、stg、prod readonly init/validate全數通過；mocked tests 7/7、release ownership 3/3、environment isolation與 Terraform fmt通過。
- Trivy Terraform HIGH/CRITICAL 0；Terraform runbook、gap audit、P1-E07 evidence與 P1-012 task同步。Full repository Prettier與 `git diff --check`通過。

### 限制與下一步

- Static/provider mock不能證明實際 metric label cardinality、incident firing、notification delivery或 recovery。P1-E07維持 `BLOCKED`；staging apply後須以 synthetic traffic 驗證低流量不 page、超過 floor且 >2%會 page、恢復後關閉。
- Policy的兩個 condition若目標 project provider/API對 matching-resource labels有差異，saved plan/apply前必須用 Monitoring ListTimeSeries查核；不得為了 apply成功改回 absolute 5xx rate。
- 下一個不需外部帳號的工作是把 `pnpm format:check`納入 required CI並更新 workflow contract；budget resource仍等 owner提供 billing與金額決策。
- 本輪未 apply Terraform、修改 notification channel、觸發 incident、commit、push或更新 `main`。

## 2026-07-21 — Make formatting a required CI gate

### 實作與防退化

- P1-013 修復 Phase 1 required static quality宣稱包含 format、但 GitHub `verify`只跑 architecture/lint/typecheck的落差。
- `verify` job在 frozen install與 architecture contracts後執行 full repository `pnpm format:check`，再進 lint/typecheck/tests/build；format failure會直接使 ruleset既有 required `verify` context失敗，不新增或改名 status context。
- 新增 CI quality live checker與 3 個 tests：接受正確順序、拒絕移除 format、拒絕 `continue-on-error: true`。Root `check:architecture`現在強制 lint/test/run checker。
- CI contract、gap audit、P1-E01 evidence與 P1-013 task同步；既有 `main` ruleset不需外部修改，但新 workflow仍需下一次 phase1 push取得 GitHub clean-run evidence。

### 驗證

- CI quality tests 3/3；與 deployment readiness 3、repository boundary 5、env wrapper 3合計 architecture Node tests 14/14。
- Infra ESLint、repository/workflow/deployment/CI live checkers、full repository Prettier與 `git diff --check`通過。
- 本輪只改 workflow/static checker/docs，不改 dependency、application、schema或Terraform，因此不重跑 app integration/build或 Terraform；P1-009～P1-012 的相鄰驗證仍保存在前節。

### 限制與下一步

- 本機 checker證明 YAML文字 contract與順序，不能替代 GitHub runner執行。推送後需確認 draft PR新 head 的 `verify` format step、terraform與三個 container jobs成功，再更新 direct evidence。
- 下一個 repository-local security gap是 auth exchange rate limit；需先選擇不依賴單一 process memory、可在 Cloud Run多 instance一致運作的 Phase 1策略。Budget與 audit retention仍需要 owner/產品政策決策。
- 本輪未 commit、push、改 ruleset或更新 `main`。

## 2026-07-21 — Verify local runtime and add an opt-in Cloud Billing budget

### 本機服務診斷

- 使用者回報只有 Web `http://localhost:3000` 與其 health 可用。既有貼上輸出證明當時 `pnpm db:migrate`、API 與 worker 都因舊啟動流程沒有載入根目錄 `.env` 的 `DATABASE_URL` 而退出；這是 P1-006 已修正的根因，不是 Web routing 問題。
- 本輪只檢查 `.env` 是否存在及必要 key 是否有值，不輸出值、不改寫、不追蹤該檔。PostgreSQL 正在 `localhost:5432` 監聽；`DATABASE_URL` 與 `AUTH_ADAPTER_MODE` 有值，`API_CORS_ALLOWED_ORIGINS` 未設定，因此跨 origin browser API call 仍是預期 fail-closed。
- 使用正式 root env wrapper 與 package tsconfig 分別啟動 API／worker；`http://localhost:8080/health`、`/ready`、`http://localhost:8081/health`、`/ready` 全部 HTTP 200，readiness 確認 database 可連線。臨時程序驗收後已停止。
- 完成 P1-014 後再以正式 `pnpm dev` 啟動完整 workspace；Web `/`、`/api/health`、`/api/readiness`，API `/health`、`/ready`，worker `/health`、`/ready` 共七個端點全部 HTTP 200。此 dev session 保持執行，供使用者直接操作 localhost。
- 首次在 sandbox 啟動 `tsx` 因 IPC pipe `EPERM` 失敗，取得 localhost process 許可後重跑成功。第一次 smoke shell 使用 zsh reserved variable `status` 而中止；改名為 `http_code` 後四個 API／worker probes 通過。當時 Web 已不再監聽 3000，表示使用者原前景 dev process 已停止，沒有把它誤判為 application regression。

### P1-014 決策與實作

- 依官方 Cloud Billing 與 HashiCorp Google provider 文件確認：budget 是成本告警而非 hard cap；指定幣別必須符合 billing account；threshold 可使用 current spend；預設 email recipients 是 Billing Account Administrators／Users。另以本機鎖定的 Google provider 6.50.0 schema 核對欄位型別，`specified_amount.units` 為 string、Monitoring channels 最多五個。
- ADR 0005 指定每個 environment Terraform state 管理一個 project-scoped monthly budget。`project_budget` 預設 `null`，未取得 owner 核准的 billing account、幣別與整數月額時不建立資源，也不猜測商業預算。
- Opt-in budget 只 filter 當前 project number、包含 credits，預設 50/80/100% `CURRENT_SPEND` thresholds；保留 billing IAM recipients，並使用已核准的 Monitoring channel resource names。沒有新增 Pub/Sub、自動停用 billing 或會中斷服務的成本動作。
- Resource 使用 `prevent_destroy`；把 input 改回 null 會阻止刪除，必須經 owner-reviewed change/saved plan。三環境 examples 都明確保持 null，真實 account、金額、email、token 均未寫入 repository。
- 新增 P1-014 task、ADR、Terraform/runbook、gap audit 與 acceptance evidence；gap 的 repository ownership 問題標為 resolved，但真實 apply／notification delivery 仍由 P1-B05／P1-E07 維持 `BLOCKED`。

### 驗證與失敗重跑

- Terraform 1.15.8／Google provider 6.50.0：bootstrap、platform module、dev、stg、prod readonly init/validate 全數通過；mock tests 9/9、release ownership 3/3、environment isolation 與 Terraform fmt 通過。
- Repository architecture／env／readiness／CI quality tests 14/14 與四個 live checkers 通過；本輪沒有修改 application business code，因此不重跑既有 API/database integration 或 app builds。
- 第一輪 mock tests 為 8/9；notification channel assertion 直接比較 provider `list(string)` 與 tuple，型別不同造成 false。改用 `toset` 並把 default IAM recipient assertion 拆開後 9/9 通過；production resource 未變更。
- Trivy 使用隔離 Docker config 與現有 checks cache掃描 Terraform，HIGH/CRITICAL findings 0。Full repository Prettier 首次指出 acceptance evidence table 格式差異，格式化後重跑通過；`git diff --check` 通過。

### 限制與下一步

- 本輪沒有 Terraform plan/apply、沒有建立或刪除 GCP resource，也沒有驗證真實 budget email／Monitoring delivery。Billing owner仍須提供每環境實際 input、確認 currency 與 recipients、審查 saved plan 並批准 apply。
- `.env` 的 CORS key 尚未填入；若 Web 未來從 browser 直接呼叫 API，local `.env` 應加入 `API_CORS_ALLOWED_ORIGINS=http://localhost:3000`，但本輪遵守不改寫使用者 secret/config 檔。
- 下一個 repository-local security gap 是可跨 Cloud Run instances 一致執行的 auth exchange rate limit，其 architecture 尚未決定；audit retention／tenant deletion policy 也仍需產品與法遵決策。
- 本輪未 commit、push、更新 `main`、修改 GitHub/GCP/LINE 外部設定或讀出任何 credential。

## 2026-07-21 — Add a cross-instance LINE exchange rate limit

### 安全、隱私與商業決策

- P1-015 修復公開 `POST /v1/auth/line/exchange` 無明確 rate limit 的缺口。每次 exchange 可能呼叫 LINE 與 Identity Platform；沒有跨 instance ceiling 會讓攻擊流量放大 provider quota、成本與正常登入容量。
- Cloud Run 可水平擴展且 scale-to-zero，因此拒絕只存在單一 Node.js process 的 memory limiter。現階段也沒有 External Application Load Balancer／Cloud Armor 與可信 client-IP header chain；依官方 Load Balancer/Express文件，incoming `X-Forwarded-For` 可能含未驗證值，直接信任左側欄位會被 spoof。ADR 0006 明確不假裝已有 per-IP control。
- 採既有 PostgreSQL fixed-window bucket，不新增 Redis、GCP service或第三方 dependency。每環境預設 global 120/min，另對相同 LINE ID token SHA-256 fingerprint 5/min；global bucket先消耗，避免不同 token繞過 provider-call總量。
- 只保存短期 64-char digest、UTC window、count與 expiry；不保存 raw token、nonce、LINE subject、IP或 request body。預設 TTL 10分鐘並由 global consume清除，資料不得進 analytics、tenant export或 business reporting。
- 超限在 provider前回 RFC 9457 `429 line_exchange_rate_limited`與 `Retry-After`；database error fail closed為 `503 auth_rate_limit_unavailable`。成功、invalid與provider failure都計入attempt，避免用錯誤流量繞過。
- 120/min與5/token/min是早期商業起始值，兼顧小規模 onboarding burst與成本guardrail；不得只為消除429任意提高。Fixed-window邊界可出現近兩倍瞬時burst，正式大量導流前仍需可信edge／Cloud Armor per-client policy與load evidence。
- 使用 documentation-lookup skill；Context7 tool未提供，改查官方 Nest request、Prisma transaction/upsert、Google Cloud Load Balancer X-Forwarded-For、Cloud Run與Node crypto文件，並以repository鎖定版本的實作/tests作直接證據。

### Schema、application與contract

- Expand migration新增 `auth_rate_limit_buckets`，複合primary key為scope/hash/window；另有expiry index及hash格式、positive count、expiry-after-window checks。Repository用PostgreSQL `INSERT ... ON CONFLICT DO UPDATE request_count + 1 RETURNING`原子遞增，多instance/concurrent request不遺失計數。
- `LineAuthRateLimitService`在LINE verifier前依序消耗global/token buckets；SHA-256只作短期equality key，不作authentication。Repository unavailable不洩漏database detail。
- `ApplicationError`支援429與bounded retry seconds，Problem Details filter只在有值時送整數`Retry-After`。Auth structured log加入整體`durationMs`；只有實際呼叫verifier才出現`providerLatencyMs`，429不誤標provider latency且不記fingerprint/token。
- Shared config新增四個bounded settings；`.env.example`與dev/stg/prod Terraform examples一致。Terraform module validation要求global 1～10000、token 1～100、window 10～3600秒、TTL覆蓋window且不超過86400秒，API Cloud Run明確收到四個env values。
- OpenAPI新增429 response/header；ADR 0006、P1-015 task、LINE sequence、data dictionary、README、Terraform runbook、gap audit與acceptance evidence同步。

### 驗證與失敗重跑

- `pnpm db:migrate`成功套用第三個migration；第二次deploy回`No pending migrations to apply`，證明可重入。Prisma schema format/client generate成功，沒有修改既有user/tenant/audit data。
- Config unit 17/17、database unit 2/2、API unit 33/33通過。Database integration 6/6，包含同bucket 10 concurrent consumes在limit=5時恰有5 allowed、counts完整為1～10，以及expired fingerprint cleanup。
- API integration 17/17，保留tenant isolation/status revocation regressions；LINE相同invalid token前五次401、第六次429＋`Retry-After`，verifier只被呼叫五次，429 auth log沒有providerLatency或raw token。
- Affected config/database/API/worker strict typecheck與source/test ESLint通過；config/database/API production TypeScript builds通過。Repository architecture/env/readiness/CI tests 14/14與四個live checkers通過。
- Terraform 1.15.8／Google provider 6.50.0：bootstrap/module/dev/stg/prod readonly init/validate全數通過，mock tests增至10/10，release ownership3/3與environment isolation通過。Trivy Terraform HIGH/CRITICAL findings 0。
- 第一次 Prisma format使用不存在的root `node_modules/.bin/prisma`而exit 127；改用database package CLI後成功。第一次完整API unit在sandbox為29 pass／CORS 3個listener `EPERM`；以既有loopback權限原樣重跑33/33。第一次API integration因`@nook/database` package dist尚未重建，Nest factory讀到undefined constructor而17個tests未執行；重建config/database dist後原樣重跑17/17，沒有把bootstrap failure當測試成功。
- 第一次敏感產物檢查的regex把允許追蹤的`.env.example`誤判為`.env.*`並exit 1；改用Git精確pathspec後確認沒有tracked `.env`、tfstate、tfplan或provider artifacts。
- Full repository Prettier、Terraform fmt、`git diff --check`與敏感/生成產物檢查通過。

### 限制與下一步

- 本輪沒有真實LINE/Firebase provider call、GCP deploy、load test或Cloud Armor。P1-D05與staging/deployment gates維持`BLOCKED`；120/min需在staging以真實登入burst、provider quota與abuse scenario調整。
- PostgreSQL現在是auth limiter依賴；database outage會讓登入503，而不是繞過limiter。登入可用性、connection pool與cleanup query成本需由staging metrics驗證。
- 下一個repository-local缺口是audit retention／tenant deletion policy與task status語意；正式大量導流前另有可信edge per-client rate limit工作。
- 本輪未commit、push、更新`main`、執行Terraform apply或修改GitHub/GCP/LINE外部設定；`.env`未改寫或提交。

## 2026-07-21 — Make local app startup deterministic

### 問題與根因

- P1-015完成後以正式`pnpm dev`重啟驗收，Web很快可用，但API/worker等待Turbo的`dev -> ^build` dependency graph。唯讀process證據顯示`packages/config`的`tsc`已寫出dist，卻卡在Node shutdown等待V8 worker；第一個run接近兩分鐘仍未完成，重現使用者先前「只有Web可用」的操作結果。
- 相同九個shared packages改用`pnpm --filter './packages/*' --workspace-concurrency=1 run build`時約6秒全數完成。問題是local persistent graph中的parallel dependency build，不是TypeScript compile error、Prisma migration或API runtime failure。

### P1-016實作

- Root `pnpm dev`仍先透過`run-with-env.mjs`載入`.env`，再委派`dev:workspace`。後者先以workspace concurrency 1build所有shared packages，成功後才執行`turbo run dev`。
- Turbo `dev` task移除`dependsOn: ["^build"]`，保留`persistent=true`與`cache=false`，避免第二次隱式parallel build。Production/CI `build` graph完全不變。
- 新增local-dev checker與3個tests，保護root env wrapper、sequential package preparation、build-before-dev ordering，以及禁止恢復Turbo implicit `^build`。
- README與P1-016 task說明shared package目前不hot reload；修改package source後需重新啟動dev。未用watcher或額外dependency擴大Phase 1複雜度。

### 驗證與失敗重跑

- Sequential package build 9/9完成。新`pnpm dev`實際依序完成九個build，隨即同時啟動Web/API/worker；Web `/`、`/api/health`、`/api/readiness`，API `/health`、`/ready`，worker `/health`、`/ready`共七個端點全部HTTP 200。Dev session保持執行供使用者操作。
- Local-dev contract 3/3、env wrapper 3/3通過；連同repository/readiness/CI tests，root architecture共17/17及五個live checkers通過。Infra ESLint、full repository Prettier與`git diff --check`通過。
- 第一次contract lint因infra ESLint未宣告Node global `structuredClone`而失敗；測試改用明確object spread後通過。手動順序驗證第一次讓env wrapper直接spawn裸`turbo`，因不在pnpm script PATH而ENOENT；改用repository binary確認行為，正式script則由pnpm提供PATH。

### 限制

- Shared package不做hot reload是刻意的Phase 1取捨；app source仍由Next/tsx watch。若開發迭代需要package watcher，需設計不會與persistent app graph競爭或產生半寫dist的協調流程。
- 本輪只改local tooling/docs/tests，沒有改production runtime、schema、Terraform、外部設定、commit、push或`main`。

## 2026-07-21 — Make the audit lifecycle fail closed

### P1-017 決策與資料生命週期

- Gap audit指出data dictionary要求audit必含request ID，但schema仍允許null；audit-to-tenant foreign key另使用cascade，任何誤用hard delete都會同步抹除安全證據。
- ADR 0007定義Phase 1安全下限：tenant停用使用既有`Tenant.status = CLOSED`，不提供hard delete；audit foreign key改為`ON DELETE RESTRICT`。User刪除時actor仍採`SET NULL`，保存事件但不強留直接user關聯。
- 產品計畫要求法定或帳務保留期後刪除／匿名化，但目前沒有適用司法管轄、帳務需求與owner核准年限。本輪不猜retention天數、不新增destructive purge或scheduler；保存年限、legal hold、export、匿名化與可重入purge worker維持後續owner／法遵決策。
- Task狀態語意同步收斂：`done`只代表單一slice的repository／local acceptance criteria完成，不代表Phase 1或外部GCP／LINE／deployment gate通過。Phase 1保持`in_progress`，以acceptance evidence required gates為唯一整體狀態來源。

### Migration、tests與證據

- Contract migration先將既有null request ID回填為不含PII的`legacy-<audit UUID>`，再設`NOT NULL`；此值只表示migration provenance，不冒充原HTTP correlation。相同migration將tenant foreign key由cascade改為restrict，沒有刪除或改寫既有非nullaudit內容。
- Migration第一次在sandbox只回`Schema engine error`，沒有SQL error；取得本機PostgreSQL存取後原樣套用成功，第四個migration完成。第二次deploy回`No pending migrations to apply`，部署流程可重入。
- 新database contract tests 2/2保護Prisma schema、legacy backfill、NOT NULL、restrict與禁止migration刪除audit row。Database integration增至7/7：raw null insert由PostgreSQL 23502拒絕，tenant delete由foreign key拒絕，失敗後audit row仍存在。
- Database unit 4/4、lint、strict typecheck與build通過；API integration 17/17通過，既有tenant onboarding、authorization、user revocation、LINE exchange與rate limit均未回歸。
- Database integration第一次直接從package執行，因未經root env wrapper而7個cases都在beforeEach前缺`DATABASE_URL`失敗，未執行assertion或清除資料；改用`run-with-env.mjs`原樣重跑7/7。新contract test第一次雖2/2通過，但CommonJS typecheck拒絕`import.meta`；改用Node `__dirname`後unit/typecheck皆通過。
- 第一次把`.prisma`與`.sql`明確傳給Prettier時因無對應parser而失敗；schema已由`prisma format`處理，SQL由migration執行與`git diff --check`驗證，正式root `format:check`依repository ignore contract通過。第一次diff check另抓到implementation plan的Markdown hard-break尾端空白，移除後重跑通過。
- 驗證shell的Homebrew pnpm嘗試依`packageManager`切換11.7.0，但受限registry無法完成signature fetch；改用Codex bundled pnpm 11.9.0並設定既有fail-safe後，architecture 17/17與五個live checkers通過。這是驗證環境網路限制，不修改repository的Node/pnpm engine contract。
- Sandbox內第一次localhost smoke顯示七個endpoint皆無法連線，接著重啟因3000已被使用而失敗；以允許localhost的唯讀`lsof`與curl查核後，確認原Web/API/worker程序仍分別監聽3000/8080/8081，七個endpoint全數HTTP 200。未終止或建立重複常駐服務。

### 風險與下一步

- `ALTER COLUMN SET NOT NULL`與foreign key replacement會取得database lock。現階段僅在local Phase 1 database驗證；staging／production套用前需查詢null count、table size、lock window並由owner審查saved migration plan，不得把本機快速完成外推為production零停機證據。
- Database constraint只防止刪除仍有audit的tenant；未來若先刪audit再刪tenant，仍必須由受控privacy workflow、legal hold check、二次授權與audit/report保護。P1-017不建立此流程。
- 本輪沒有刪除production/staging資料、部署cloud、修改外部設定、commit、push或更新`main`。本機integration只重設synthetic test rows；dev services保持運行。

## 2026-07-21 — Turn the Web scaffold into the Nook service introduction site

### MKT-001商業與設計決策

- 使用者最終目標包含LINE-first顧客流程、LINE OA與RWD店家後台，以及一個介紹服務的Web。Phase 1首頁仍只有「平台骨架已啟動」placeholder，無法讓潛在店家理解產品或讓owner檢視商業敘事，因此建立獨立`MKT-001`，不把marketing交付混入Phase 1外部gate。
- 依產品計畫將第一受眾鎖定一人美甲、美睫與小型工作室；首頁順序先說反覆確認預約的SaaS痛點，再呈現LINE-first流程、產品藍圖、方案與attribution。自帶顧客0%、平台首次媒合8%且單筆上限NT$250皆直接揭露。
- 四個方案沿用business plan規劃價，但相鄰標示「封閉Beta前確認」；所有尚未實作能力均標為產品藍圖或設計目標。沒有虛構店家數、testimonial、轉換率或LINE官方背書。
- Privacy／terms與early-access data contract尚未完成，因此頁面不放會丟失資料的假form，也不先收email、電話或LINE ID。創始店家區只說明預計100家與NT$2,388／12個月的早期方案，明確標示申請未開放。
- 使用frontend-design skill建立「預約簿×台灣街角工作室」editorial方向：暖紙色、墨黑、朱紅、少量LINE綠與acid accent；使用CSS後台／預約示意，不新增外部font、image、tracking或third-party dependency。Marketing內容與view放在`src/features/marketing`，app page只composition，避免後續店家／消費者feature堆在route檔。

### Accessibility、responsive與驗證

- 頁面包含skip link、semantic navigation/headings/lists、原生details FAQ、可見focus、reduced-motion與mobile breakpoint。SEO metadata補上zh-TW title、description、keywords、Open Graph與theme color；因正式domain未定，不猜canonical URL。
- Server render contract tests 3個驗證價值主張與launch狀態、399/899方案與媒合上限、存在的anchor CTA，以及沒有空href或未持久化form；連同health tests，Web unit 5/5通過。Web ESLint、strict typecheck與Next production build成功，首頁prerender為static route。
- 使用browser skill在真實Next dev page驗收1280×720與390×844。兩種viewport的document horizontal overflow皆為0，header、hero、四步流程、方案、FAQ與footer可見；第二個FAQ可成功展開且answer visible，browser console無warning/error。
- 第一張full-page screenshot因in-app browser的分段capture只重複header而無法作視覺證據，改用實際viewport與分段scroll screenshot，不把有缺陷的capture當通過。視覺驗收發現desktop hero最後兩字孤行、mobile section heading斷行過碎、truth strip顯示scrollbar；縮放display type、desktop emphasis nowrap/mobile恢復wrap並隱藏strip scrollbar後重驗無overflow。
- 第一輪Web test為health 2/2，但marketing suite在classic JSX transform因未顯式React runtime於load階段失敗；component與test明確import React後原樣重跑5/5。
- 最終Web unit 5/5、ESLint、strict typecheck與production build重跑通過；root Prettier、`git diff --check`、architecture 17/17與五個live checkers通過。localhost Web/API/worker共七個health/readiness/root endpoints皆HTTP 200，server-rendered首頁可直接找到「把空檔」、「產品規劃價」與「申請尚未開放」，證明不是只改未被route引用的source。

### 限制與下一步

- 畫面中的店務後台是明確標示的介面示意，不是可登入產品。下一個直接產品價值slice應進入Phase 2 merchant profile/location/service onboarding，而不是繼續堆landing page裝飾。
- 正式early-access conversion需要privacy notice、terms、資料retention／刪除流程與受控intake API；analytics需要consent策略與ADR。正式domain確認後再補canonical與Open Graph image。
- 本輪沒有申請外部服務、收集個資、部署、commit、push或更新`main`；現有localhost三服務保持可用。

## 2026-07-21 — Deliver the first merchant onboarding vertical slice

### P2-001商業、資料與授權決策

- Phase 2第一個slice讓既有tenant的店主一次準備merchant profile、主要據點與第一項服務；完整範圍、後續順序與完成定義寫入`docs/phase-2/implementation-plan.md`，沒有把作品、班表、公開頁或預約偷渡進此task。
- `PUT /v1/tenants/{tenantId}/merchant-onboarding`只允許active OWNER，`GET`允許active member。所有authorization在application service驗證；repository所有resource lookup/upsert都包含`tenantId`，controller不接觸Prisma。
- client提供location與service UUID，使網路重送更新相同resource；跨tenant使用既有全域UUID會回`409 onboarding_resource_conflict`。profile、location、service、references與`merchant.onboarding.saved` audit在同一PostgreSQL transaction完成。
- Profile保持`DRAFT`／`UNVERIFIED`；三段完成只回`readyForSchedule=true`、`readyToPublish=false`。地址預設private、時區固定`Asia/Taipei`、價格以TWD整數保存；log／audit不含電話、地址、政策、描述或request payload。
- 價格contract支援FIXED、FROM、RANGE與QUOTE，LINE OA／Instagram URL只接受HTTPS核准host。沒有依plan name分支；多服務／人員的entitlement留待後續task。
- 使用documentation-lookup skill查核Prisma transaction/upsert/compound unique、Nest controller/authorization與Next server/client boundary；Context7不可用，採官方Prisma、NestJS與Next.js文件。沒有新增dependency、GCP service或第三方系統。

### Migration與失敗修正

- Expand migration新增`merchant_profiles`、`locations`、`services`與enum／composite tenant foreign keys；PostGIS point保留nullable，P2-001不假裝已有geocoding。已套用的migration保持immutable。
- 第一輪database integration為8/9：測試刻意送入FIXED但amount為null，PostgreSQL原CHECK因expression得到UNKNOWN而放行。新增第二個向前migration，使用明確`IS NOT NULL`重建`services_price_check`，未回改已套用migration。
- 修正migration在sandbox第一次只回Prisma schema engine error；取得本機PostgreSQL權限後套用成功，第二次deploy回`No pending migrations to apply`。
- 修正後database確實以PostgreSQL `23514`拒絕資料，但Prisma 6.19包成`PrismaClientUnknownRequestError`，不是測試假設的`P2004`。測試改為精確鎖定`services_price_check`並逐一驗證profile/location/service/audit仍為0；重跑9/9通過，沒有把任意database error當成功。

### API、Web與交接文件

- Shared Zod contract與typed response、Prisma repository、Nest application service/controller、safe security event和7個新API integration cases完成。新增architecture contract保護controller不直接Prisma、transaction、tenant scope、OWNER write與safe log payload。
- `/studio/onboarding`以獨立feature module提供RWD工作日誌介面：工作室、主要據點、第一項服務、5欄完成度、地址privacy toggle與live preview。首頁header已有存在的入口，route檔只composition。
- Browser LINE/Firebase session尚未完成，因此submit只更新React memory；UI明示資料尚未送出與重新整理即清除，不建立token輸入、固定dev token、localStorage或假儲存成功。API本身已可由真實受保護client使用。
- 使用frontend-design skill區分marketing與merchant admin：暖紙／墨線／朱紅狀態、acid preview，desktop三欄、tablet preview下移、mobile單欄。browser skill實測1280×720與390×844，document horizontal overflow皆為0；填入synthetic資料後5/5、分類／服務／價格／地址公開狀態同步，reload回0/5，console warning/error 0。
- 新增Phase 2 plan、P2-001 task、merchant onboarding data dictionary、design contract與OpenAPI GET/PUT/schema；README、docs index、task index與Web README同步。公開頁後續不得直接重用包含完整地址的admin response。

### 驗證

- Prisma migration：第六個migration成功，第二次執行無pending。Database integration 9/9；database unit 4/4。
- API integration 3 files／24 tests全數通過；API unit第一輪31 pass但CORS 3 cases因sandbox `listen EPERM`失敗，以localhost listener權限原樣重跑34/34。
- Contracts unit 4/4；Web unit 8/8、ESLint與strict typecheck通過。Next production build成功，`/studio/onboarding`為static prerender route；contracts/database/API builds通過。
- Repository architecture 17/17與五個live checkers、full Prettier、OpenAPI YAML parse、`git diff --check`通過。Root Turbo lint/typecheck平行run超過等待窗口；lint在2分鐘只完成5/9 active tasks後停止，未視為通過。改以workspace concurrency 1原樣執行12個package，lint與strict typecheck皆exit 0。
- Live smoke第一次顯示既有Web/API/worker health皆200，但merchant onboarding route回404，證明舊runtime尚未載入P2-001。第一次只中斷top-level pnpm後，舊Turbo children仍占用3000造成重啟`EADDRINUSE`；以`lsof`精確確認並只終止舊nook的3000/8080/8081與Turbo PID後乾淨重啟。
- 最新dev runtime明確map商家GET/PUT route；Web root、onboarding UI、Web health/readiness、API health/readiness與worker health/readiness共8個endpoint皆200，未登入商家onboarding GET回401而非404。常駐dev session保持執行供使用者操作。

### 限制與下一步

- 真實Web儲存仍依賴P2-006 browser session；完成後接現有GET/PUT，不得將bearer token放進form或localStorage。這是目前使用者能操作預覽、但不能持久化的明確邊界。
- `MerchantProfile`不重複保存店名；P2-001假設tenant name已由`POST /v1/tenants`建立。登入後Web應從tenant context載入名稱，不以目前預覽欄位另建第二個authoritative name。
- Geo、公開頁、地址redaction、作品、班表、appointment與payment尚未完成；`readyToPublish=false`不得被UI繞過。
- 本輪沒有外部LINE/Firebase呼叫、GCP apply/deploy、外部資料提交、commit、push或`main`更新。
- Turbo並行lint/typecheck在此macOS／Node 24環境可能不退出，CI Linux行為仍需PR check證明；本輪已用相同package scripts的sequential execution建立local evidence，沒有降低lint/typecheck規則。

## 2026-07-21 — Deliver the service catalog and generic entitlement slice

### P2-002 商業與架構決策

- 服務目錄以通用`MAX_SERVICES` integer entitlement限制ACTIVE服務；預設免費曝光方案migration值為5。application只讀entitlement code/value，不依`FREE_EXPOSURE`或任何plan name分支，避免後續方案迭代散落條件式。
- ACTIVE服務計入額度；INACTIVE保留歷史識別、內容與排序且不占額度。active OWNER／MANAGER可寫，STAFF／VIEWER只讀；所有authorization在application service執行，controller不接觸Prisma。
- 新增與重新啟用在PostgreSQL Serializable transaction內讀額度與用量，serialization conflict最多重試三次。database concurrent integration證明四筆ACTIVE同時新增兩筆時只有一筆成功，最終維持5筆。
- 最後一筆ACTIVE不可停用；停用starter service時，在同一transaction原子改指向下一筆ACTIVE，並關閉該服務`bookingEnabled`。重排要求完整提交tenant的ACTIVE與INACTIVE ID集合，缺漏或跨tenant整筆rollback。
- 新增`Plan`、`Entitlement`、`PlanEntitlement`與service `sortOrder`；migration回填既有tenant預設plan並按`createdAt`／`id`回填順序。tenant-to-plan foreign key以`NOT VALID` expand加入，新寫入仍受檢查，後續可在環境資料稽核後validate。
- 使用documentation-lookup skill核對官方Prisma transaction／Serializable API、NestJS controller／authorization與Next Server／Client Component邊界；Context7不可用時只採官方文件。沒有新增dependency、GCP service或第三方系統。

### API、Web與交接文件

- 完成`GET`／`POST /v1/tenants/{tenantId}/services`、`PATCH /:serviceId`、`PUT /:serviceId/status`與`PUT /order`，共享Zod contract與full catalog response包含`MAX_SERVICES` limit／used／remaining。
- API integration覆蓋MANAGER寫入、STAFF只讀、第五／第六筆額度、starter replacement、最後ACTIVE保護、價格更新、空patch、完整排序rollback、跨tenant 404、safe audit與security logs。Architecture test另固定controller無Prisma、tenant scope、Serializable與禁止plan-name branch。
- `/studio/services`以獨立feature module提供服務ledger與編輯器，可在React memory新增、編輯、停用／重新啟用、上移／下移與切換停用項目；畫面清楚顯示`LOCAL PREVIEW`與重新整理還原，不提供token輸入、localStorage或假遠端成功。
- 使用frontend-design skill延續「工作日誌／預約簿」視覺：暖紙底、墨色編輯面板、朱紅狀態與acid entitlement卡；desktop雙欄、tablet上下排列、mobile固定底部工作區導覽。設計決策、API handoff與誠實產品邊界寫入design contract。
- OpenAPI、service catalog／entitlement data dictionary、Phase 2 plan、root／Web README、task index與本task同步。Web等`P2-006`取得真實Identity Platform browser session後才接正式API，不新增dev auth bypass。

### 驗證、runtime修正與限制

- 第七個migration已成功套用，第二次deploy為`No pending migrations to apply`。Contracts 7/7、database unit 6/6、database integration 10/10、API unit 35/35、API integration 31/31、Web unit 11/11通過。
- Repository architecture 17/17與live checkers、full Prettier、OpenAPI YAML parse、`git diff --check`、所有packages/apps sequential lint、strict typecheck與production build通過。
- Browser skill實測1280×720新增「頭皮舒壓」後額度2/5→3/5、停用回2/5、上移後順序正確；375px viewport document overflow為0、mobile單欄與底部導覽生效，console warning/error 0。重新載入後回三筆synthetic預覽資料。
- Production build後發現舊API child process仍占8080，service route為404；以cwd逐一確認三個舊process都屬本repository後終止。Homebrew`/opt/homebrew/bin/pnpm`當時連`pnpm -v`都停住，未修改全域安裝；改用Codex bundled pnpm 11.9.0啟動相同scripts，並因sandbox listener限制分別在允許本機listener的環境啟動Web／API／worker。
- 改用可確認輸出的pnpm後，新增schema contract test先因鎖死Prisma對齊空白與index map suffix失敗，改為語意regex／完整mapped index assertion；workspace lint再指出`PromiseRejectedResult.reason`的`any`，改先收窄為`unknown`再用`instanceof`。修正後原樣重跑相關unit、database integration、lint與typecheck通過，沒有刪除或放寬檢查。
- 最新Nest runtime明確map五個service catalog routes。Web root／services／health／readiness、API health／readiness、worker health／readiness皆HTTP 200，未登入service catalog GET為401而非404；三個dev服務保持執行供使用者操作。
- 真實Web持久化仍依賴`P2-006` browser session；billing checkout、plan切換／降級、人員資格、班表、公開頁、預約與付款不在P2-002範圍。本輪沒有外部LINE／Firebase呼叫、GCP apply／deploy、commit、push或更新`main`。

## 2026-07-22 — Deliver staff and availability inputs

### P2-003 商業、資料與架構決策

- 人員以通用`MAX_STAFF` integer entitlement限制ACTIVE數量，預設方案migration值為1；application不讀plan code/name。INACTIVE保留service資格、班表、例外與歷史識別且不占額度。
- `StaffProfile`不等同membership；`userId`保持nullable，邀請與帳號綁定不在本task。staff必須綁同tenant ACTIVE location與至少一項同tenant ACTIVE service，並由database tenant-composite relations保護。
- OWNER／MANAGER可管理，STAFF／VIEWER只讀。新增與重新啟用在Serializable transaction檢查額度；最後一位ACTIVE不可停用，停用一併關閉`bookingEnabled`，INACTIVE也不能被單獨重新打開接單。
- Weekly rules採ISO weekday、`HH:mm` 15分鐘格、日期有效區間與同日分段；HTTP schema與repository都拒絕日期／時間交集，整份schedule在一個transaction原子取代。
- Exception支援`TIME_OFF`／`EXTRA_HOURS`／`BLOCK`，request接受offset-aware ISO 8601，PostgreSQL以`timestamptz`保存UTC；ACTIVE interval不可重疊，CANCELLED保留內容與audit。
- P2-003只交付availability inputs，不產出consumer slot、appointment或hold。後續availability engine仍需套用active service/staff、service duration/buffer、weekly rules、exceptions與占用資料。
- API開始以獨立`SchedulingModule`拆出feature boundary；共用authentication、identity、tenant repository與runtime config收斂到可export的`PlatformCoreModule`。Controller沒有Prisma，application service負責授權與error mapping。
- 使用documentation-lookup skill核對官方Prisma compound relation／transaction與NestJS feature module／authorization文件；Context7不可用時未加入替代dependency。使用frontend-design skill建立「cobalt appointment ledger」工作台。

### Migration、API與Web

- 第八個migration建立staff profiles、staff services、weekly availability rules、availability exceptions、composite constraints與`MAX_STAFF`；既有merchant tenant依primary location建立中性預設staff並指派ACTIVE services，不猜weekly hours。Migration已套用，第二次deploy回`No pending migrations to apply`。
- 完成staff list/create/update/status/reorder、weekly full replacement、exception create/update/status共9個HTTP操作（8組path）。Shared response包含`Asia/Taipei`、全staff aggregate與`MAX_STAFF` limit／used／remaining。
- API integration覆蓋MANAGER write、STAFF read-only、authorization audit、MAX_STAFF、跨tenant service拒絕、weekly原子性、offset轉UTC、exception overlap／cancel保留、最後ACTIVE、INACTIVE booking與完整排序。
- `/studio/staff`提供一位ACTIVE與一位INACTIVE synthetic staff，可切換人員、新增／修改／移除週間時段、新增／取消例外，並在React memory執行額度與重疊提示。畫面明示重新整理還原與登入串接後才遠端儲存。
- Desktop採三欄staff index／weekly ledger／exception desk；tablet將例外移至下方；mobile改單欄與固定底部工作區導覽。OpenAPI、staff availability data dictionary、design contract、Phase 2 plan、root/Web README與task index已同步。

### 驗證與失敗修正

- Contracts 10/10、database unit 9/9、database integration 11/11、API unit 36/36、API integration 36/36、Web unit 14/14通過。相關contracts/database/observability/API/Web lint、strict typecheck與production build全部exit 0；Next成功static prerender`/studio/staff`。
- Database concurrent integration證明`MAX_STAFF=1`下兩筆同時建立只會成功一筆。第一次repository nested create使用`services.createMany`時Prisma checked input拒絕scalar tenantId；改為同一transaction先建staff再建assignments後，targeted與完整11/11通過。
- 第一次API integration因shared `@nook/database` dist尚未重建，Nest讀到undefined repository constructor，5個suite未執行；重建contracts/database/observability後原樣重跑36/36。第一次API unit在sandbox因listener `EPERM`只有33 pass／CORS 3 fail，取得loopback listener權限後原樣重跑36/36。
- 第一輪正式lint找到controller一個未使用type import，移除後相關5個workspace lint／typecheck／build全數重跑通過，沒有降低規則。
- Browser實測桌面人員切換、MAX_STAFF阻擋、週間新增與exception新增。第一次console發現server/browser中文日期空白不同造成hydration mismatch；改為確定性`M/D HH:mm`後新tab console error 0。
- 390×844實測document scroll width 375、無水平溢位。測試同時發現既有mobile fixed nav因祖先`backdrop-filter`形成containing block而卡在header內；mobile topbar關閉filter後nav位於viewport底部`y=788`、品牌與LOCAL PREVIEW恢復可見。
- Live smoke第一次新staff route為404，確認8080仍是舊API child；只中止該repository API session並以bundled pnpm 11.9.0重啟。Nest明確map9個staff HTTP操作後，Web staff／health、API health／ready、worker health／ready皆200，未登入staff GET為401而非404。Web與worker既有session未重啟。
- OpenAPI YAML經Prettier parser、repository diff whitespace與相關文件格式檢查通過。API dev session保持運行供本機操作。

### 限制與下一步

- Web遠端保存仍依賴`P2-006` LINE/Firebase browser session；目前不能用本機預覽操作正式database。不得加入token form、localStorage credential或dev auth bypass來提前接線。
- Consumer availability、booking collision、appointment/hold、公開頁與作品尚未完成。依Phase 2順序下一個是`P2-004`作品集與受控圖片上傳，外部GCS/GCP credential不足時只完成local contract與測試，不冒充production evidence。
- 預設`MAX_STAFF=1`下若要替換唯一ACTIVE人員，目前需未來的商業升級或原子swap workflow；P2-003不猜billing／swap政策。
- 本輪沒有外部LINE/Firebase呼叫、GCP apply／deploy、commit、push或更新`main`。

## 2026-07-22 — Start portfolio and controlled media upload

### P2-004範圍與決策

- 建立`P2-004` task、ADR 0008、portfolio/media data dictionary與controlled upload security contract；task先標`in_progress`，未在驗證前宣稱完成。
- 決定採15分鐘Cloud Storage V4 signed POST policy，server固定object key、MIME與1–15 MiB；API不代理圖片。worker限制60 MP／單頁，輸出移除EXIF的1600px display與480px thumbnail WebP。
- `MAX_PORTFOLIO_IMAGES`計入有效PENDING與READY；第一版預設20。OWNER／MANAGER／STAFF可建立，VIEWER只讀；因staff membership綁定尚未完成，STAFF暫為tenant-wide並明文記錄限制。
- Cloud Run IAM／Cloud Tasks OIDC是worker身份邊界，queue header只做defense in depth。External GCP資訊缺少時GCP adapter必須fail closed；local contracts、processor與Web preview仍持續實作。
- 使用documentation-lookup skill查核Google Cloud Tasks HTTP/OIDC、Cloud Storage signed POST與Sharp input/output官方文件；Context7工具在目前環境不可用，因此沒有採用第三方摘要。npm registry於2026-07-22回報`@google-cloud/tasks 6.2.3`、`@google-cloud/storage 7.21.0`、`sharp 0.35.3`，後續將精確鎖版。

## 2026-07-22 — Complete portfolio and controlled media upload

### Schema、API與worker

- 第九個migration建立`PortfolioItem`、`PortfolioTag`與`MediaAsset`，加入tenant-composite foreign keys、MIME／15 MiB checks、READY完整性checks與`MAX_PORTFOLIO_IMAGES=20`。Repository以Serializable transaction同時計算未過期PENDING與READY，並在worker標READY前重新檢查額度，避免upload與verification race超額。
- Upload intent接受client UUID作idempotency key；相同tenant／actor／payload重試沿用aggregate與object key並更新短效expiry，不重複audit。API固定`tenants/{tenantId}/portfolio/{mediaAssetId}/upload`，V4 signed POST精確限制key、MIME、1 byte至15 MiB與15分鐘效期，圖片bytes不經API。
- Portfolio feature module提供list、upload intent、complete、metadata update、完整排序與soft delete。OWNER／MANAGER／active STAFF可寫、VIEWER只讀；application service執行RBAC與tenant scope，controller沒有Prisma。
- Cloud Tasks task name由media UUID決定，使用OIDC service account呼叫private worker，AlreadyExists視為idempotent成功。Worker另核對queue header，檢查object metadata、CRC、實際MIME、單頁與60 MP上限，再輸出固定key的1600px display與480px thumbnail WebP；Sharp預設不保留metadata。成功或安全拒絕後刪除原始物，READY／REJECTED重試維持終態；壞檔以bounded rejection code終止，storage暫時失敗保留5xx供Cloud Tasks重試。
- Runtime採discriminated config：預設`MEDIA_PIPELINE_MODE=disabled`；只有project、region、bucket、queue、HTTPS worker URL與invoker service account全部存在才允許GCP adapter。Terraform以`enable_media_pipeline=false`預設關閉，明確啟用才建立bucket／queue與注入runtime值；API具automation invoker actAs，worker仍以Cloud Run IAM為身份邊界。沒有執行plan或apply。

### Web、contract與文件

- `/studio/portfolio`以獨立feature module提供「darkroom contact sheet」作品工作台，可選JPEG／PNG／WebP、建立本分頁object URL預覽、編輯名稱／說明／最多10個tag、調整順序與移除。畫面明示目前是React memory、重新整理還原，且未取得LINE/Firebase session前不送出圖片或假裝遠端儲存成功。
- 使用frontend-design skill延續既有工作日誌語言，以暖紙底、墨色inspector、朱紅操作與acid狀態構成desktop contact sheet、tablet雙欄與mobile單欄。使用browser skill在真實Next dev runtime驗證1280×800與390×844；作品選取、名稱更新與往後排序皆反映正確status，mobile document scroll width 375／viewport 390無水平溢位，browser console warning/error為0。
- Shared Zod contracts、OpenAPI、ADR 0008、portfolio/media data dictionary、controlled-upload security contract、portfolio design handoff、README、Web README、Terraform README、Phase 2 plan與task index均已同步。documentation-lookup skill使OIDC task、signed POST與Sharp限制直接依官方contract設計，未新增未審查的雲端服務。

### 驗證與失敗重跑

- `pnpm db:migrate`確認9個migrations且`No pending migrations to apply`。Database integration 15/15，包含tenant isolation、MAX_PORTFOLIO_IMAGES並發、過期PENDING與verification終態；API integration 6 files／40 tests，包含signed key/policy、client retry、Cloud Tasks complete、STAFF／VIEWER RBAC、update/reorder/delete與跨tenant 404。
- Root unit tests全數通過：config 18、contracts 16、database 11、observability 4、LINE 5、API 37、worker 7、Web 17；沒有測試的packages依既有`passWithNoTests` contract退出0。Worker測試涵蓋metadata mismatch、實際MIME、衍生物、idempotency與decode rejection。
- Full repository lint 12/12、strict typecheck 12/12與production build 12/12通過；Next成功static prerender`/studio/portfolio`。Terraform mock tests 12/12、release contract 3/3、environment isolation與readonly validate先前在本slice完成後通過；`git diff --check`於文件收尾後再次通過。
- 第一次root lint/typecheck雖由bundled pnpm啟動，Turbo child仍從PATH抓到Homebrew pnpm shim；shim因受限registry無法驗證11.7.0簽章，在約2分21秒後退出1。改為把Codex bundled pnpm明確置於PATH首位，原樣重跑後lint與typecheck全數通過，沒有修改engine或跳過檢查。
- 第一次root integration沒有經env wrapper，15個database cases因缺`DATABASE_URL`失敗；經wrapper重跑時又因PostgreSQL尚未啟動而無法連線。啟動既有`nook-postgres-1`、確認migration可重入後，以相同tests完整重跑database 15/15與API 40/40。
- Browser互動後用猜測的`.portfolio-preview-index` locator讀值超時；未重複同一selector，重新取得DOM snapshot後以`SELECTED FRAME / 03`與status確認排序確實成功。此為驗證locator問題，不是產品失敗。
- Live smoke起初API／worker health為200但新route皆404，證明舊watch程序尚未載入本slice。以cwd確認程序只屬本repository後精確停止並重啟；最新Nest runtime明確map6個portfolio routes與`POST /internal/media/verify`。最終API／worker health皆200，未登入portfolio GET為401而非404，media-disabled worker endpoint為503而非404；Web、API、worker與PostgreSQL保持運行供本機操作。

### 限制與下一步

- 本機`.env`維持media disabled，因此可操作的是作品工作台與後端contract；真實GCS upload、Cloud Tasks OIDC、Cloud Run IAM及圖片delivery仍需GCP project／bucket／worker URL與staging deployment evidence。不得把mock與local processor tests宣稱為production上傳成功。
- Soft delete目前保留READY衍生物；正式privacy／retention流程需以後續受控cleanup task物理刪除object並保留必要audit，不在本task臨時加入破壞性刪除。
- Web正式持久化仍依賴`P2-006` browser session；公開圖片URL、地址隱私、publish gate與SEO屬`P2-005`。依Phase 2順序下一個repository slice是`P2-005`。
- 本輪沒有外部LINE／Firebase呼叫、GCP resource建立、Terraform plan/apply、commit、push或更新`main`；沒有讀出、顯示或寫入credential。

## 2026-07-22 — Start public merchant publication

### P2-005 範圍與決策

- 建立P2-005 task、ADR 0009、publication data dictionary、public-data security contract與公開商家頁design handoff；task維持`in_progress`直到完整驗證。
- 一般發布不硬綁Founder方案10張作品，採至少1張明確PUBLISHED且media READY作品；其餘門檻為完整profile/policies、ACTIVE location/service/staff與weekly availability。邏輯只讀通用狀態，不分支plan name。
- 住家工作室由API server-side只回city/district；公開contract排除phone、userId、exception reason、bucket/object key。公開圖片用15分鐘V4 signed GET URL；media disabled時fail closed。
- 新增`/m/{slug}`真實動態頁與`/preview/merchant` noindex synthetic預覽。預約仍屬Phase 3，UI明示COMING SOON，不建立假booking成功。
- 使用documentation-lookup skill核對Next `generateMetadata`、Nest controller/public route與Prisma relation select官方文件；Context7目前不可用，未新增替代套件。使用frontend-design skill將公開頁設計為米紙／深墨／朱紅的editorial storefront，與studio工作台明確區隔。

## 2026-07-22 — Complete public merchant publication

### Schema、API與privacy

- 第十個migration新增merchant profile nullable UTC `publishedAt`，backfill既有PUBLISHED資料，並以DB checks固定merchant／portfolio PUBLISHED都必須有`publishedAt`。第一次deploy成功套用，第二次回`No pending migrations to apply`。
- 獨立`MarketplaceModule`提供publication readiness GET、merchant publish/unpublish PUT、portfolio publication PUT與無需登入的marketplace GET。OWNER／MANAGER可寫、active member可讀；SUSPENDED不能自助恢復，所有write在application授權並寫safe audit。
- Readiness涵蓋profile policies、ACTIVE primary location、ACTIVE booking service、eligible staff、weekly availability與至少一張PUBLISHED＋READY作品；不讀plan code/name。publish transition採Serializable transaction重算門檻。
- 公開repository只讀ACTIVE tenant＋PUBLISHED profile；response allowlist排除phone、tenantId、userId、availability exception reason與storage path。`isPublicAddress=false`由API固定回`DISTRICT_ONLY`及city/district，其餘地址欄位為null。
- 只有PUBLISHED＋READY作品能取得15分鐘Cloud Storage V4 signed GET URL；`MEDIA_STORAGE_MODE=disabled`或簽名失敗時回通用503，不洩漏provider錯誤或object key。

### Web與文件

- `/m/{slug}`以server-side API讀取公開資料並動態產生metadata；找不到或API不可用時不渲染假資料。`/preview/merchant`使用synthetic資料、明示LOCAL PREVIEW且`noindex,nofollow`。
- 使用frontend-design skill建立暖米紙、深墨與朱紅的editorial storefront；呈現服務價格／時間、作品、區域、政策與聯絡連結。固定狀態列明示「線上預約即將開放／Phase 3」，沒有booking form或假成功。
- Shared contracts、OpenAPI、ADR 0009、publication data dictionary、public-data security contract、design handoff、root/Web README、Phase 2 plan、task與`.env.example`已同步。Production release仍須注入真實`API_INTERNAL_BASE_URL`。

### Tests與驗證

- Contracts 23/23、database unit 11/11、database integration 18/18、API unit 38/38、API integration 43/43、Web unit 19/19、worker unit 7/7、observability 4/4、config 18/18與LINE 5/5通過；沒有測試的packages依既有contract退出0。
- Database integration覆蓋incomplete publish、READY gate、tenant isolation、safe audit、ACTIVE/PUBLISHED filter；API integration覆蓋OWNER publish、VIEWER read-only、authorization audit、跨tenant 403/404、無登入public read與private address／phone／storage key不外洩。
- Full repository 12/12 lint、12/12 strict typecheck、12/12 production build通過；Next確認`/m/[slug]`為dynamic server route、`/preview/merchant`為static route。Architecture 17/17、repository/workflow/deployment/CI/local-dev checkers、full Prettier與`git diff --check`通過。
- 第一次migration在sandbox無法存取本機PostgreSQL而只回泛化schema engine error；確認`nook-postgres-1` healthy後在允許loopback的同一指令成功套用。第一次root unit的既有CORS suite因sandbox拒絕`0.0.0.0` listener而35 pass／3 fail；在允許本機listener環境原樣重跑API 38/38，沒有修改測試。
- 第一次database typecheck找到nullable relation未充分收窄，改為先判斷tenant/profile後重跑；第一次API typecheck找到audit actor mapping遺漏，改為顯式`actorUserId`後重跑。首次full lint找到integration assertion的`expect.any`為unsafe any，改為具體URL suffix assertion後full lint通過，沒有放寬規則。
- Browser skill實測1280×800與390×844。Desktop／mobile document scroll width分別1265/375，小於viewport 1280/390；mobile services為單欄、fixed booking bar位於`y=780`／viewport底部，console warning/error 0。「探索服務」唯一連結會移至`#services`且section top約0；preview title、`zh-Hant`與noindex metadata正確。
- Live smoke發現8080仍是本repository舊API watcher且新route為404；以PID/cwd確認後只停止該API watcher並重啟。最新Nest明確map3個publication admin operations與marketplace GET；未登入publication回401、未發布slug回privacy-safe 404，API dev runtime保持執行。

### 限制與下一步

- 本機media仍disabled，真實公開圖片delivery需GCP bucket、runtime identity與staging evidence；integration使用synthetic signer，不宣稱production GCS成功。
- Web studio正式持久化與publication UI仍依賴`P2-006` LINE/Firebase browser session。現在可直接看公開頁preview，但不能從studio UI發布真實tenant。
- QR圖檔、consumer availability、appointment／hold、評論、搜尋排名與付款不在P2-005。永久`/m/{slug}`已提供QR來源，QR產生需另立task，不為此偷加dependency。
- 本輪沒有GCP apply/deploy、外部LINE/Firebase呼叫、commit、push或更新`main`；沒有讀出、顯示或寫入credential。

## 2026-07-22 — Start browser identity and Studio storage

### P2-006 範圍與決策

- 建立P2-006 task、ADR 0010、browser session data dictionary、security contract、Studio auth shell design與外部設定runbook；task維持`in_progress`直到正式API接線及完整驗證。
- 本slice不是單一登入demo：Studio共用session、tenant selector與typed API client，之後依序接上onboarding、服務、員工班表、作品與發布工作流。
- 使用LINE LIFF與Firebase Web官方SDK；browser只傳raw LINE ID token到server驗證，不信任decoded profile，也不自行保存custom token或Firebase ID token。
- session預設`browserSessionPersistence`；只有店主明確勾選「信任這台裝置」才使用local persistence。只允許把非credential的selected tenant ID寫入sessionStorage。
- Web透過runtime endpoint取得公開LIFF ID、Firebase Web config與API origin；正式模式缺設定時fail closed。本機auth disabled仍保留明示LOCAL PREVIEW且不送PII。
- 使用documentation-lookup skill核對LINE LIFF login／ID token、Firebase custom auth／persistence與Next runtime environment官方文件；目前沒有Context7 connector，因此只以provider官方文件決定contract，未新增非官方identity套件。

### P2-006 第一段實作與驗證

- ADR先記錄後鎖定官方`@line/liff@2.29.1`與`firebase@12.16.0`，Web新增`@nook/config`workspace dependency。套件安裝的第一次指令因zsh展開未引用的`workspace:*`而未執行；正確引用後安裝與Prisma generate成功，lockfile通過既有供應鏈policy。
- 新增`parseWebRuntimeConfig`與`/api/runtime-config`。development/test安全預設為auth disabled＋localhost API；staging/production要求精確HTTPS origin；firebase-line缺LIFF ID或任一Firebase Web公開欄位時回503。response contract為strict allowlist，測試證明額外channel secret／service-account值不會被複製。
- Web使用LIFF `init/login/getIDToken/getDecodedIDToken/logout`，只把raw ID token與provider nonce送既有exchange；decoded profile不進API。Firebase modular Auth設定persistence後交換custom token，每次API request才呼叫`getIdToken()`；只有非credential的persistence偏好與selected tenant ID進Web Storage。
- `/studio/login`、`/studio`與共用layout已建立configured／unconfigured／loading／signed-out／tenant-required／ready／degraded／LOCAL PREVIEW狀態。`GET /v1/me` membership增加tenant name/slug/status，支援多店選擇；無membership可建立第一個tenant。
- typed client已處理401清session、403保留登入、409／429／503與network safe message；503保留session。onboarding已接GET／PUT，服務目錄已接list/create/update/status/reorder與動態`MAX_SERVICES`；兩者在disabled模式維持原LOCAL PREVIEW。人員、作品與publication接線仍待完成，因此P2-006保持`in_progress`。
- Config unit 24/24、contracts 25/25、Web unit 21/21通過；相關四個workspace lint與全repository strict typecheck通過，Web production build成功產生dynamic`/api/runtime-config`及static`/studio`、`/studio/login`與四個工作台routes。第一次Web測試因`@nook/config`舊dist尚未重建而2 cases失敗，按workspace build contract重建config/contracts後原樣21/21通過。
- API integration 7 files／43 tests全數通過，包含更新後`GET /v1/me`的tenant name／slug／status、active-user gate、跨tenant denial，以及onboarding讀寫與RBAC。原本傳入tenant測試檔名，但現有Vitest workspace設定仍執行完整integration suite；未縮小或跳過結果。
- Live smoke在允許loopback後確認runtime config回`{"mode":"disabled","apiBaseUrl":"http://localhost:8080"}`且`/studio`、`/studio/login`皆200。Browser skill實測1280px與390×844：scroll width分別1265與375、小於viewport；手機workspace grid為單欄，共用導覽可進入onboarding，console沒有產品error。Next smooth-scroll警告已以官方要求的HTML marker修正；Fast Refresh full-reload warning只發生於開發中修改module的瞬間。
- 外部LINE／Firebase provider尚未設定，因此沒有宣稱真實登入成功；沒有外部API credential、GCP apply/deploy、commit、push或更新`main`。

## 2026-07-22 — Complete browser identity and Studio persistence

### 正式工作台接線

- Staff工作台在auth enabled時以選定tenant讀取正式人員資料；無人員時先讀onboarding location與ACTIVE service，再建立第一位人員。狀態更新、週間規則完整取代、例外新增與取消均接正式API；台灣`datetime-local`以純函式確定轉換UTC，並有跨UTC日期邊界測試。LOCAL PREVIEW仍只更新React memory。
- Portfolio工作台完成intent → signed multipart POST → complete流程，並接metadata、排序、soft delete與作品publish/unpublish。Upload policy fields只存在單次request流程，不保存、不輸出；provider disabled／錯誤時保留誠實本機項目及安全訊息，不冒充遠端成功。
- 新增`/studio/publication`，依readiness API呈現六項門檻並執行店家publish/unpublish；未READY與SUSPENDED都不放行。Studio共用導覽與總覽加入發布中心，第五個workspace沿用同一session與tenant context。
- Credential handling modules不再直接碰Web Storage；集中adapter只允許`nook.selectedTenantId`、`nook.login.remember`與`nook.auth.persistence`。Boundary test同時禁止token/profile/PII key、URL query與console sink。

### 驗證與工作環境

- Web lint與strict typecheck通過；12 test files／38 tests通過，新增Taipei時間4、credential storage boundary 4、API error 6與publication 3 cases。Root test在允許既有CORS suite開啟本機暫時listener後18/18 Turbo tasks成功；第一次sandbox run僅3個CORS listener因`EPERM 0.0.0.0`失敗，API其餘35 tests通過，未修改測試規則。
- Web production build成功，包含static `/studio/publication`；architecture contract以單一test concurrency跑17/17。Root Turbo build／architecture曾在已知V8 worker shutdown等待中無輸出，停止該程序後改以直接Node入口取得明確exit 0，沒有把超時視為通過。
- Browser在1280×800與390×844驗收Studio總覽、人員班表、作品與發布中心；document scroll width均不大於client width，publication未完成門檻時按鈕停用，console warning/error為0。首次導航後太早讀DOM得到tenant-required SSR fallback；取得fresh DOM snapshot等待client session落定後，以LOCAL PREVIEW完整頁面重驗通過。
- Live smoke確認runtime config為disabled＋`http://localhost:8080`，`/studio`、`/studio/staff`、`/studio/portfolio`、`/studio/publication`皆HTTP 200；publication API未登入回401而非404。

### 交接限制與下一步

- P2-006 repository-local acceptance已完成並標為`done`。正式LINE external browser／LIFF browser登入、Firebase persistence、GCS upload與公開圖片delivery仍需要外部帳號、憑證與staging設定；依`docs/runbooks/line-firebase-browser-setup.md`執行，不得把LOCAL PREVIEW或synthetic adapter tests當production evidence。
- Phase 2仍缺「至少一項服務能產生consumer可預約時段」；availability slot generation、appointment hold、防撞transaction、Messaging API官方帳號互動與付款應拆成後續垂直task。下一輪先依產品文件建立Phase 3 implementation plan與task，不直接擴寫既有slice。
- 本輪沒有GCP apply/deploy、外部LINE/Firebase呼叫、commit、push或更新`main`；沒有讀出、顯示或寫入credential。

## 2026-07-22 — Plan Phase 3 booking core

- 依產品文件§7與Phase 3交付順序建立`docs/phase-3/implementation-plan.md`。預約核心拆成availability、hold、防撞確認、店家／顧客查詢、取消改期、提醒六個垂直task，避免以單一大任務混入付款、搜尋、CRM或評論。
- 建立`P3-001` ready task：先做公開availability query與純domain calculator，明確納入weekly、exceptions、staff-service、duration、buffer、lead/advance policy及未來occupancy input；最多查7天，結果不是reservation。
- P3-001明確不提供假的預約CTA；booking hold、transaction confirmation、PostgreSQL occupancy constraint與idempotency留給P3-002/P3-003。LINE/Firebase、Messaging API、GCP與付款仍需外部staging evidence。
- Doc-coauthoring reader test第一輪找到policy lifecycle、query日期、exception優先序、buffer／occupancy邊界、any-staff response、privacy status與timezone歧義；全部改為可測contract。第二輪只剩既有`bookingEnabled`來源與新tenant policy invariant，確認Phase 2 schema及marketplace response後補明：既有欄位與assignment直接沿用，新tenant transaction內建立policy，缺row fail closed 503。

## 2026-07-22 — Start P3-001 availability engine

- 將P3-001改為`in_progress`。先建立booking policy lifecycle與純domain calculator，再接公開repository/API與RWD選時；不先做React-only假時段，也不把candidate availability宣稱為hold或confirmed appointment。
- 現有Phase 2 schema已具`Service.bookingEnabled`、`StaffProfile.bookingEnabled`、staff-service assignment、weekly rules與UTC exceptions；現有marketplace response也已server-side過濾並公開staff `serviceIds`。P3-001直接沿用，不重複新增欄位。
- 本slice不新增外部服務或第三方dependency；timezone計算維持純TypeScript/IANA `Intl` boundary並以DST cases驗證。若實作證明需要新套件，必須先新增ADR，不會先安裝再補文件。

## 2026-07-22 — P3-001 availability implementation checkpoint

### Policy、calculator與公開API

- 第十一個migration新增tenant一對一`BookingPolicy`，限制slot interval、lead與advance window並backfill既有tenants；tenant owner建立transaction nested create policy。Migration已成功套用本機PostgreSQL，database integration證明新tenant與policy同時存在；migration contract test固定全tenant backfill SQL、PK/FK及DB checks。
- 新增純domain calculator：以tenant IANA timezone把weekly與`EXTRA_HOURS`合併，再扣除`TIME_OFF/BLOCK`；slot從當地午夜對齊，duration及前後buffer完整落在同一open interval，occupancy採`[start,end)`。Asia/Taipei、DST不存在／重複時間、例外優先與any-staff aggregation皆有unit evidence。
- Marketplace repository只select已發布ACTIVE tenant/location、ACTIVE＋booking enabled service/staff、有效assignment及bounded availability資料。公開API固定`reservation=false`，只回service/staff allowlist、UTC candidate slots、timezone與eligible staff IDs；未知或跨tenant資料回privacy-safe 404，日期範圍錯誤400，missing policy fail closed 503並寫safe structured log。

### Web與文件

- 公開storefront新增服務／設計師／日期picker與idle/loading/empty/error/available states。瀏覽器透過同源Web proxy查詢；proxy重新驗證strict query且不轉送cookie、Authorization或任意client header。選取只存在React memory並持續顯示「尚未保留」，沒有完成或成功CTA。
- LOCAL PREVIEW明示模擬時段。Frontend-design skill延續既有米紙／深墨／朱紅editorial語言，desktop雙欄、tablet與mobile收斂；OpenAPI、availability data dictionary、public security contract、design handoff、Phase 3 plan與task同步。

### 驗證、失敗與剩餘gate

- Database integration 3 files／19 tests與API integration 7 files／45 tests循序全綠；availability成功、privacy 404、bad range 400與missing policy 503皆在完整API suite內通過。先前把database/API integration同時執行造成fixture delete race，本checkpoint只採循序重跑結果。
- Domain 4/4、contracts 27/27、database unit 13/13、API unit 38/38、Web 38/38通過；受影響及全workspace src/test lint、12個workspace strict typecheck、API/worker/package TypeScript builds、Web production build、architecture 17/17與完整Prettier／diff check通過。Root Turbo test兩次停在workspace build或只顯示啟動訊號而沒有exit code，因此不把該兩次視為通過，改以明確exit code的workspace suites作證。
- Live Web在`/preview/merchant`與`/api/health`回200，HTML包含LOCAL PREVIEW、候選時段與尚未保留文案。8080原有本repository舊watcher尚未map新route；以PID/cwd確認屬`nook/apps/api`後精確停止並重啟，最新Nest明確map`/v1/marketplace/merchants/:slug/availability`。最終Web preview/health、API health皆200，invalid availability query為400 Problem Details而非舊route 404；最新API與Web dev servers保持執行。
- Browser skill因先前localhost未啟動形成的Chrome data error page被URL安全政策鎖住，政策禁止改用其他browser control繞過；本輪未能完成1280×800／390×844互動與console evidence，所以P3-001維持`in_progress`，fresh browser session重驗後才可標done。
- 本輪沒有建立hold／appointment、外部LINE/Firebase/GCP呼叫、Terraform apply、commit、push或更新`main`；沒有讀出、顯示或寫入credential。

## 2026-07-22 — Complete P3-001 availability engine

- Fresh Browser session成功開啟`/preview/merchant`。Desktop 1280×800的document scroll/client width為1265/1265，availability為雙欄、form為四欄；mobile 390×844為375/375，availability與form單欄、slots三欄，fixed booking bar bottom為834且未超出844 viewport。
- 真實互動查詢回3個Asia/Taipei候選時段；選13:30後`aria-pressed=true`且文案為「已選13:30，尚未保留」。切換到150分鐘自由設計會清除舊選取並重新回到「此步驟不會建立或保留預約」，沒有假成功狀態。Desktop/mobile及最終console warning/error皆0。
- P3-001全部acceptance criteria已核對並標為`done`；下一個slice為P3-002 10分鐘booking hold、過期與PostgreSQL occupancy constraint。Web/API dev servers仍在3000/8080運行。本輪沒有commit、push或更新`main`。

## 2026-07-22 — Plan P3-002 booking hold

- 建立P3-002 ready task。核心決策是hold要求verified consumer identity、固定10分鐘、同consumer/tenant一次一筆、每user 10分鐘10次rate limit，避免匿名囤位；body不接受consumer、tenant、duration、buffer或price。
- Database以ACTIVE partial GiST exclusion constraint作同staff占用區間最後防線；create transaction仍重新計算availability、清理相關expired rows、處理idempotency並釋放同consumer舊hold。不能以React state、memory lock或availability query冒充防撞。
- Hold保存catalog快照並固定`appointmentCreated=false`，不計入月預約配額、不發通知、不產生媒合費。P3-003必須把hold與appointment統一成跨表occupancy invariant，不能留下hold/appointment競態。
- 使用doc-coauthoring skill將identity、TTL、idempotency、any-staff、expiry與商業濫用風險寫成可測contract；reader test完成前不開始schema實作。

### P3-002 reader test修正

- Fresh reader指出holds與appointments各自constraint會留下跨表競態；改為P3-002現在就建立共用`booking_occupancies`唯一防撞表，P3-003原子轉移同一occupancy ownership。
- 補明同consumer/tenant使用transaction advisory lock、換新hold失敗整筆rollback保留舊hold、idempotent replay即使terminal也不換位或延長、distinct-key rate attempt獨立計數、單一PostgreSQL `dbNow`及release/expiry完整狀態語意。
- Reader test第二次縮小到task本身後已能提出可直接實作的8項修正；P3-002改為`in_progress`，下一步先寫ADR與database model，不在文件仍含blocking ambiguity時寫migration。

### P3-002 database occupancy foundation

- ADR 0011接受共享`booking_occupancies` ledger與PostgreSQL `btree_gist`，拒絕holds／appointments分表constraint、先查再寫、process mutex及Redis外部鎖。P3-003必須轉移同一occupancy row，不能再創另一套防撞來源。
- 第十二個migration新增hold/occupancy status enums、`booking_holds`完整服務與price/duration snapshots、distinct-key `booking_hold_rate_attempts`及tenant-composite FKs。GiST exclusion以tenant＋staff equality及半開`tstzrange`限制ACTIVE occupancy重疊；service/expiry/duration/currency/price ranges另有DB checks。
- Migration成功套用本機PostgreSQL，Prisma validate/generate及database strict typecheck通過。Migration contract unit固定extension、共享ledger、半開range、ACTIVE predicate、tenant staff FK、idempotency與rate-attempt uniqueness。
- 兩個獨立Prisma connections併發插入重疊occupancy時只有1筆成功；相鄰`[start,end)`兩筆都成功，terminal occupancy不阻擋replacement。新增integration 3/3，完整database integration 4 files／22 tests與unit 7 files／15 tests全綠。
- 目前只完成database invariant，尚未建立transaction repository、expiry worker、authenticated API、availability occupancy adapter或Web hold UI；P3-002維持`in_progress`。沒有commit、push、外部provider呼叫或Terraform apply。

### P3-002 hold repository lifecycle checkpoint

- 中斷的離線pnpm流程曾讓`node_modules`只剩不完整目錄；依既有frozen lockfile重建624個packages並重新產生Prisma client，全程沒有變更dependency版本。原本3000／8080 watcher是否仍存活會在live smoke重新確認，不以安裝前狀態推定。
- 新增transaction repository，create／release／expiry統一使用PostgreSQL transaction timestamp。Distinct idempotency-key rate attempt在獨立transaction計數；相同key replay不重複計數，第11個distinct key正確拒絕。
- PostgreSQL advisory lock的`void`結果最初無法被Prisma反序列化，改回傳boolean expression；整合fixture也移除nested staff-service relation不接受的重複`tenantId`，修正後原本5個案例全綠。
- SERIALIZABLE transaction若在等待lock前已取得snapshot，waiter可能看不到winner剛提交的舊hold。Repository現在於第一個snapshot query前先以slug＋consumer穩定鍵序列化，再於讀出tenant後取得tenantId＋consumer lock；兩個獨立Prisma connections同時換不同時段後，資料庫最終只留1筆ACTIVE及1筆RELEASED。
- Repository專項整合6/6通過，涵蓋原始expiry的冪等replay、不同fingerprint衝突、失敗替換完整rollback、成功替換、跨連線同consumer競爭、release重試與實際expiry batch重試（首次1、再次0）；terminal hold／occupancy保持不變。下一步接shared contract與authenticated API。

### Local environment follow-up

- 使用者的終端輸出確認Node `v24.18.0`與pnpm `11.7.0`已符合engine，dependency install、Prisma generate、PostgreSQL container與Web 3000皆正常；當次migration、API與worker失敗的唯一直接原因是process未取得`DATABASE_URL`，所以該次不能視為完整啟動成功。
- 根目錄`.env`目前存在且`DATABASE_URL`非空；既有未提交修正已讓`pnpm db:migrate`與`pnpm dev`透過`infra/dev/run-with-env.mjs`載入根目錄環境。重新執行`pnpm db:migrate`成功連上本機`nook`資料庫，辨識13個migrations且無待套用項目；未輸出或記錄credential內容。

## 2026-07-22 — Complete P3-002 booking hold

### Repository、API、Worker與Web

- 完成Prisma transaction repository與shared `booking_occupancies` ledger。Create以PostgreSQL `dbNow`、consumer／tenant advisory lock及GiST exclusion constraint固定10分鐘hold；lazy expiry、replace rollback、release、terminal replay與worker batch expiry共用明確狀態語意。
- Any-staff改為依repository讀出的`sortOrder, id`穩定選定一次；insert conflict不fallback而回privacy-safe 409。Prisma實際exclusion error是SQLSTATE `23P01`，mapping只接受該code與`booking_occupancies_no_overlap` constraint，避免把無關資料庫錯誤誤報成slot conflict。Retryable serialization failure最多三次，耗盡後固定映射為slot unavailable。
- Authenticated create/release API、availability occupancy adapter與private worker expiry operation完成。Rate attempt在auth、user status及UUID key驗證後、slug/body/catalog/slot驗證前獨立記錄；新增integration assertion證明無效／缺少key不計數、有效key後的strict-body 400會計數。
- 公開Web完成configured LINE consumer session與LOCAL PREVIEW hold／replace／release／expiry UI。Not-configured、degraded、config-loading及signing-in現在都有明確disabled CTA與`role=alert`原因，不再出現可點但無反應的保留按鈕。

### Contract、文件與reader verification

- OpenAPI新增create/release/internal expiry contract；`startAt`以pattern固定UTC三位毫秒與trailing `Z`，price snapshot以`oneOf`限制FIXED／FROM／RANGE／QUOTE合法shape。ADR 0011、data dictionary、security/design contract及expiry runbook均同步。
- Doc-coauthoring reader test第一輪找出db clock、expired replay、rate ordering、未存在GET、any-staff fallback、price shape、timestamp格式與external gate八項歧義；全部修正後第二輪通過。Repository completion與真實LINE/Firebase、Cloud Scheduler OIDC及owner production核准已分開記錄。

### 驗證、失敗與外部限制

- 完整database integration為5 files／32 tests、API integration為7 files／47 tests並循序通過；最後application validation-order變更再重跑merchant-publication integration 7/7。Repository evidence涵蓋跨connection重疊、相鄰range、terminal cleanup、stable any-staff、specified staff、price/duration snapshots、catalog mutation、replace rollback、cross-consumer conflict與terminal replay。
- Full workspace unit suites、12個strict typechecks、direct ESLint、API／worker／packages TypeScript builds、Web production build（13 routes）、architecture 17/17、Prisma validate、完整Prettier及`git diff --check`通過。最後UI變更再重跑Web 3/3、API／Web lint/typecheck、API build、Web build及API architecture 9/9。
- Browser skill實測LOCAL PREVIEW：1280×800為availability雙欄／form四欄／slot四欄；390×844為單欄／slot三欄。兩者均無水平溢位、fixed bar未遮內容、console warning/error為0；hold倒數、replace、release及`HELD · 尚未建立預約`均實際操作通過。這是明示模擬，不等於正式資料庫或LINE登入證據。
- 驗收期間pnpm shim因受限registry無法驗證11.7.0簽章而退出1；沒有設定`pmOnFail=ignore`或改lockfile，改用既有lockfile安裝內容的直接Node入口取得明確exit code。Database integration初次在sandbox無法連localhost；啟動既有PostgreSQL容器並在允許loopback後原指令通過。錯誤工作目錄造成的Next／architecture命令先失敗，修正入口與cwd後原檢查通過；所有失敗均未被計為成功。
- P3-002標為`done`僅代表repository/local acceptance。真實LINE／LIFF→Firebase staging、private Cloud Run worker的Google-signed Scheduler OIDC負向驗證及owner核准production Scheduler仍未完成。下一個repository slice為P3-003 appointment confirmation；本輪沒有commit、push、GCP apply/deploy或更新`main`，也沒有輸出或寫入credential。

## 2026-07-22 — Start P3-003 appointment confirmation

- 建立P3-003免定金confirmation task並標為`in_progress`。成立點固定為authenticated `POST /v1/appointments`，只接受hold ID、policy acknowledgement與idempotency key；browser不能傳consumer、tenant、staff、time、price、source或payment狀態。
- Confirmation必須在單一Serializable PostgreSQL transaction建立appointment/item/history/audit/outbox/key mapping，原子把既有occupancy owner由hold轉給appointment並將hold設CONSUMED。Natural replay與不同idempotency key並發都不得建立第二筆appointment或短暫釋放range。
- 商業規則不把FROM／RANGE／QUOTE冒充精確成交額；只有FIXED／staff override寫EXACT totals。P3-003固定免定金`CONFIRMED + NOT_REQUIRED`，不提前模擬付款或LINE通知成功。
- 月額度使用generic `MAX_MONTHLY_BOOKINGS`，正整數為tenant-local確認月份上限、0為unlimited；取消不退額度，達上限不consume hold。現階段source由server固定`MERCHANT_LINK`，不信任browser自報MARKETPLACE，避免未來8%媒合費歸因被規避。
- 使用doc-coauthoring skill將交易順序、privacy、address/policy snapshot、state machine、entitlement與outbox寫成可測contract；下一步由fresh reader檢查阻塞歧義，通過後才建立migration。

### P3-003 reader contract refinement

- Fresh reader第一輪找到expired mutation會被exception rollback、service range與含buffer occupancy被誤要求相等、月額度缺usage timezone/effective plan、舊P3-002 binary漏讀appointment occupancy、one-item過度宣稱、state matrix、replay representation、policy TOCTOU及lock-order等阻塞問題。
- 規格改為hold階段保存policy/address/location-timezone/source snapshots並發server policyVersion；confirmation echo版本，canonical hash固定compact Node `JSON.stringify` bytes。Usage timezone獨立為tenant權威欄位，subscription lifecycle解析effective plan，usage month持久化且取消不退額度。
- Expand-and-contract加入feature flag、舊revision drain與舊hold 10分鐘expiry gate；P3-002所有writer統一hold→occupancy lock order，availability改讀全部ACTIVE occupancy。Expired cleanup改為transaction maintenance outcome先commit再409；corruption rollback 503。
- 第二輪補齊consumer composite ownership、防完整地址replay洩漏、usage/location timezone命名、default-plan partial unique防禦、price DB shape與error code。最後一輪發現CONSUMED replay不能再找hold-owned occupancy，改為先鎖hold、再驗appointment-owned ACTIVE occupancy。第三次回歸確認無implementation blocker，規格可直接實作。
- Documentation-lookup skill要求Context7，但本環境沒有該connector；改查Prisma 6官方compound constraint、relation及expand-and-contract／migrate deploy文件。決策維持schema composite unique/FK加手寫PostgreSQL constraints，不新增dependency。

## 2026-07-22 — Complete P3-003 no-deposit appointment confirmation

### Database、transaction與commercial rules

- 新增兩個expand migrations與Prisma models：tenant usage timezone、appointment/item/history/idempotency/outbox、hold policy/address/source snapshots，以及shared occupancy的nullable hold/appointment XOR owner。Follow-up migration保留composite ownership FK，同時補Prisma nullable relation需要的direct FK。
- Confirmation repository以Serializable transaction、consumer/key advisory lock及hold→occupancy row lock order建立aggregate。成功時同transaction寫item、initial history、safe audit、ID-only outbox與confirmation key，單一UPDATE把原ACTIVE occupancy owner轉給appointment，再CAS consume hold；不存在release/insert空窗。
- 同key/same fingerprint與same hold/new key都回原201 representation；不同fingerprint 409。ACTIVE expired path以maintenance outcome先commit hold/occupancy EXPIRED，再由application回409；released、cross-consumer、policy mismatch、entitlement failure與corruption都不留下partial appointment。
- `MAX_MONTHLY_BOOKINGS`只依subscription lifecycle與generic entitlement code解析；tenant/usageMonth lock保護最後一筆。兩個獨立connections在limit=1時只有一方成立、另一方403且hold保持ACTIVE；0=unlimited兩筆都成立。IANA usage timezone的UTC/月界線測試通過。
- FIXED/staff override為EXACT並保存total；FROM/RANGE為ESTIMATE且totals null，QUOTE為QUOTE_REQUIRED且totals null。初始狀態固定CONFIRMED、NOT_REQUIRED、deposit 0；domain allowlist完整覆蓋四個terminal states。

### API、Web與privacy

- 新增authenticated `POST /v1/appointments`、strict shared contract與OpenAPI。Malformed hold UUID、未知或其他consumer一致404；browser無法注入consumer、tenant、staff、price、source、address或payment。Staging/production feature flag預設false，development/test預設true。
- Hold response現在包含canonical policy snapshot/version但仍排除完整地址；固定hash vector為`v1:45e250fe267c7d46d979461c4192a671359ececb21d2738e044b3f4615ccc024`。API E2E證明只有原consumer的confirmed response取得相同policy與private address，另一consumer固定404。
- Web與LOCAL PREVIEW完成hold→policy acknowledgement→confirm。成功卡片顯示店家當地時間、truthful price及完整地址，並明示「不代表LINE通知已送達」。Browser skill實測時先抓到confirmed後仍顯示保留/釋放按鈕，修正後重驗不再出現歧義操作。
- Desktop 1280×800為scroll/client width 1265/1265，fixed bar bottom 780.8；mobile 390×844為375/375、form單欄、slots三欄、fixed bar bottom 834.4。兩者都能完成acknowledge/confirm，mobile可見完整地址與無通知送達聲明；fresh tab console warning/error為0。

### Migration recovery、verification與remaining gates

- 本機第一次套follow-up relation FK migration時發現direct constraints已由當時的expand migration存在，PostgreSQL以42710拒絕且transaction未部分套用。Migration改為明確查`pg_constraint`，以Prisma migrate resolve標記rolled back後重跑成功；第二次no pending。另建一次性`nook_p3_003_replay` database從零順序套用全部15個migrations成功、第二次no pending，驗證後已刪除該測試database。
- Full workspace unit tests、12-package lint/typecheck/build、architecture 17/17、API architecture 10/10、Prisma validate、Prettier、OpenAPI YAML parse與git diff check通過。完整integration在第一次回歸因舊suite teardown未清appointment FK而失敗；補booking-hold與merchant-publication aggregate cleanup後重跑9/9 tasks成功。P3-003 repository integration最後9/9，涵蓋aggregate、replay、expiry、rollback、same-hold concurrency、monthly concurrency、0 unlimited及四種price truth。
- Live smoke為Web health 200、API health 200、Worker health 200；不帶credential呼叫appointment endpoint為401。沒有輸出、寫入或持久化token，也沒有commit、push、GCP apply/deploy或更新`main`。
- P3-003標為`done`只代表repository/local acceptance。真實LINE/LIFF→Firebase staging、owner正式月額度決策、production revision drain/10分鐘舊hold gate與P3-006通知provider仍是external activation gates。
- 最終交接前重新啟動既有PostgreSQL container並確認15個migrations皆已套用、no pending；database integration 6 files／41 tests與API integration 7 files／48 tests循序全綠。Turbo入口曾因Corepack無法連registry驗證pnpm 11.7.0簽章而拒絕啟動，未設定`pmOnFail=ignore`；改以同一lockfile現有工具直接執行並保留明確exit code。首次container尚未可連線及一次未重現的Prisma concurrent unknown error均未計為成功，正式測試檔再次重跑後全綠。

## 2026-07-22 — Start P3-004 appointment views and merchant calendar

- 建立P3-004雙方read-only查詢task。Consumer API只從principal推導owner並分為upcoming/past cursor pages；merchant API要求ACTIVE membership、31天有界overlap window，OWNER/MANAGER/VIEWER可讀全店，STAFF只能讀唯一綁定自己的StaffProfile。
- 隱私contract只讓merchant看到營運必要的current consumer display name，不回consumer ID、電話、email、avatar、LINE identity、完整地址、policy或notes；consumer owner才可讀自己的完整address/policy。列表不建立CRM或以source直接認列8%媒合收入。
- Cursor固定database `asOf`並綁定query filters；所有consumer/tenant repository predicates必須在最外層明確scope。下一步依doc-coauthoring skill執行fresh reader test，修正blocking ambiguity後才開始migration/API實作。

### P3-004 reader test refinement

- Fresh reader第一輪指出四種DTO沒有exact allowlist、staff snapshot實際位於consumed hold、merchant cursor缺asOf、STAFF detail 403會洩漏存在性、profile active predicate、calendar timezone啟動、timestamp/31天/cursor canonical、history排序與PII cache十項blocker。
- Task已補四種strict DTO、merchant-only source/current consumer name、hold staff-name snapshot、consumer owner-only address/policy，以及history `createdAt,id`排序與nullable fromStatus。STAFF list other-filter為403但detail直接以tenant+effective staff+ID scope並對所有foreign/unknown回404。
- `/v1/me` membership將提供tenant usage timezone，Studio以七個local calendar-day boundary轉UTC；calendar response明分tenant calendarTimezone與每筆location timezone。所有read endpoint要求private/no-store，cursor raw/decoded size、exact keys、null canonicalization與timestamp/UUID grammar均固定。下一步進行第二輪fresh reader regression。
- 第二輪fresh reader逐項回歸先前十個問題，確認全部消失且沒有新增implementation/acceptance blocker；P3-004 contract可直接實作。開始第16個index-only migration、shared DTO與scoped read repository。

## 2026-07-22 — Complete P3-004 appointment views and merchant calendar

### Read API、authorization與privacy

- 完成consumer與merchant各自的list/detail四個read endpoints、strict shared contracts、versioned opaque cursor及scoped repository。Consumer owner一律由authenticated principal推導；merchant先驗ACTIVE membership，OWNER/MANAGER/VIEWER可讀全店，STAFF只能以同tenant唯一ACTIVE StaffProfile讀自己的預約。
- Consumer upcoming/past使用database `asOf`固定跨頁邊界，merchant calendar限制canonical UTC半開window、最多31天並把tenant、日期、人員、狀態全部綁進cursor。所有tenant query最外層含`tenantId`，consumer query含`consumerUserId`；controller不直接存取Prisma。
- Consumer detail只向owner揭露appointment snapshot中的完整地址與policy；merchant只取得current consumer display name及營運必要snapshot，不回consumer ID、contact、LINE identity、完整地址、policy、notes或raw actor ID。四個response均為`Cache-Control: private, no-store`，read path不寫PII audit或保存cursor內容。

### Web、文件與互動修正

- 新增`/appointments`顧客預約頁與`/studio/appointments`店家RWD agenda。LOCAL PREVIEW明示不讀真實資料；configured mode支援loading、empty、error、retry、upcoming/past、前後週、today、人員／狀態filter、detail與pagination。`/v1/me` membership同步回tenant usage timezone，七日window依tenant local calendar boundary換算UTC。
- OpenAPI、appointment views data dictionary、security與design contract、task及Phase 3交接文件同步完成。Doc-coauthoring fresh reader第一輪找出十項blocking ambiguity，修正exact DTO、snapshot來源、STAFF detail隱私、cursor canonicalization與timezone後，第二輪確認可實作。
- Browser實測時發現preview每筆Yun預約用了不同staff ID，導致「Yun＋已報到」錯誤空集合；改為穩定preview staff identity並新增unit regression。Desktop 1280寬與mobile 390×844均無水平溢位，日期、人員、狀態、detail及週切換實際操作通過，最終console warning/error為0。

### Migration與verification evidence

- 第16個migration只新增consumer／tenant／tenant+staff三個有界appointment查詢index。既有`nook` database辨識16個migrations且no pending；一次性`nook_p3_004_replay`由空資料庫完整套用16個migrations，第二次deploy no pending，驗證後已刪除。
- Workspace unit suites全綠：Web 14 files／47 tests、API 10／53、worker 3／9、contracts 11／37、database unit 11／24、domain 2／10、config 1／25、line 1／5、observability 1／4；auth/payments/ui沒有test files。完整database integration 7 files／45 tests、API integration 7 files／48 tests全綠。
- 12個workspace strict typechecks、直接ESLint、11個TypeScript production builds、Web Next production build（15 routes）、repository architecture 17/17、Prisma validate、Prettier、OpenAPI YAML parse及`git diff --check`通過。Live smoke為Web health/readiness、API health/readiness與worker health/readiness六個端點皆HTTP 200。
- 驗收初次用root Vitest忽略workspace cwd且sandbox禁止CORS listener，改為逐workspace並允許loopback後通過；Prisma integration wrapper因不存在預期shim而失敗，改用lockfile內既有Prisma 6.19.0入口後原suite通過。API integration首次因`/v1/me`新增`tenantTimezone`但舊exact assertion未更新而失敗，修正contract expectation後完整48/48。這些失敗沒有被計為成功。
- `pnpm`本輪在受限環境嘗試寫`~/.cache/node/corepack`而無法作為最終入口；未繞過packageManager policy或修改lockfile，改用同一frozen install的直接工具入口取得明確exit code。Node為v24.18.0、Homebrew pnpm為11.15.1，符合repository engines。
- P3-004標為`done`只代表repository/local acceptance。真實LINE/Firebase consumer、真實STAFF帳號綁定與owner對顧客display name隱私文字的核准仍未完成；沒有commit、push、GCP apply/deploy或更新`main`。

## 2026-07-22 — Start P3-005 appointment lifecycle

- 建立P3-005取消、報到、完成、未到店與改期task並標為`in_progress`。所有write都要求state machine、database clock、scoped authorization、idempotency、history、safe audit及ID-only outbox；取消/no-show/reschedule同transaction釋放occupancy，check-in/complete保留實際占用證據。
- 商業盤點確認現有取消政策只有自由文字，不能可靠執行「依規則取消」。本slice在BookingPolicy新增consumer cancel/reschedule lead minutes並於hold/appointment保存snapshot；預設24小時、0至30天，既有資料保守backfill 24小時。自由文字只供閱讀，不用parser推導費用或期限。
- Consumer改期先建立同tenant/location/service target hold，再以單一transaction保留舊RESCHEDULED row、建立replacement、轉移target occupancy並釋放舊occupancy。Replacement保留root source與usage，避免洗掉MARKETPLACE attribution或用A→B→C繞過月預約額度。
- 店家OWNER/MANAGER可處理全店，STAFF只處理唯一ACTIVE profile所屬預約，VIEWER保持read-only。完成狀態不直接產生8%媒合費或invoice；退款、金流、LINE delivery、CRM自由文字及settlement都維持後續task邊界。
- 依doc-coauthoring skill進入fresh-reader testing；reader確認授權、狀態、deadline、鎖序、replay、quota與privacy沒有blocking ambiguity後才建立第17個migration與程式碼。

### P3-005 reader contract refinement

- 三組fresh reader分輪檢查actor/time/error、reschedule concurrency、quota/attribution、policy rollout、schema與Web contract。第一輪找出lead=0 boundary、natural replay落key、self-link tenant/consumer約束、policy hash未含結構化期限、source不足以認列媒合費及lock/outbox不唯一等blocker。
- 規格升為v2 canonical policy hash並保留v1 reader；新增mixed-version兩階段capability、DB default相容舊writer、policy revision CAS、current authorization before replay、stable expiry maintenance、exact ProblemDetails codes及六種transition fingerprint。Production必須v2 writer exclusive後才開policy writes，再等v1 hold drain才開lifecycle。
- 改期chain新增direct predecessor與root composite self-links、controlled global reason enum、exact transition key model、source deadline-before-target error order、natural replay完整business input equivalence及buffer-aware occupancy CAS。月額度只計root，target hold source不可洗掉chain來源；`MARKETPLACE` source在verified attribution ledger上線前一律UNVERIFIED、不得收8%。
- Web/read contract補consumer reschedule context與server-evaluated actions、merchant exact action timestamps、memory-only idempotency retry lifecycle及disabled capability行為。最後三位reader逐項回歸後一致確認「規格可實作、無blocker」，才進入第17個migration。
- Documentation-lookup要求Context7但本環境未提供；改以Prisma 6官方self-relation、compound unique與Serializable/P2034 retry文件核對具名self relations、composite keys及bounded transaction retry，不新增dependency。

### P3-005 implementation checkpoint: expand、policy與simple transitions

- 使用者本機已符合Node `v24.18.0`與pnpm `11.7.0`；先前只有Web可用的直接原因是舊啟動流程沒有把根目錄`.env`載入migration/API/worker。確認PostgreSQL container healthy後，以目前`pnpm db:migrate`環境載入器成功套用第17個`20260722100000_appointment_lifecycle` migration；Web/API/worker的health與readiness六個端點隨後全部HTTP 200。全程只列出env key，未輸出或保存值。
- Expand schema已加入BookingPolicy revision與兩個consumer lead、hold/appointment lead snapshots、controlled reason enum、direct/root reschedule composite self-links與transition idempotency table；Prisma format/validate/generate及migration contract 4/4通過。Migration已套本機既有database，但fresh replay仍待最終驗收。
- Hold writer依`BOOKING_POLICY_V2_WRITES_ENABLED`在rollout期間明確產生v1或v2；v1固定1440 snapshot，v2從current BookingPolicy取值並使用同一組in-memory snapshot計算canonical hash。Fixed v1/v2 vectors通過，confirmation同時接受v1/v2並複製lead snapshot，月額度predicate新增`rescheduledFromId IS NULL`以只計chain root。
- Shared contract新增strict lifecycle reason/body/idempotency、BookingPolicy GET/PUT、policy deadline presentation及browser capabilities；lead=0回`inclusive=false`，正lead deadline inclusive。Consumer/merchant detail開始以database evaluatedAt呈現server-authoritative actions與controlled history reason，不由browser clock放寬。
- 完成BookingPolicy scoped repository與API：ACTIVE member可GET，OWNER/MANAGER且tenant ACTIVE可在v2 writes flag開啟時PUT；完整strict body、revision CAS、private/no-store與revision-only audit已接線。完成consumer cancel及merchant cancel/check-in/complete/no-show的Serializable transaction repository與API骨架：current authorization、actor/key advisory lock、scoped appointment row lock、same-key replay、domain state machine/timing、occupancy validation/CAS、history、safe audit、ID-only outbox與bounded P2034 retry均已實作。
- 本checkpoint驗證：domain 3 files/14 tests、lifecycle/appointment/browser contracts 10 tests、migration/hash 6 tests、browser runtime 2 tests通過；contracts、database、API與worker strict typecheck通過，config/contracts/database packages已重建。曾使用錯誤的v2預期hash導致1 test失敗，依task內已reader核准的canonical vector修正後原測試通過；Web runtime test曾讀到尚未重建的config dist而得到undefined capabilities，重建workspace package後原測試2/2通過，兩次失敗都未算成功。
- 尚未完成且不得交接為done：consumer原子reschedule/natural replay、simple transition database integration與API contract tests、BookingPolicy integration、OpenAPI、`/studio/policies`、consumer/merchant mutation UI、完整migration replay/full workspace/browser驗收。P3-005維持`in_progress`；本輪未commit、push、部署或更新`main`。
- Checkpoint後補上BookingPolicy與lifecycle application ordering tests共10/10通過；consumer disabled capability確定先於resource/key/body validation，merchant則先完成route tenant authorization再回disabled 503。首次merchant spy assertion發現service把整個input object傳入authorization method；雖repository只讀兩欄，仍改成exact `{actorUserId,tenantId}` allowlist，原測試重跑通過。Prettier批次曾把`.env.example`一併傳入而回報無parser，其他列出的程式與文件仍完成format；之後對實際程式檔分開執行成功，未把該次命令視為完整format gate。

### P3-005 atomic reschedule、integration與RWD操作 checkpoint

- Consumer reschedule repository完成Serializable原子交易：current authorization、same-key/natural replay、source deadline、target hold/policy/tenant/location/service驗證、ordered occupancy lock、source RESCHEDULED、replacement建立、舊occupancy釋放、target occupancy轉移與hold CONSUMED均在同一transaction。A→B→C保留root source/usage，natural replay只新增目前transition key並沿用原occurredAt，不重寫history/audit/outbox。
- Lifecycle database integration 4/4通過，涵蓋A→B→C、same-key與natural replay、target mismatch rollback、stable expiry maintenance、consumer cancel與merchant timing/role/occupancy；BookingPolicy integration 2/2通過member read、OWNER revision CAS、單一audit、stale conflict與VIEWER禁止寫入。API lifecycle application 4/4與既有policy/view application 10/10通過。
- 第一次lifecycle integration全數失敗揭露既有`appointments_policy_check`仍只允許v1，會拒絕由v2 hold建立replacement；未改寫已套用migration，新增forward-only第18個`20260723010000_appointment_policy_v2_constraint` migration允許v1/v2並加migration unit，成功套用本機資料庫。後續一次fixture的`expiresAt < createdAt`及一次把`staffId`放錯confirmation input都由DB/typecheck抓出並修正；最終合併integration 6/6。
- OpenAPI已同步v1/v2 policy presentation、deadline/lead欄位、reason code、consumer/merchant lifecycle DTO、reschedule context、BookingPolicy GET/PUT及六個transition route；Ruby YAML parse與`git diff --check`通過。Node嘗試使用workspace `yaml`套件的不存在`parse` export失敗，改用實際可用的Ruby parser取得明確成功結果，未把前者計為通過。
- Web新增顧客取消操作：顯示接受的政策、server deadline、controlled reason、確認、loading、成功/錯誤並使用memory-only UUID idempotency key；改期入口只在server回傳RESCHEDULE與slug-based context時出現，導向同一公開availability/hold入口，完整replacement確認仍待下一checkpoint接線。
- 店家預約明細新增server `allowedActions`驅動的取消、報到、完成與未到店；每次操作有確認、loading、成功及失敗後refresh，LOCAL PREVIEW只改React memory並明示不寫真實資料。新增`/studio/policies`結構化規則頁、revision CAS、0語意、30天lead上限與role/capability read-only狀態；Studio runtime context現在暴露兩個安全boolean capability，不持久化mutation資料。
- 本次Web變更已通過strict typecheck、ESLint、Prettier與14 files／48 tests；尚未完成改期target hold→差異確認→reschedule mutation、fresh migration replay、full workspace/build/architecture、desktop/mobile browser與live smoke，因此P3-005保持`in_progress`。沒有commit、push、外部provider呼叫、Terraform apply/deploy或更新`main`。

## 2026-07-23 — Complete P3-005 appointment lifecycle

### Consumer、merchant與policy RWD操作

- 顧客`/appointments`完成server action驅動的取消與改期。取消顯示成立時政策、server deadline與controlled reason；configured mode送出private/no-store lifecycle API，LOCAL PREVIEW只更新React memory。Idempotency key只存在memory，network／401 refresh／503可重用，2xx、4xx、欄位變更、切換detail或卸載都清除。
- 公開預約頁完成完整改期：依server提供的slug/service/location context查availability、建立target hold、比較新舊時間／staff／價格／policy、要求未預勾的政策確認後呼叫atomic reschedule endpoint。成功文案明示舊預約保留為歷史，也不宣稱LINE通知已送達。
- 店家`/studio/appointments`依server `allowedActions`執行取消、報到、完成、未到店；`/studio/policies`提供revision CAS設定、0代表開始前皆可自助及30天上限。VIEWER與disabled capability保持只讀，409後refresh，不由browser clock放寬。
- Browser desktop與390×844實測顧客取消、完整改期、店家未到店與policy更新；各頁document client/scroll width相等、fixed CTA未超出viewport、console warning/error為0。Web live smoke的`/`、health、readiness、顧客預約、店家行事曆、policy與改期preview全部HTTP 200；依使用者提供的現況只驗收Web常駐服務，不把未啟動的API／worker誤列為失敗。

### Transaction、migration與HTTP contract修正

- Atomic reschedule保留A→B→C舊row、root source/usage與target snapshots，轉移target occupancy、釋放source occupancy並consume hold；same-key與natural replay不重寫history/audit/outbox。Cancel/no-show只釋放唯一正確occupancy，check-in/complete保留ACTIVE占用證據。
- 完整database integration首次在跨consumer併發暴露PostgreSQL `40P01`被Prisma包成unknown error；bounded transaction retry新增只接受exact `40P01`／`40001`訊息，focused concurrency連續通過，完整database integration最終9 files／51 tests通過。
- 第18個forward-only migration放寬既有appointment policy check以兼容v1/v2。既有database辨識18個migrations且no pending；一次性`nook_p3_005_replay`由空資料庫套用全部18個migrations、第二次no pending，驗證後刪除。第一次用帶`?schema`的Prisma URL直接交給psql不相容，移除query後才成功建立replay database；前次失敗未計入驗收。
- 新增lifecycle／BookingPolicy exact application operation log，只含`requestId, operation, outcome, httpStatus`與授權後安全ID，不含raw key/hash/fingerprint/body、hold、consumer、政策、地址、姓名或stack。Pure allowlist test與service unit驗證success/replayed/rejected/unavailable；DB audit與ID-only outbox仍只在首次成功transaction寫入。
- 新增真實HTTP E2E後發現Nest `@Post`預設回201，與OpenAPI及transition contract的200不一致；三個lifecycle route明確加`@HttpCode(200)`。Consumer owner取消／foreign 404／same-key replay、merchant VIEWER 403／OWNER取消／單一audit，以及BookingPolicy member GET／VIEWER 403／OWNER revision CAS／stale 409皆通過；focused 10/10，完整API integration最終7 files／50 tests。

### Final verification與交接邊界

- Workspace完整unit test為19/19 Turbo tasks；Web 14 files／49 tests、API 12／60、worker 3／9、contracts 12／42、database unit 13／30、domain 3／14、config 1／26、line 1／5、observability 1／6全綠。完整integration為database 51與API 50 tests。
- 12-package lint、strict typecheck、production build、Next 16 routes、architecture 17/17、Prettier、OpenAPI Ruby YAML parse與`git diff --check`通過。Homebrew pnpm 11.15.1符合engines `>=11.7.0`，但專案精確`packageManager`為11.7.0且受限環境無法連registry驗證下載；以`pm-on-fail=warn`搭配Turbo loose env沿用已安裝版本，保留版本差異警告，未修改lockfile或使用未驗證下載。
- P3-005標為`done`只代表repository/local acceptance。預設24小時政策owner確認、真實LINE/Firebase consumer、真實OWNER/VIEWER/STAFF staging矩陣、P3-006 reminder／LINE delivery及production mixed-version啟用順序仍列在external gates；下一個slice為P3-006。
- 本輪沒有commit、push、PR、GCP/Terraform apply、外部provider呼叫或更新`main`，也沒有輸出、寫入或持久化credential/token。

## 2026-07-23 — Start P3-006 reminders and LINE notifications

- 建立P3-006垂直任務並標為`in_progress`。目標是把既有appointment outbox投影成database-backed reminder jobs，透過deterministic Cloud Tasks與provider retry key安全送出，取消／改期後舊提醒必須即使已enqueue也不再呼叫provider。
- 商業規則不以plan name分支：新增`APPOINTMENT_REMINDER_COUNT` entitlement，repository-local範圍只接受0..2；平台LINE OA另設月度hard allocation cap，交易結果通知不占reminder權益但仍消耗OA成本。LINE HTTP 200只記ACCEPTED，不宣稱裝置已收到。
- Documentation-lookup指定Context7但本環境未掛載，改以LINE Developers官方文件核對：同provider的LINE Login與Messaging channel才共享user ID；push只對OA friend／近期互動者可達且blocked user可能仍回200；所有retry應從第一次就固定`X-Line-Retry-Key`；MINI App service message只供user action確認／提醒、需verified MINI App與notification token且單次action最多5則。
- 第一版選平台OA交易型LINE Push；只有已驗簽follow webhook標記FOLLOWING且與local LINE identity exact match才送。MINI App service message保留adapter邊界，但在template review、notification-token加密保管與rotation完成前不得啟用；行銷、店家自有OA與Email fallback不偷渡進本slice。
- 補齊ADR 0014、notification data dictionary、LINE notification security contract、delivery design與dispatch runbook。文件把database jobs、outbox projection、deterministic Cloud Task、current-truth delivery guard、fixed retry key、30天webhook retention、月度hard cap、safe template與staging activation/rollback整合成同一交接契約。
- ADR明確核准worker新增官方`@google-cloud/tasks`client，LINE provider則使用platform fetch，不額外引入SDK；並把原計畫模糊的`delivered`收斂為可證明的`ACCEPTED`。文件存在與`git diff --check`已通過，尚待fresh reader ambiguity/security/commercial review後才開始migration與程式實作。
- 第一輪fresh reader找出9項blocker：projector batch transaction無唯一算法、delivery retry/lease不完整、retry與「no duplicate call」互斥、max-age/current-truth/template未定、webhook亂序/retention缺路徑及dedupe格式矛盾。規格因此固定per-event `SKIP LOCKED LIMIT 1` transaction、event-time dueAt、template eligibility/max-age、canonical繁中body、per-event webhook/CAS/cleanup、per-service secret與exact dedupe shape。
- 第二輪reader再找出queue invocation與provider attempt計數、result projection-time aging、recipient linearization、同timestamp follow/unfollow及cancellation replay五個blocker。修正為dedicated notification queue、database 10次STARTED/AMBIGUOUS outbound evidence、dispatcher max-age sweep、outbox createdAt result dueAt、job→appointment→User→identity→recipient→budget固定lock order、同timestamp unfollow wins及取消時排除自己的result dedupe key。
- 以Google Cloud Tasks官方REST/Terraform文件核對retry semantics：task只有`maxAttempts`與`maxRetryDuration`兩條件都達成才停止，`-1`配positive duration不適合作為明確24h bound；因此規格改為100 attempts／86400s，provider calls仍由database硬限制10次。尚待第三輪reader確認無blocker；目前仍未建立migration或執行外部provider。
- 第三輪reader發現max-age sweep可能與in-flight provider result競爭，以及第10筆STARTED crash後無終止規則；規格補成unexpired DELIVERING不掃、expired STARTED以row lock/expected-state CAS轉AMBIGUOUS，#10直接DEAD_LETTER且不建#11。Template validation也移到budget/STARTED前，invalid job不消耗成本或attempt。
- 第四輪fresh reader逐項核對task、ADR、data dictionary、security、design與runbook後確認「規格可實作、無blocker」。文件已完成Prettier；下一checkpoint才開始第19個expand migration與資料層實作，至此仍沒有外部LINE/GCP呼叫或secret。

### P3-006 implementation checkpoint: schema、webhook、projector與delivery skeleton

- 新增第19個notification expand migration與Prisma models：jobs、attempt evidence、LINE recipient、raw webhook event、platform monthly usage，以及`APPOINTMENT_REMINDER_COUNT` generic entitlement。Migration contract、Prisma format/validate/generate、database unit 14 files／34 tests與當時database strict typecheck已通過；本機migration apply因Codex sandbox禁止OrbStack socket而未執行，不能把schema宣稱為已套用。
- `@nook/line`新增五個canonical繁中template、raw webhook HMAC/envelope parser與LINE Push client。固定deep link、timezone、控制字元／1000字限制、同timestamp unfollow勝出、200/409 accepted/replayed、retryable/terminal分類及禁止redirect皆有unit evidence；4 files／31 tests、strict typecheck與ESLint在相依安裝中斷前通過。
- Runtime config完成API/worker secret隔離與fail-closed validation；disabled與line_push modes共28 tests、typecheck及lint通過。API新增256KiB raw body、signature-before-parse webhook、per-event idempotent repository、recipient monotonic observation與identity linking；focused webhook application 5/5、API strict typecheck/lint通過。完整API suite曾因sandbox禁止測試listen而出現CORS `EPERM`，不列為產品失敗或成功。
- Database新增outbox projector：六種appointment event、`FOR UPDATE SKIP LOCKED LIMIT 1`、event-time result dueAt、24h/2h提醒、effective generic entitlement、exact dedupe、past reminder suppression、reschedule chain與replay-safe cancellation。Corruption會回滾projection savepoint再把event標FAILED；transient database error仍整筆rollback並保留PENDING。
- Dispatcher新增兩分鐘claim lease、deterministic Cloud Tasks enqueue/AlreadyExists、exact lease CAS、每phase 100筆與30天webhook cleanup。Max-age sweep只處理PENDING/ENQUEUED/expired lease；expired DELIVERING保留AMBIGUOUS attempt並DEAD_LETTER，不把可能已外呼的工作誤標SKIPPED。Disabled mode仍project/sweep但不enqueue。
- Delivery repository與private worker route完成job row linearization、expired STARTED→AMBIGUOUS、10次outbound上限、appointment current-truth、User→LINE identity→FOLLOWING recipient、Asia/Taipei月度budget原子reservation、template-before-budget、固定retry key與provider result CAS。Task body只含`jobId`，exact queue header是defense in depth；accepted/replayed只記provider accepted，不宣稱device delivered。
- Terraform新增獨立notification queue（100 attempts／86400s）、兩個Secret Manager containers但不建立versions、API/worker最小secret references、runtime config、Scheduler exact header與activation flags；`enable_line_notifications=false`及`enable_notification_dispatcher=false`維持預設。Terraform fmt已通過；validate/init因sandbox無法解析`registry.terraform.io`且provider plugin無法在受限程序啟動，未列為通過，也沒有apply/deploy。
- OpenAPI已加入public LINE webhook與兩個private worker contracts。Worker service/unit、delivery repository integration、完整workspace lint/typecheck/test/build、OpenAPI parse與migration fresh replay仍待驗證；原因是離線`pnpm install`仍會執行supply-chain registry metadata檢查，網路升權又被Codex用量額度系統拒絕。已中止retry，沒有繞過限制或把不完整`node_modules`當成成功。使用者本機下一步需執行`pnpm install --frozen-lockfile`恢復工具鏈後再補齊驗收。
- 本checkpoint沒有commit、push、PR、GCP/Terraform apply、LINE provider呼叫或更新`main`，也沒有輸出、寫入或持久化token/secret。P3-006維持`in_progress`，外部LINE provider/OA、真實secret、staging follow/retry/quota與owner monthly cap核准仍是activation gates。

## 2026-07-23 — Product delivery／commercial roadmap and P3-007 handoff

- 依持續目標新增`docs/product/product-delivery-roadmap.md`，把平台OA入口、平台OA交易通知、店家自有OA拆成三條不同provider/recipient/consent/cost/fallback泳道。平台入口是所有方案的低成本RWD entry；P3-006平台Push受0..2 reminder entitlement與monthly cap；店家自有OA維持Phase 6的NT$299 automation加購且provider訊息費由店家負擔。
- 新增blocked `P3-007 Merchant LINE entry & RWD operations` task，明確依賴P3-006 local acceptance。Task只做rich menu/LIFF→authenticated RWD，不做自由文字bot/postback mutation；補六個route enum、OWNER/MANAGER/VIEWER/STAFF deterministic matrix、multi-membership untrusted tenant selection、revocation recovery與server authorization不變式。
- 使用documentation-lookup skill時本環境仍無Context7 connector，改查LINE Developers官方LIFF API、developing/opening文件。Contract固定LIFF browser先init且不呼叫login；external browser為init→`liff.login`→redirect→second init；route與analytics必須等init完成，不能修改`liff.*`或讓primary redirect credential進log。
- Doc-coauthoring reader第一輪發現三條LINE能力混寫、定金/automation可能重複收費、coming-soon提前售賣、multi-staff/Phase 6矛盾、媒合shadow與settlement、ARPU只用月繳牌價、會計basis、billing/legal/production gate，以及P3-007角色/tenant/auth sequence缺口。文件逐項修正：專業/工作室bundle定金、個人版NT$99加購、LINE automation單一P6 owner；未有acceptance evidence一律coming-soon。
- Phase 5重排為production/payment foundation與法遵先行，之後才subscription/billing operations/entitlement；媒合先shadow、settlement/dispute通過才可真實收8%；定金代收記負債而非平台收入。新增billing portal、dunning、proration、refund/chargeback、daily reconciliation、電子發票、DSAR、merchant ops與production Beta activation tasks。
- 商業計畫的1,000店試算改為明示「全月繳上行情境」ARPU NT$704；相同方案mix全採年繳月均約NT$568，founder cohort會更低，正式forecast必須分monthly/annual/founder/add-on attach rate。Phase 6殘留的媒合費結算移回Phase 5，`多員工與多據點`修正為後續`進階員工權限與多據點`。
- External gate register現在有accountable role、明示未提供狀態、TBD期限與evidence欄；沒有owner/evidence不能activation。這是責任追蹤，不把尚未提供的LINE/GCP/payment/legal/Beta帳號或決策冒充完成。
- 在node_modules仍未恢復下完成不依賴workspace dependencies的驗證：global TypeScript parser掃144個API/worker/config/database/LINE source/test檔為0 syntax errors；repository/CI/deployment/local-dev Node contract 17/17、四個architecture scripts、Terraform fmt、OpenAPI Ruby YAML parse與`git diff --check`通過。這些是static evidence，不取代P3-006尚待的strict typecheck/unit/integration/build/migration replay。
- 相依工具狀態仍為Node 24.18.0、fallback pnpm 11.9.0，但`node_modules/.bin/tsc`與`vitest`缺失；本輪沒有再次繞過或冒充安裝完成。P3-006保持`in_progress`，P3-007保持`blocked`；沒有commit、push、PR、deploy、provider call或secret操作。

### Product roadmap final reader gate

- 最終fresh reader逐項回歸三條LINE能力、catalog sellability、定金與automation收費、multi-staff/multi-location邊界、媒合shadow→settlement、ARPU情境、會計basis及external gate責任，結論為PASS，沒有剩餘文件矛盾或會阻塞實作的歧義。
- P3-007的LIFF init/login/second-init、canonical routes、角色fallback、ACTIVE membership選擇/撤銷及untrusted tenant/route邊界亦通過交接審閱。尚未提供或核准的LINE帳號、secret、rich menu與staging device evidence維持明示external activation gate，不能視為已完成。
- 審閱後重新執行`git diff --check`與Terraform recursive fmt check均通過。OpenAPI第一次檢查誤用不存在的`docs/openapi/openapi.yaml`舊路徑而失敗，不列為驗收結果；改以repository實際的`docs/api/openapi.yaml`重跑。

### Local startup diagnosis follow-up

- 使用者回報只有Web與Web health可用後，確認預期API/worker health分別為`localhost:8080/health`與`localhost:8081/health`。Codex沙箱看不到host localhost且不能連OrbStack socket，因此不以沙箱curl/Docker結果否定使用者已確認的Web狀態。
- Root `.env`比目前`.env.example`少新功能key，但notification/media/web auth均有安全disabled/default路徑；只憑key差異不能判定API/worker啟動失敗。可確認的本機blocker是`node_modules/.bin/tsc`、`turbo`、`vitest`全部缺失，且pnpm版本查詢在5秒內無法完成，表示依賴工具鏈仍未完整恢復。
- 新增dependency-independent `node infra/dev/doctor.mjs`與`pnpm run doctor`入口，只顯示Node/pnpm版本、`.env`與`DATABASE_URL` key存在性、必要tool binary、Docker及Web/API/worker health狀態，不輸出任何env value。明確保留`run`以避免誤執行pnpm內建同名命令；尚未啟動或沙箱不可見的外部狀態只列WARN，版本、env與依賴缺失才列FAIL。
- Doctor/check-local-dev/run-with-env focused 11 tests全數通過；納入完整dependency-independent architecture suite後為22/22，五個repository/workflow/deployment/CI/local-dev contract scripts亦全數通過。正確路徑OpenAPI YAML parse、Terraform recursive fmt與`git diff --check`通過。Doctor本次如預期exit 1並列出pnpm/三個tool缺失；這是有效診斷，不是完整workspace驗收。P3-006仍維持`in_progress`。

### P3-006 static implementation review and integration evidence expansion

- 工具鏈重新診斷仍為Node 24.18.0可用，但pnpm在5秒內無法回傳、root `tsc/turbo/vitest` symlink缺失；Codex沒有再次下載、升權或手動重建symlink。依賴與database runtime尚未恢復，因此本checkpoint新增的Vitest/Prisma integration不得宣稱已執行通過。
- 新增notification repository integration suite，預定覆蓋confirmed/cancelled stable projection、future/corrupt outbox、dedupe race、dispatch claim/reclaim/expiry、current-truth、blocked/inactive recipient、fixed retry key、STARTED/AMBIGUOUS、第10次終止及跨connection monthly cap。新增LINE webhook repository integration suite，覆蓋event replay、same-timestamp unfollow優先、unknown IGNORED/30天清理及cross-user mismatch rollback。
- Static review找到projector TOCTOU：pre-read後`createMany(skipDuplicates)`輸掉concurrent unique race時原本直接回count 0並PUBLISH event，沒有驗證winner shape。現在loser會重讀dedupe winner並用tenant/consumer/appointment/channel/template/dueAt同一exact validator；不一致走savepoint rollback並把event標FAILED。雙PrismaClient race test要求恰好一個PUBLISHED、一個FAILED、只留一個job。
- 進一步確認`SKIP LOCKED`可能讓同appointment的later lifecycle event與earlier confirmation event同時投影，造成cancel job state被較早event反向建立。Claim SQL新增same-aggregate earlier-due `NOT EXISTS` barrier：不同appointment仍可平行，同appointment固定依`availableAt,id`逐筆處理；dedupe loser的post-insert revalidation仍保留作defense in depth。
- LINE webhook parser原本接受`Number.MAX_SAFE_INTEGER` timestamp，但它無法轉成有效JavaScript Date，會延後到repository/Prisma才500。現在parser要求非負safe integer且`new Date(timestamp)`有效，invalid envelope固定在write前回400；補unit regression與security contract。
- API/worker controller原本有部分直接重讀raw `x-request-id`，worker middleware又沒有把已驗證值掛進request，可能讓任意header內容進operation log。新增worker request context/safeRequestId，middleware保存bounded ID；notification、media、booking-hold worker controller及API LINE webhook一律只取middleware-owned ID，並補合法／惡意／過長ID與missing middleware unit contract。
- 目前可執行證據：global TypeScript parser掃API/worker/LINE/database test相關127 files為0 syntax errors；dependency-independent architecture 22/22、`git diff --check`通過。這不是strict semantic typecheck、Vitest、Prisma integration、migration replay或build替代品；P3-006保持`in_progress`。
- Pnpm進一步定位為Homebrew 11.15.1在repository外正常，但進入專案後依legacy `packageManager`預設自動下載11.7.0而卡住。依pnpm 11.15 bundled changelog採workspace `pmOnFail: warn`：本機符合`engines >=11.7.0`的11.15.1立即可執行且保留warning，CI仍由workflow明確安裝11.7.0。Doctor現已把pnpm改判PASS；只有root `tsc/turbo/vitest`仍FAIL。Local-dev contract新增負向test防止移除該設定。
- Terraform security review發現LINE secret env reference雖受activation flag控制，但secretAccessor IAM原本常駐；notification disabled時compromised runtime仍可能讀日後建立的secret version。IAM改為database bindings常駐、LINE API/worker bindings只在`enable_line_notifications=true`建立，並加default absence／activated service-specific binding assertions；Secret Manager仍只建containers、不建versions。
- Terraform release contract checker原本只接受較弱的`dispatcher -> deploy_runtime`條件，會把目前更嚴格的`dispatcher -> deploy_runtime && LINE activation`誤判失敗。Checker改為驗證完整不變式，並新增移除LINE activation的負向回歸；release contract 4/4、repository/CI/deployment/local-dev contracts合計27/27、Terraform recursive fmt及`git diff --check`通過。
- 重新嘗試mock-provider `terraform test`仍在建立既有Google provider process時失敗，錯誤是plugin handshake沒有任何stdout；因此結果為0 tests executed，不列為通過或產品測試失敗，也沒有重新下載provider或執行apply。OpenAPI第一次使用本機Psych不支援的`safe_load_file` API而失敗，改以同一安全parser讀取檔案後成功；前一次命令不列為通過。
- 本checkpoint全域TypeScript parser掃描`apps/`與`packages/`共269個TS/TSX檔為0 syntax errors，OpenAPI YAML、五個repository/workflow/deployment/local-dev static contract及Terraform release ownership均通過。Doctor仍只因workspace `node_modules/.bin/tsc`、`turbo`、`vitest`缺失而FAIL；Codex沙箱看不到host Docker與localhost，使用者已確認的Web/health可用狀態不被推翻。Strict typecheck、Vitest/Prisma integration、fresh migration replay、完整build及Terraform mock-provider tests仍待`pnpm install --frozen-lockfile`與可執行provider環境，P3-006保持`in_progress`。
- API/OpenAPI/worker/Terraform逐項contract review發現`NOTIFICATION_WORKER_URL`只在Terraform驗證，shared runtime config僅要求非空；非Terraform部署可帶path/query/credential或production HTTP，造成Cloud Task target與OIDC audience drift。Config新增exact-origin fail-closed：staging/production只允許HTTPS，development/test只額外允許localhost/127.0.0.1 HTTP；補四組production負向與local正向test，並同步task/security/design契約。由於Vitest缺失，本輪只取得focused TypeScript syntax與`git diff --check`證據，新增tests不得宣稱已執行通過。
- Terraform IAM對照發現notification task由worker建立，但automation invoker的serviceAccountUser原本只授API，staging會因worker缺`iam.serviceAccounts.actAs`而無法建立OIDC task；同時API/worker都有project-wide Cloud Tasks enqueuer。改為feature activation-scoped actAs，media啟用時僅API可enqueue default/media queue，LINE notification啟用時僅worker可enqueue dedicated notification queue；disabled時三者皆不存在。依Google/HashiCorp官方queue IAM與actAs contract更新ADR/security/runbook/task及Terraform assertions；dependency-independent release contract新增負向回歸並為5/5通過，Terraform fmt與`git diff --check`通過。Mock-provider plan仍因既有provider process限制未執行，不將新增HCL assertions宣稱為已通過。
- P3-006原本只在文件要求backlog/dead-letter/budget metrics，runtime沒有安全資料來源。Dispatch repository新增單一database-clock operational snapshot：最舊due appointment outbox、最舊active due job、dead-letter總數、24小時retryable/accepted attempts與Asia/Taipei當月LINE reserved count；worker加入approved cap與basis-points utilization，disabled時為null。Private response/log與OpenAPI只暴露平台級age/count，不含tenant/job/appointment/user/recipient/template/provider request或message；補service unit與Prisma integration shape/count evidence。因workspace Vitest/Prisma toolchain仍缺失，新增tests只完成TypeScript syntax/OpenAPI parse，不能宣稱語意或database執行通過。

### Incremental commit checkpoint

- 依使用者要求停止把累積dirty worktree視為單一commit，先整理10筆小型checkpoint；最大檔案數31，沒有任何一筆接近全部300+檔案。順序為shared contracts/domain、schema/migrations、runtime dependencies、database repositories、Phase 2 database evidence、Phase 3 database evidence、P3-006 notification database evidence、LINE adapters、runtime config及observability allowlists。
- 新commit依序為`ee11978`、`9f3e7fb`、`4af57d6`、`9af3856`、`58ac103`、`dd1d4b2`、`cd8a410`、`b31a98b`、`ad2a32a`、`f7cef37`。每筆commit前均檢查staged stat、`git diff --cached --check`與常見credential pattern；config測試只命中明示`synthetic-*` fixture，沒有提交`.env`、credential、token或secret。
- 這是checkpoint整理，不改變P3-006尚待完整semantic verification的狀態。API、Web、worker、Terraform、CI/local-dev及大部分文件仍留在working tree，後續必須繼續按surface/infrastructure/docs分批commit；本輪沒有push、PR、deploy或更新`main`。

### Incremental commit completion

- 延續同一整理原則，在本工作報告提交前再建立48筆scope-specific commit，從`92ccfa8`到`c61a905`；連同上一段共58筆已完成的功能／文件checkpoint commit，本工作報告另以單獨commit留存。沒有把300多個檔案一次提交，後續最大一筆仍低於原先31檔上限。
- API拆為access control、店務營運、預約生命週期、LINE webhook、module wiring、HTTP與application tests；worker拆為request context、媒體驗證、hold expiry、通知派送與module wiring；Web拆為共用視覺、行銷首頁、browser session、五個店務工作台、公開預約入口與預約檢視。
- Terraform拆為platform module與三環境接線；CI拆為format gate、application readiness與release ownership；local development工具另成一筆。文件依OpenAPI、三組ADR、兩組data dictionary、兩組security、runbook、ops、兩組design、delivery plan、Phase 1 evidence及P1/P2/P3/MKT tasks分開提交。
- 每筆commit前均執行`git diff --cached --check`與常見credential pattern掃描；命中內容只有synthetic fixture、欄位名稱、公開browser identifier範例或安全文件中的secret名稱，沒有提交`.env`、credential、token或secret value。Terraform module與三環境通過`terraform fmt -check`；OpenAPI通過Ruby YAML AST parse。
- Dependency-independent驗證通過：CI quality 3 tests、deployment readiness 3 tests、Terraform release ownership 5 tests、local development 12 tests，對應contract command亦全部通過。完整strict typecheck、Vitest/Prisma integration、fresh migration replay、workspace build與Terraform mock-provider tests仍因`node_modules/.bin/tsc`、`turbo`、`vitest`缺失而未執行，不得視為通過。
- P3-006維持`in_progress`，P3-007維持`blocked`；本checkpoint沒有push、PR、deploy、Terraform apply、外部provider呼叫或更新`main`。

### P3-006 full verification and repository completion

- 依frozen lockfile恢復624個packages，沒有修改dependency版本或lockfile；Prisma Client成功產生。專案入口必須使用`pnpm run doctor`，避免誤執行pnpm內建同名command；doctor source改用lint-safe Node globals，focused ESLint與4 tests通過。
- 第一輪完整檢查如實發現並修正：27個Prettier差異、Prisma readonly filter型別、integration matcher的unsafe assignment、worker mock的unsafe `any`、多餘template type assertion，以及development/test localhost notification worker URL被前置HTTPS schema錯誤拒絕。修正後architecture 23/23、Prettier、12-package lint、strict typecheck與12/12 production build通過。
- `pnpm test`第一次只因Codex sandbox禁止Supertest建立`0.0.0.0` socket而使CORS 3 tests得到EPERM；在允許本機socket後原樣重跑，19/19 workspace unit tasks全綠。API 13 files／65 tests、Web 14／49、worker 7／20，config 28、contracts 42、database unit 39、domain 14、LINE 31與observability 6均通過。
- 本機database原先只有18個migrations，先以明確`pnpm db:migrate`套用`20260723020000_notifications_line`。Integration再揭露兩個時間／一致性fixture：appointment view hold固定上午expiry晚於測試建立時間、notification fixture的`confirmedAt`與`policiesAcceptedAt`使用兩次clock；改為固定合法fixture clock與單一confirmed time。
- Notification budget跨兩個Prisma connections同時初始化月份row時，Prisma upsert仍可在provider/month unique key競態得到23505。改為單一PostgreSQL `INSERT ... ON CONFLICT DO UPDATE ... WHERE reserved_count < cap RETURNING`，把首次初始化與條件式increment合併成原子操作；focused notification integration 9/9通過。
- 完整`pnpm test:integration`最終database 11 files／63 tests、API 7 files／50 tests、9/9 workspace tasks全綠。PII-free operational snapshot測試明確建立due pending outbox，不再假設共享database完全沒有其他合法pending event。
- 一次性`nook_p3_006_replay_20260723`空database從零順序套用全部19個migrations，第二次deploy為no pending，驗證後已刪除。既有`nook` database亦為19 migrations已套用。
- Terraform provider本次可啟動；初次6 pass／1 fail是plan assertion混用apply-time service-account email unknown，拆成plan-time queue/role assertions並保留release static contract驗證exact member後，recursive fmt、release ownership 5/5與platform mock-provider 12/12通過。未執行Terraform apply。
- P3-006全部repository/local acceptance criteria已核對並標為`done`；P3-007依賴解除改為`ready`。真實LINE OA/provider、兩個secret、Cloud Tasks、staging follow/retry/quota/device與owner monthly cap仍是external activation gates，沒有在本輪推定通過。
- 本輪沒有push、PR、deploy、Terraform apply、外部LINE/GCP provider呼叫或更新`main`，也沒有輸出、寫入或持久化credential/token。

## 2026-07-26 — P3-007 merchant LINE entry implementation checkpoint

- P3-007由`ready`改為`in_progress`。依LINE官方LIFF文件確認：每次開頁必須init、primary／secondary redirect各自init、URL改寫與analytics必須等init resolve，且不可修改`liff.*`。Shared contract新增六個bounded route、same-origin canonical redirect builder及OWNER／MANAGER／VIEWER／STAFF navigation matrix；invalid／absolute／nested route一律fallback home。
- 新增mobile-first `/line/studio`入口。LIFF browser只init、不呼叫login；LINE in-app／external未登入走官方`liff.login`，redirect回canonical path後second init。完成init才讀route並只移除一般`route`，保留LIFF reserved query。Parallel tabs、取消授權、callback manipulation與external second-init有unit evidence。
- 發現既有單一LIFF ID無法同時符合consumer與merchant不同Endpoint prefix；browser runtime改為`LINE_LIFF_ID`及`LINE_MERCHANT_LIFF_ID`兩個公開identifier，auth enabled缺任一皆fail closed。一般Studio登入統一導向merchant canonical entry；consumer flow保留獨立LIFF app。
- `/v1/me`明確要求ACTIVE user，只回ACTIVE membership＋ACTIVE tenant，新增membership ID並依`createdAt,id`穩定排序。Browser使用Zod解析response；多membership明確選擇、單一自動選取、無membership顯示不洩漏tenant存在性的安全說明。Tenant API 403會以no-store重讀current memberships，只有selected tenant已被撤銷才清除。
- 新增authenticated `POST /v1/line/studio-entry-events`。Request只接受tenant UUID與route enum；server重新驗ACTIVE membership並依current role推導success／fallback。Denied log不含未授權tenant ID；成功exact log不含role、membership、LINE subject、raw URL、token、contact或顧客資料。
- 為避免integration suite清空現有開發資料，新增只允許localhost的ephemeral database runner：產生隨機database、fresh deploy全部19 migrations、執行命令並在finally drop。第一次因root沒有Prisma binary在migration前失敗且測試database已刪除；改走`@nook/database prisma:migrate:deploy`並先build database package後，P3-007 tenant／role-route focused integration 17/17通過。
- Focused shared contract 13 files／53 tests、Web 15 files／55 tests及Web/API/contracts/config/database strict typecheck／lint逐步通過；完整workspace、full integration、build、architecture、OpenAPI parse與format仍待final gate，不能提前標done。
- Browser實際驗收本機fail-closed入口：390×844的document/body寬度均不超過390、主要link min-height 48px、無console error；1280×800亦無水平溢位。入口可導向mobile Studio總覽。因未提供真實merchant LIFF ID／Firebase／OA，本證據不冒充LIFF device activation。
- 新增merchant entry設計、安全contract與rich menu runbook；consumer／merchant LIFF、平台OA入口與Phase 6店家自有OA仍維持不同成本／權限邊界。本checkpoint沒有push、PR、deploy、Terraform apply、provider呼叫或secret操作。

### P3-007 repository/local acceptance

- Runtime contract再補consumer／merchant雙LIFF ID正向與缺merchant ID fail-closed tests；entry structured log收斂為task明定的exact allowlist，不再附加environment/version。Consumer Endpoint URL prefix明確固定`/m/`，merchant固定`/line/studio`。
- 為ephemeral database runner新增local-only URL unit tests並納入architecture gate。Runner只接受`localhost`、`127.0.0.1`或`::1` PostgreSQL，測試資料庫使用隨機名稱、套用19個migrations並在`finally`刪除；未清空或改寫既有開發資料庫。
- 完整workspace lint、strict typecheck、unit tests、production build、architecture 26/26、Prettier、OpenAPI YAML parse、Terraform recursive fmt及`git diff --check`通過。Unit總計包含API 65、Web 57、contracts 55、config 29及其他workspace suites。
- 完整API integration在乾淨ephemeral database通過7 files／57 tests；P3-007 tenant／role route focused evidence包含其中17 tests。完整database integration另有45/63通過、18個既有booking hold／confirmation tests因固定fixture日期在2026-07-26已超出maximum advance window而失敗；沒有把它誤列為P3-007回歸或全綠，後續應另開time-stable fixture maintenance task。
- 本機browser evidence為390×844與1280×800皆無水平溢位或console error，mobile主要操作高度至少48px，入口可導向Studio。LIFF browser、LINE in-app/external及second init由deterministic browser unit tests驗證；未提供真實LINE/Firebase帳號，所以staging真機、rich menu與owner核准仍保持external activation gates。
- P3-007 repository/local acceptance標為`done`；本批工作依contracts/config、API/database、Web、ephemeral test tooling及文件分開提交，沒有把全部變更放進單一commit。沒有push、PR、deploy、Terraform apply、provider呼叫、secret或credential操作。
- Fresh reader第一輪找到VIEWER矩陣矛盾、repository與真機gate混寫、staging／production拓樸不足、403撤銷辨識、204 role競態及`/v1/me`快取六項blocker。修正後VIEWER只有home／appointments，entry API回server current role的bounded decision，403以no-store memberships判斷是否真撤銷，並明定staging／production各自OA、channel、LIFF app、smoke與rollback。
- 修正後focused contracts 55、Web 57、API unit 65及P3-007 API integration 17 tests全綠；fresh reader第二輪逐項回歸1–6後結論PASS，沒有剩餘文件矛盾或安全阻塞。

## 2026-07-26 — Phase 4 planning handoff

- Phase 3 repository/local tasks全數完成後，新增Phase 4 implementation plan並按資料依賴拆為P4-001 CRM consent、P4-002 completed-only reviews、P4-003 public search／server attribution、P4-004 favorites與P4-005 moderation。Fresh-reader發現P4-001的consent狀態機、停止利用、contact來源／加密、projection replay/backfill、customer建立時點與export contract仍不足，因此Phase 4維持`planning`、P4-001改為`blocked`，不得先建立migration。
- P4-001先固定「預約履約關係不等於行銷同意」、tenant＋consumer唯一customer、appointment current truth projection、unknown spend不推算、OWNER／MANAGER專用CRM、VIEWER／STAFF無PII權限、consumer self-withdrawal與safe export audit。
- Notes不得先用明文落庫；實作前需ADR決定at-rest envelope encryption、key rotation與export artifact TTL。Legal未核准purpose／consent／retention、security未核准key/export、owner未核准non-sensitive tag規範前，production activation保持external gate。

## 2026-07-27 — ARCH-001 API feature module layout

- 回應API `src`平面檔案過多的維護風險，將根目錄收斂為`main.ts`與composition-only `app.module.ts`。跨功能config／HTTP／identity移入`platform`；health、LINE auth、LINE webhook、LINE studio entry、tenancy、merchant onboarding與service catalog各自建立Nest feature module。
- 原本同時承載公開店家、可預約時段、hold、policy與appointment的`marketplace` module拆為`publication`、`booking`與`appointments`。既有`scheduling`與`portfolio`保留獨立邊界；本次只搬移與重接module/import，沒有修改HTTP contract、schema或domain行為。
- 新增架構防退化測試：API source root只允許兩個bootstrap/composition檔、`AppModule`不得直接宣告controller/provider、每個非空feature恰有一個`.module.ts`，且單層TypeScript檔案上限為12。ADR 0001同步記錄feature/platform責任。
- 驗證通過：API strict typecheck、ESLint、build；unit 13 files／67 tests；乾淨ephemeral PostgreSQL套19 migrations後API integration 7 files／57 tests；repository architecture 26 tests與static gates；Prettier與`git diff --check`。第一次unit在sandbox內因CORS測試無法listen `0.0.0.0`而出現`EPERM`，取得本機loopback權限後原測試全綠，未把sandbox失敗誤列為產品回歸。
- 本次API程式碼以93檔的單一coherent refactor commit提交，其中多數為Git辨識的rename，沒有把300多個檔案一次提交。`apps/api/test`與`packages/database/src`仍需在成長前另開結構任務；Phase 4在規格blocker解決前保持planning/blocked。

## 2026-07-27 — ARCH-002 database and API test feature layout

- `packages/database/src`原有18個repository平放；現在依API相同feature語彙拆成appointments、booking、line-auth、line-webhook、merchant-onboarding、notifications、portfolio、publication、scheduling、service-catalog與tenancy。根目錄只保留public `index.ts`，既有`@nook/database` symbol與consumer imports不變。
- `apps/api/test`從20個平面檔案改為`architecture`、`unit/<feature>`與`integration/<feature>`。新增架構gate要求test root不得放`.test.ts`、database root只能有`index.ts`，每個database feature必須有1至4個repository，避免兩個目錄再次退化。
- 第一次完整database integration如先前P3-007 worklog預期得到45/63：18個booking hold／confirmation案例因硬編碼`2026-07-24`超出maximum advance window而失敗。兩組fixture改為執行時推導至少七天後的星期五，並同步推導availability `validFrom`；第二次以乾淨database重跑11 files／63 tests全綠。
- 最終驗證：database unit 15 files／39 tests、API unit／architecture 13 files／69 tests、database integration 11 files／63 tests、API integration 7 files／57 tests；兩次integration各自從零套用19 migrations並刪除ephemeral database。Database/API strict typecheck、ESLint、build、repository architecture 26 tests、Prettier與`git diff --check`通過。
- 本任務沒有schema、migration、HTTP或商業邏輯變更。下一個database test應直接建立在feature目錄，不再增加根層檔案；若public index持續成長，可加內部barrel但仍不開放deep imports。

## 2026-07-28 — CI format, dependency security and time-stable lifecycle recovery

- 依GitHub Actions run `30211241615`的公開job與credential-protected logs定位失敗：`verify`停在Prettier，三個container image均已build成功但被Trivy HIGH gate阻擋。Terraform成功；token只由既有Git credential helper在記憶體提供給單次log request，未輸出或寫入檔案。
- 修正`packages/contracts/src/studio-entry.ts`的既有格式差異；Web由Next 16.2.10升到16.2.12。pnpm workspace以精確來源版本override把runtime的Sharp 0.34.5、brace-expansion 2.1.2、fast-xml-parser 5.10.0與PostCSS 8.4.31分別解析至0.35.3、5.0.8、5.10.1與8.5.18。
- PostCSS最初解析到剛發布的8.5.24時，pnpm自動建立`minimumReleaseAgeExclude`；沒有保留這個供應鏈政策豁免，改鎖已修補且通過冷卻期的8.5.18。Frozen install在零豁免下通過；production audit只剩1個moderate，既定HIGH gate通過。
- GitHub annotations另顯示舊Actions使用Node 20 runtime。依官方tag、action.yml與固定commit SHA，把checkout升至v5、setup-node升至v5、pnpm/action-setup升至v6.0.9；三者均宣告Node 24，CI與reusable deploy workflow仍維持full-SHA pin。
- 完整integration在當日另外發現publication lifecycle fixture固定預約於2026-07-29，已進入24小時取消限制而正確得到409。測試改為執行日起至少八天後的下一個星期三，並只在兩個lifecycle案例對齊availability clock；沒有放寬產品取消規則。Focused publication 10/10、tenant 17/17及完整database 63/63、API 57/57均在各自fresh ephemeral database通過並自動刪除。
- Workspace Prettier、architecture/workflow contracts、12-package lint、strict typecheck、unit tests與production build通過。三個production Docker image均build成功且runtime user為`65532:65532`；Trivy 0.70.0同CI條件掃描Web、API、worker的HIGH/CRITICAL皆為0。
- 本checkpoint沒有push、deploy、Terraform apply、PR mutation、外部provider呼叫或更新`main`。修復維持在`phase1`；Phase 4 P4-001規格工作在CI恢復後再續。

### Remote CI recovery evidence

- 將六筆尚未上傳的小型architecture/test/CI commits推到`phase1`，沒有更新`main`。同一HEAD `56d71c01e23e91a409e493a045e94678fdc7b917`的GitHub Actions push run `30359481717`與PR run `30359483469`均完成且conclusion為success；verify、Terraform與Web/API/worker container gates全綠。
- 遠端狀態只透過GitHub API讀取；本次不需下載credential-protected log。沒有輸出或寫入token，也沒有merge、deploy、Terraform apply或修改PR狀態。

## 2026-07-28 — P4-001 Consumer CRM specification unblocked

- P4-001先完成ADR 0015、Consumer CRM data dictionary、security/design、data lifecycle runbook與OpenAPI，固定CONFIRMED建立營運customer、COMPLETED/NO_SHOW current-truth統計、取消／改期不重複、unknown spend不推算，以及tenant OWNER/MANAGER專用CRM。
- CRM不再與notification爭用shared outbox status；新增per-projector delivery、tenant+consumer blocked stream、六種exact appointment events、retry/terminal recovery及backfill cursor contract。Customer list依immutable relationship key分頁，另以`customers.createdAt<=asOf`排除首頁後才完成的projection。
- Marketing使用tenant+consumer+purpose linear stream與獨立command idempotency ledger。Grant只限consumer、ACTIVE tenant/document及server-verified appointment relationship；withdraw在既有stream上永遠可用，concurrent時優先。HTTP replay不重做command，但每次重算current eligibility，避免撤回後重播過期`GRANTED`。
- Grant evidence固定tenant display snapshot、`nook-consent-evidence-v1` canonical JSON bytes及SHA-256 test vector；新文案使舊grant SUPERSEDED。P4的停止利用只指marketing purpose withdrawal；廣義DSAR/operational restriction仍由P5-002且legal未核准。
- Contact第一版不推測phone/email；營運display label明確沿用LINE-authenticated current name且不延伸subject/avatar。Notes採AES-256-GCM per-note DEK與Cloud KMS wrap、100筆上限及update CAS；KMS unavailable絕不降級明文。Tag定義/links各有100/50 caps且taxonomy核准前disabled。
- Export固定非同步、近5分鐘reauth、REPEATABLE READ `asOf`、claim token/lease/CAS與三次attempt。Hard bounds為10,000 customers、50,000 notes、100,000 tag links、200 MiB uncompressed、50 MiB compressed、512 MiB temp disk及120秒；四個CSV headers/order/null/timestamp規則已固定。Consent watermark/document generation使withdraw/supersede後舊artifact不能再簽新URL；已簽URL明示最多60秒residual window。
- Fresh-reader第一輪找出shared outbox競爭、consent缺路徑、export lease/容量/snapshot、權限與API/data model不一致；第二輪再找出no-op command ledger、blocked stream、projection-lag cursor與evidence canonicalization；最後一輪確認current-state replay修正後PASS。P4-001由`blocked`改`in_progress`，Phase 4改`in_progress`；implementation acceptance與三組external activation gates仍全部未完成。
- 驗證：新文件與OpenAPI通過Prettier、YAML parse、所有local `$ref`存在、`git diff --check`；repository architecture/workflow/local development 26 tests及static gates通過。這是規格checkpoint，尚未建立migration/runtime code，也沒有GCP/KMS/storage apply或production activation。

### P4-001 expand schema and migration checkpoint

- 新增第20個`20260728010000_consumer_crm_expand` migration及Prisma models，涵蓋customers、per-projector deliveries/blocked streams/backfill checkpoint、consent documents/streams/commands/events/privacy watermark、encrypted note envelopes、tenant tag definitions/links及bounded export jobs。
- 所有tenant-owned link使用tenant composite key；Membership補tenant+ID unique供notes/tags/export actor FK。Customer以tenant+consumer唯一；projection delivery以projector+outbox唯一但不改shared outbox status。Consent以stream revision及command key唯一，ACTIVE document另有purpose partial unique。
- Migration加入具名checks：projection lease/status、blocked stream、consent document lifecycle/hash/locale、grant-only canonical evidence、withdraw source、non-negative watermark/counts、AES-GCM 12-byte nonce/16-byte tag/schema v1、tag名稱及export attempt/state/row/byte bounds。沒有DROP、舊FK rename或無關Phase 2/3 default mutation。
- Prisma自動diff最初包含既有schema/migration命名差異造成的舊FK rename、四筆drop及updatedAt default變更；全部從migration移除，只保留P4 expand內容。一次性shadow database只用於產生SQL，完成後已刪除。
- Fresh ephemeral PostgreSQL從零套用20/20 migrations成功；focused CRM schema integration 4/4驗tenant note cross-link、envelope、單一ACTIVE consent document、grant evidence及export bounds。第一次3項check assertion預期Prisma `P2004`，實際6.19回`PrismaClientUnknownRequestError`但PostgreSQL code均為23514且具名constraint正確拒絕；改為比對constraint name後原測試4/4通過，沒有放寬規則。
- Database unit/migration contract 16 files／43 tests、完整fresh database integration 12 files／67 tests、Prisma format/validate/generate、database strict typecheck、ESLint、build及`git diff --check`通過。這個checkpoint仍未實作projection/consent application service、KMS/storage adapter、HTTP或RWD，P4-001維持`in_progress`。

### P4-001 customer projection repository checkpoint

- 新增分層的`packages/domain/src/consumer-crm/customer-projection.ts`與`packages/database/src/consumer-crm/customer-projection-repository.ts`。Domain只負責reschedule chain invariant及effective leaf統計；database repository負責掃描所有shared outbox status的六種exact event、獨立delivery seed、lease claim、tenant+consumer stream lock、current-truth重算與exact-token completion，完全不改shared outbox delivery state。
- Customer upsert只以tenant+consumer為identity，首次`relationshipStartedAt`保存既有最早confirmedAt，後續只覆寫COMPLETED／NO_SHOW current truth與projection trace；不建立或推算spend欄位。Concurrent replay以delivery unique及row claim維持單一customer／delivery。
- Focused integration第一次在sandbox內因未帶`DATABASE_URL`、第二次因localhost連線權限而未進入行為測試；允許本機PostgreSQL後，首次真正執行發現seed row的database default與下一個transaction存在毫秒級due邊界，明確把新delivery `nextAttemptAt`設為epoch後3/3通過。分層重構後先build domain再回歸，仍為3/3。
- Domain typecheck/lint/build與19 tests、database strict typecheck/lint/build及43 unit tests、architecture 26 tests/static gates通過。Fresh ephemeral PostgreSQL從零套用20/20 migrations後，完整database integration 13 files／70 tests全綠並自動刪除測試database。尚未實作backfill checkpoint、10次retry exhaustion／repair command、worker wiring及consent application；本段只作為下一個小commit，不提前勾選完整acceptance。

### P4-001 remote CI fixture isolation follow-up

- `c2c92c5`遠端Integration tests失敗原因為CRM schema constraint suite建立customer／consent fixture後只disconnect，沒有清除資料；當GitHub runner把該檔排在portfolio等既有suite之前，舊suite的global tenant cleanup正確被`customers_tenant_id_fkey`拒絕。本機先前剛好把CRM schema檔排最後，因而沒有暴露順序依賴。
- 補上只依本suite tenant/user/version清除的afterAll teardown，不使用全域truncate或放寬foreign key。Fresh ephemeral database刻意先跑CRM schema 4/4，再跑原先會受污染的database／publication／portfolio 19/19，順序回歸全綠並自動刪除測試database。這是test isolation修正，不修改production schema或runtime行為。

### P4-001 projection operations and worker checkpoint

- Projection repository新增stable `appointments.createdAt,id` backfill checkpoint、blocked-stream fail-stop、exact cursor resume、attempt 10 retry exhaustion dead-letter、exact delivery retry、blocked delivery current-truth revalidation/repair及PII-free operational snapshot。Retry exhaustion不冒充`INVARIANT_CORRUPTION`，只有chain corruption會block tenant+consumer stream。
- 新增受控repair CLI，stream repair／exhausted retry都要求tenant+consumer+delivery及相同delivery confirmation；backfill resume要求exact cursor或`none`及明確confirmation。工具不提供wildcard/global reset，state已改變時回false／not_blocked並要求重新檢查。
- Worker新增獨立feature module與`POST /internal/customer-projection/run`，每輪最多100 delivery及100 backfill cursor。`CRM_PROJECTION_MODE`固定`disabled | shadow | active`，config、`.env.example`及Terraform runtime預設皆為disabled；本slice不新增Scheduler或GCP service。這避免尚未抽樣驗證就產生production CRM read，也以batch而非per-customer task控制Cloud Run/DB成本。
- 初次API/worker typecheck揭露新增required config需要同步既有synthetic RuntimeConfig fixtures，補齊後通過；Terraform init第一次因sandbox DNS無法連registry，取得network權限後使用lockfile provider完成validate及12/12 module tests。Focused projection integration在本機PostgreSQL通過；fresh ephemeral PostgreSQL從零套用20/20 migrations後完整database integration 13 files／73 tests全綠並刪除測試database。
- External activation仍未核准：Terraform刻意無法在目前版本啟用deployed projection，需先完成shadow SQL truth抽樣、alert owner及後續reviewed IaC change。Consent、CRM read API與RWD尚未包含在本checkpoint。

### P4-001 marketing consent repository/application checkpoint

- Domain新增MARKETING_MESSAGES current-state推導、tenant display snapshot NFC/length boundary及八欄canonical evidence encoder，並以文件固定vector驗SHA-256。Appointment relationship只授權operational read；沒有stream的read/grant直接查server-owned appointment，不依賴customer projection完成。
- Database新增consent stream transaction repository：row lock配置revision、same-key ledger current-safe replay、same-key不同fingerprint拒絕、ACTIVE document join即時產生SUPERSEDED、明確re-grant、withdraw no-op command、tenant watermark及safe audit。Grant與withdraw採bounded serializable retry；withdraw不受tenant inactive、ACTIVE document或grant flag阻擋。
- API application service新增strict purpose/document/revision contract、consumer actor binding、idempotency/fingerprint hash與repository error mapping。`MARKETING_CONSENT_GRANT_ENABLED`預設false，Terraform把API固定false；read/withdraw不讀此flag。本checkpoint刻意不註冊HTTP controller，下一個slice完成authentication/no-store HTTP matrix後才暴露route。
- 第一次focused integration因新domain尚未build而讀到舊dist，加上fixture的`confirmedAt`與`policiesAcceptedAt`各自取時造成既有policy constraint拒絕；先build dependency並共用同一database timestamp後，fresh PostgreSQL套用20/20 migrations且consent integration 6/6通過，沒有放寬production constraint。
- 完整format、12-package lint/typecheck、19-task unit（domain 22、contracts 57、database 48、API 73、worker 23、web 57）、12-package build、architecture 26/static gates及Terraform validate/12 module runs通過。Fresh database完整integration為database 14 files／79 tests與API 7 files／57 tests，全數通過並刪除暫時database。
- 遠端push/PR CI的79項database integration僅concurrent exact grant失敗；PostgreSQL log明確為raw `INSERT ... ON CONFLICT`回`could not serialize access`，Prisma包成`PrismaClientUnknownRequestError`而非既有判斷的known `P2034`，所以未進bounded retry。Retry classifier補齊SQLSTATE `40001`／`40P01`及serialization訊息，仍限制最多3次，不把一般database error誤重試；修正後在同一個fresh database連跑10輪、共60項consent integration全綠。

### P4-001 consumer consent HTTP self-service checkpoint

- API註冊`GET|POST|DELETE /v1/me/marketing-consents/{tenantId}`，controller只做authentication、strict contract parsing與application service delegation，不直接使用Prisma。POST明確回200並受grant feature flag控制；GET與DELETE維持可用。
- Feature-scoped middleware在authentication guard前寫入`Cache-Control: private, no-store`，因此成功、401、404及409都不會被browser/shared cache保存。真實HTTP/database integration覆蓋missing bearer、consumer relationship、cross-tenant 404、沒有customer projection仍可讀NOT_GRANTED、grant exact replay、fingerprint conflict、withdraw no-op與safe audit。
- Current-safe replay順序修正為先鎖stream及查command ledger，再檢查新grant需要的ACTIVE tenant/document；因此原始grant在tenant suspended、document retired或後續withdraw後重播，只回傳最新WITHDRAWN truth，不重跑已不再合法的新command。Authentication與server-owned relationship仍在replay前驗證，沒有放寬跨tenant邊界。
- Fresh ephemeral PostgreSQL從零套用20/20 migrations；完整database integration 14 files／79 tests、API integration 8 files／61 tests全數通過。截圖中的舊GitHub Actions failure屬較早的`b51736c` run；目前遠端HEAD `54e9fa0`的push run `30368299935`與PR run `30368302435`均為success。
- 依小型scope分為current-safe replay `381f087`、consumer HTTP/E2E `8f4a0f2`與task/runbook/worklog `1b5d4ba`三筆commit後推送`phase1`，沒有更新`main`。同一HEAD `1b5d4bab5175e7609937e5de94ceff5ac558a5be`的push run `30369377061`與draft PR run `30369377872`最終皆success；verify、Terraform及API/Web/worker container image jobs全綠。
