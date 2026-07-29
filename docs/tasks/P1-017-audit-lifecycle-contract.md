# P1-017：Audit lifecycle contract

狀態：`done`

## 目標

讓 audit request ID 與 tenant deletion 行為在 database 層 fail closed，同時把尚未核准的保存年限明確留給產品／法遵決策。

## 範圍

- 回填既有 nullable audit request ID，並收緊為 `NOT NULL`。
- 將 audit-to-tenant foreign key 由 cascade 改為 restrict。
- 定義 Phase 1 使用 `Tenant.status = CLOSED`、不做 tenant hard delete。
- 新增 database integration regression test、ADR、資料字典與 gap audit證據。

## 驗收條件

- [x] Migration 可套用且可重入部署流程。
- [x] Database 拒絕沒有 request ID 的 audit row。
- [x] Tenant hard delete失敗後 audit row仍存在。
- [x] 所有既有 database/API integration tests通過。
- [x] Prisma format/generate、typecheck、lint、Prettier與diff checks通過。
- [x] 未自行設定 retention年限或新增 destructive cleanup job。

## 非目標

- 不決定法定、稅務或帳務保存年限。
- 不實作 tenant closure／privacy request API、legal hold、export、anonymization或purge worker。
- 不執行 production/staging migration或刪除任何 tenant/user資料。
