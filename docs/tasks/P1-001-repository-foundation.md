# P1-001：Repository foundation

狀態：`done`
目標：建立可本機執行與驗證的 monorepo，不實作 booking。

## Scope

- Scaffold Next.js web、NestJS API、NestJS worker。
- 建立 domain/database/contracts/config/observability package 的可編譯入口；其餘 package 保留界面。
- Docker Compose PostgreSQL 16 + PostGIS。
- Prisma 初始 schema：User、UserIdentity、Tenant、Membership、AuditLog。
- web/api/worker health 與 readiness endpoint。
- lint、format、typecheck、unit/integration test、build scripts。

## Contract and authorization

- API health 回應固定 schema：status、service、version、timestamp；readiness 可檢查 DB，但不得揭露 DSN。
- health 不需登入；除 health 外不新增公開業務 endpoint。
- 初始 schema 的 tenant-owned table 必須有索引與 tenant scope 設計。

## Tests and observability

- unit test 驗證 config 與 health presenter。
- integration test 啟動 PostGIS、套用 migration，確認 extension 與 unique constraints。
- request ID middleware/interceptor；log redaction test 不得出現 DB URL。

## Acceptance criteria

- `pnpm install --frozen-lockfile`、lint、typecheck、test、build 全部成功。
- fresh database 可向前 migration，且 application 不會在 startup 自動 migrate。
- 三個 app 可在本機啟動並回應 health。
- ADR 0001 與本機啟動 README 已同步；工作報告包含實際驗證結果。

## Handoff

- 完成日期：2026-07-14。
- 驗證與已知風險詳見 `docs/worklog.md` 的 P1-001 完成紀錄。
- 後續可開始 P1-003；不得在 P1-003 偷渡 LINE login 或 booking 功能。
