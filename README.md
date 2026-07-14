# Nook — LINE 美業預約與店務平台

LINE-first 的美業店務 SaaS 與新客媒合平台。產品與技術決策以 [商業暨技術規劃](docs/product/business-technical-plan.md) 為基準。

## 目前狀態

Phase 1 平台骨架實作中。當前交付範圍與完成定義見 [Phase 1 實作計畫](docs/phase-1/implementation-plan.md)，可接手工作見 [Codex 垂直任務](docs/tasks/README.md)，進度見 [工作報告](docs/worklog.md)。

## Repository layout

- `apps/`: Next.js web、NestJS API、NestJS worker
- `packages/`: domain、database、contracts 與共用能力
- `infra/terraform/`: GCP bootstrap、共用模組、dev/stg/prod stacks
- `docs/`: 產品基準、ADR、Phase 計畫、任務與 runbook
- `tests/`: 跨應用 E2E 與 fixtures

## 開始工作

1. 閱讀 `AGENTS.md` 與上述基準文件。
2. 從 `docs/tasks/README.md` 選取一個 `ready` 任務。
3. 將任務改為 `in_progress`，實作並持續記錄 `docs/worklog.md`。
4. 完成驗收與檢查後改為 `done`，留下風險及後續決策。

## Local development

需求：Node.js 20.17+、pnpm 9.9+、Docker Desktop 或 OrbStack。

Apple Silicon 會以 Docker 的 `linux/amd64` 模擬執行官方 PostGIS image；首次啟動較慢。

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm dev:services
pnpm db:migrate
pnpm dev
```

預設服務：

| Service            | URL                     | Health             | Readiness        |
| ------------------ | ----------------------- | ------------------ | ---------------- |
| web                | `http://localhost:3000` | `/api/health`      | `/api/readiness` |
| api                | `http://localhost:8080` | `/health`          | `/ready`         |
| worker             | `http://localhost:8081` | `/health`          | `/ready`         |
| PostgreSQL/PostGIS | `localhost:5432`        | Docker healthcheck | `pg_isready`     |

API 與 worker 在缺少或無效的 `DATABASE_URL` 時會 fail closed。應用啟動不會自動執行 migration；部署及本機均須明確執行 `pnpm db:migrate`。

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

## Git workflow

目前開發目標分支為 `phase1`。禁止直接 commit 或 push 至 `main`；`main` 只接受通過檢查與 review 的 pull request。完整規則與 GitHub 保護設定見 [Git workflow](docs/git-workflow.md)。
