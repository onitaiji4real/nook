# Nook — LINE 美業預約與店務平台

LINE-first 的美業店務 SaaS 與新客媒合平台。產品與技術決策以 [商業暨技術規劃](docs/product/business-technical-plan.md) 為基準。

## 目前狀態

Phase 1平台骨架仍等待外部GCP／LINE／deployment evidence；repository-local Phase 2供給功能已完成主要切片，並開始規劃Phase 3預約核心。範圍見[Phase 1實作計畫](docs/phase-1/implementation-plan.md)、[Phase 2實作計畫](docs/phase-2/implementation-plan.md)與[Phase 3實作計畫](docs/phase-3/implementation-plan.md)，可接手工作見[Codex垂直任務](docs/tasks/README.md)，進度見[工作報告](docs/worklog.md)。

## Repository layout

- `apps/`: Next.js web、NestJS API、NestJS worker
- `packages/`: domain、database、contracts 與共用能力
- `infra/terraform/`: GCP bootstrap、共用模組、dev/stg/prod stacks
- `infra/ci/`: repository boundary、workflow security 與 deployment scripts
- `docs/`: 產品基準、ADR、Phase 計畫、任務與 runbook
- `tests/`: 跨應用 E2E 與 fixtures

`pnpm check:architecture` 會驗證必要目錄、workspace manifest、app/package dependency boundary、未宣告的 `@nook/*` import，以及不可提交的 build、環境與 Terraform state 產物。共用 package 不可依賴 deployable app，app 之間也不可直接依賴。

## 開始工作

1. 閱讀 `AGENTS.md` 與上述基準文件。
2. 從 `docs/tasks/README.md` 選取一個 `ready` 任務。
3. 將任務改為 `in_progress`，實作並持續記錄 `docs/worklog.md`。
4. 完成驗收與檢查後改為 `done`，留下風險及後續決策。

## Local development

需求：Node.js 24.14+、pnpm 11.7+、Docker Desktop 或 OrbStack。權威版本約束以根目錄 `package.json` 與 `.nvmrc` 為準。CI明確安裝`packageManager`固定版本；本機Homebrew pnpm若是符合engines的較新版本，workspace的`pmOnFail: warn`會保留版本警告但不在每次命令前自動下載舊版。

Apple Silicon 會以 Docker 的 `linux/amd64` 模擬執行官方 PostGIS image；首次啟動較慢。

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm run doctor
pnpm dev:services
pnpm db:migrate
pnpm dev
```

`pnpm db:migrate` 與 `pnpm dev` 會自動載入 repository 根目錄的 `.env`；shell 已明確 export 的值優先，不需要手動執行 `source .env`。`.env` 不得提交。

`pnpm run doctor`只回報版本、必要工具、環境變數名稱、Docker與三個health endpoint狀態，不會輸出`.env`值。必須保留`run`，避免誤執行pnpm內建的同名命令；若`pnpm`本身無法執行，也可先用`node infra/dev/doctor.mjs`取得診斷。`FAIL`需先修復，尚未啟動的服務則顯示`WARN`。

`pnpm dev` 會先以 workspace concurrency 1依序build九個shared packages，再同時啟動Web、API與worker；這可避免macOS／Node 24在Turbo並行dependency build時長時間只啟動Web。Shared package source變更後請重新啟動`pnpm dev`，讓dist重新產生。

預設服務：

| Service            | URL                     | Health             | Readiness        |
| ------------------ | ----------------------- | ------------------ | ---------------- |
| web                | `http://localhost:3000` | `/api/health`      | `/api/readiness` |
| api                | `http://localhost:8080` | `/health`          | `/ready`         |
| worker             | `http://localhost:8081` | `/health`          | `/ready`         |
| PostgreSQL/PostGIS | `localhost:5432`        | Docker healthcheck | `pg_isready`     |

可直接檢視／操作：

- 服務介紹：`http://localhost:3000`
- 商家建檔本機預覽：`http://localhost:3000/studio/onboarding`
- 服務目錄本機工作台：`http://localhost:3000/studio/services`
- 人員排班本機工作台：`http://localhost:3000/studio/staff`
- 作品集本機工作台：`http://localhost:3000/studio/portfolio`
- 發布管理本機工作台：`http://localhost:3000/studio/publication`
- 店家預約行事曆：`http://localhost:3000/studio/appointments`
- 預約政策工作台：`http://localhost:3000/studio/policies`
- 顧客預約紀錄：`http://localhost:3000/appointments`
- 公開商家頁合成預覽：`http://localhost:3000/preview/merchant`（LOCAL PREVIEW、noindex）
- 正式公開商家頁與預約入口：`http://localhost:3000/m/{slug}`（只讀取已發布商家）
- 受保護商家建檔API：`GET`／`PUT /v1/tenants/{tenantId}/merchant-onboarding`
- 受保護服務目錄API：list／create／update／status／reorder under `GET`／`POST /v1/tenants/{tenantId}/services`
- 受保護作品API：list／upload intent／complete／update／reorder／soft delete under `/v1/tenants/{tenantId}/portfolio`
- 發布管理API：readiness／publish／unpublish／作品公開狀態 under `/v1/tenants/{tenantId}/publication`
- 無需登入的公開API：`GET /v1/marketplace/merchants/{slug}`

商家建檔、服務目錄、人員班表、作品metadata、發布與預約API已有tenant/RBAC contract。作品圖片採短效signed POST直傳private GCS，只有worker實際驗證並轉成去除metadata的WebP後才READY；公開頁只簽發PUBLISHED＋READY作品的15分鐘read URL，私有地址只公開縣市／行政區。`WEB_AUTH_MODE=disabled`只提供明示的LOCAL PREVIEW且不送正式API；設定`firebase-line`及外部LINE/Firebase provider後，Studio與顧客流程使用正式browser session，不提供手動token或固定dev token繞過驗證。

API 與 worker 在缺少或無效的 `DATABASE_URL` 時會 fail closed。應用啟動不會自動執行 migration；部署及本機均須明確執行 `pnpm db:migrate`。

API CORS 採精確 allowlist。`.env.example` 預設只允許本機 Web `http://localhost:3000`；多個 origin 以逗號分隔，不能使用 wildcard、path 或 credential。staging/production 應填入實際 Web origin，production 只允許 HTTPS。

LINE exchange 預設使用 PostgreSQL 跨 instance限流：每環境 120 requests/minute、每個 token fingerprint 5 requests/minute，bucket TTL 10 分鐘。可用 `.env.example` 的 `AUTH_LINE_EXCHANGE_*`／`AUTH_RATE_LIMIT_BUCKET_TTL_SECONDS` 調整，但 production 變更必須有 abuse/load evidence；超限回 429 與 `Retry-After`。

## Verification

```bash
pnpm check:architecture
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

## Git workflow

目前開發目標分支為 `phase1`。禁止直接 commit 或 push 至 `main`；`main` 只接受通過檢查與 review 的 pull request。完整規則與 GitHub 保護設定見 [Git workflow](docs/git-workflow.md)。
