# Nook — LINE 美業預約與店務平台

LINE-first 的美業店務 SaaS 與新客媒合平台。產品與技術決策以 [商業暨技術規劃](docs/product/business-technical-plan.md) 為基準。

## 目前狀態

Phase 1 平台骨架準備中。當前交付範圍與完成定義見 [Phase 1 實作計畫](docs/phase-1/implementation-plan.md)，可接手工作見 [Codex 垂直任務](docs/tasks/README.md)，進度見 [工作報告](docs/worklog.md)。

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
