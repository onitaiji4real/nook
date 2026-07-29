# Phase 1：平台骨架實作計畫

狀態：`in_progress`
最後更新：2026-07-21
來源：`docs/product/business-technical-plan.md` §18 Phase 1

任務索引的 `done` 只表示單一 task 在 repository／local evidence 範圍內符合 acceptance criteria。Phase 1 仍以 `docs/phase-1/acceptance-evidence.md` 的 required gates為準；只要任一 gate為`BLOCKED`、`FAIL`或`NOT_RUN`，本文件狀態不得改為完成。

## 目標

建立可重複部署、可測試且具租戶隔離的工程骨架，讓後續功能能以小型垂直切片持續交付。Phase 1 不實作預約、店家服務或搜尋業務。

## 交付串流

| 串流             | 交付                                                  | 驗收證據                                   |
| ---------------- | ----------------------------------------------------- | ------------------------------------------ |
| Repository       | pnpm/Turborepo、web/api/worker、共用 packages         | lint/typecheck/test/build 可執行           |
| Local data       | PostgreSQL + PostGIS、Prisma migration                | integration test 可連線且 migration 可重跑 |
| Cloud foundation | dev/stg/prod projects、APIs、state、Artifact Registry | Terraform plan 與 project checklist        |
| Runtime          | Cloud Run web/api/worker、service accounts、secrets   | 三服務 health check                        |
| Identity         | Identity Platform、LINE token exchange                | contract + auth integration tests          |
| Tenancy          | user/identity/tenant/membership、RBAC、audit log      | cross-tenant denial tests                  |
| Delivery         | PR CI、staging deployment、production approval gate   | workflow run 與 smoke test                 |
| Observability    | structured logging、request correlation               | log query 與無 PII 測試                    |

## 建議順序與依賴

1. `P1-001` repository foundation。
2. `P1-002` cloud/Terraform foundation，可在本機骨架建立後並行準備，但 apply 前需 GCP 組織與帳務資訊。
3. `P1-003` identity/tenant/RBAC，依賴 Prisma 與 API 骨架。
4. `P1-004` LINE login exchange，依賴 identity repository 與 Secret Manager interface。
5. `P1-005` CI/CD and observability，先接 lint/test/build，再接 staging deploy。

P1-006～P1-017 是依 gap audit建立的 repository remediation tasks；它們完成 local implementation contract，不取代下列外部前置條件或 required gate。

## Phase 1 完成定義

- fresh clone 能依 README 啟動本機 PostgreSQL/PostGIS 與三個應用。
- web、api、worker 皆有不洩漏內部資訊的 health/readiness endpoint。
- dev/stg/prod 使用獨立 project 與 Terraform state；不共用服務帳號或 secret。
- LINE token 必須由後端驗證，不能信任前端提供的 LINE user id。
- Tenant A 無法讀寫 Tenant B 資料，且拒絕事件具安全 audit trail。
- PR 執行 lint、typecheck、unit/integration test、build、Terraform fmt/validate。
- merge main 可部署 staging；production 需要人工批准。
- 關鍵操作具 request ID 與結構化 log，且測試證明不含 PII/secret。
- 所有任務文件與 `docs/worklog.md` 已更新，可由新 Codex session 只靠 repo 接手。

## 外部前置條件

- GCP organization/folder、billing account、三個唯一 project ID。
- Terraform state 專用 project/bucket 的管理決策。
- GitHub repository、Workload Identity Federation issuer/repository 條件。
- LINE Login/MINI App channel ID、channel secret 與允許的 callback URL。
- staging/production 網域；未決時可先用 Cloud Run URL。

這些值不得提交。範例只能放在 `.tfvars.example` 或 `.env.example`。

完整 gate、證據強度與外部阻塞定義見 [Phase 1 驗收標準](acceptance-standard.md)。
