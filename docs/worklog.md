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
