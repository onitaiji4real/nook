# Phase 1 驗收標準

版本：v1.0
適用範圍：`docs/product/business-technical-plan.md` §18 Phase 1 及 P1-001～P1-005
驗收原則：可重現、可追溯、fail closed，不以「已有程式碼」代替實際證據。

## 狀態定義

| 狀態      | 定義                                                         |
| --------- | ------------------------------------------------------------ |
| `PASS`    | 已以本文件指定範圍的直接證據驗證，證據可由新 session 重現。  |
| `FAIL`    | 已執行驗證且結果不符合標準。                                 |
| `BLOCKED` | 缺少明確列出的外部權限、憑證或第三方設定，無法取得直接證據。 |
| `NOT_RUN` | 尚未執行；不得視為完成或以較窄測試替代。                     |

Phase 1 只有在所有 required gate 為 `PASS` 時才可標記完成。`BLOCKED` 必須記錄 owner、所需輸入與解除方式，但仍不等同完成。

## Required gates

### A. Repository 與本機執行

| ID     | 驗收項目           | 通過標準                                                                                 | 必要證據                                                              |
| ------ | ------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| P1-A01 | Fresh install      | 支援版本的 Node/pnpm 可由 lockfile 安裝全部 workspace。                                  | `CI=true pnpm install --frozen-lockfile` exit 0。                     |
| P1-A02 | Static quality     | format、lint、strict typecheck 全部通過。                                                | `pnpm format:check`、`pnpm lint`、`pnpm typecheck` exit 0。           |
| P1-A03 | Test and build     | unit、integration、production build 全部通過。                                           | `pnpm test`、`pnpm test:integration`、`pnpm build` exit 0。           |
| P1-A04 | Local runtime      | web/api/worker 可啟動；health 200；依賴正常時 readiness 200。                            | 三服務 smoke test 的 HTTP status、response schema 與 `x-request-id`。 |
| P1-A05 | Database lifecycle | fresh PostgreSQL 16 + PostGIS 可向前 migration，重跑無 pending；startup 不自動 migrate。 | fresh database migration、第二次 deploy 與 PostGIS integration test。 |

### B. Terraform 與 GCP 隔離

| ID     | 驗收項目                    | 通過標準                                                                                         | 必要證據                                                                    |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| P1-B01 | Terraform static validation | 所有 root/module format、init without backend、validate 與 security scan 通過。                  | Terraform/OpenTofu 與 Trivy/tfsec 等價命令輸出。                            |
| P1-B02 | Environment isolation       | dev/stg/prod project、backend prefix、service account、secret container 不交叉。                 | 三環境 plan 摘要與 machine-readable isolation check。                       |
| P1-B03 | Foundation contract         | `deploy_runtime=false` 可建立 foundation；runtime=true 缺任一 digest 時拒絕。                    | offline/provider plan 或 Terraform test，涵蓋正反案例。                     |
| P1-B04 | Cloud security              | state bucket versioning/UBLA/public prevention；worker private；runtime IAM 最小化；無長效 key。 | config scan、plan review checklist。                                        |
| P1-B05 | Actual GCP foundation       | 三個 project/state 與 foundation 實際存在，且資源與 approved plan 一致。                         | 經 owner 批准的 apply 紀錄、project checklist、post-apply read-only query。 |

### C. Tenant、membership 與 RBAC

| ID     | 驗收項目            | 通過標準                                                                                 | 必要證據                                                |
| ------ | ------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| P1-C01 | Atomic onboarding   | 建立 tenant 與 OWNER membership 使用同一 transaction；失敗不留 orphan。                  | database integration test。                             |
| P1-C02 | Stable API contract | `POST /v1/tenants`、`GET /v1/tenants/:tenantId`、`GET /v1/me` 符合 OpenAPI 與 RFC 9457。 | contract/e2e tests 與 OpenAPI validation。              |
| P1-C03 | Tenant isolation    | Tenant A 無法讀寫 Tenant B；inactive membership 立即拒絕。                               | cross-tenant authorization integration tests。          |
| P1-C04 | Safe audit          | tenant.created 與 authorization.denied 含安全 actor/resource/request ID，不含 PII。      | audit integration test 與 captured-log redaction test。 |
| P1-C05 | Layering            | controller 不 import Prisma；tenant repository method 顯式要求 tenantId。                | architecture test/static assertion。                    |

### D. LINE Login 與 Identity Platform

| ID     | 驗收項目                    | 通過標準                                                                                                             | 必要證據                                                                           |
| ------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| P1-D01 | Server-side verification    | API 只接受 raw token/nonce；驗證 issuer、audience、expiry、signature/provider response 與 nonce，不信任前端 userId。 | valid/expired/wrong-audience/invalid-nonce contract tests。                        |
| P1-D02 | Idempotent identity         | 重試與 concurrent exchange 不建立重複 User/UserIdentity。                                                            | database concurrency integration test。                                            |
| P1-D03 | Stable failure mapping      | invalid token 與 provider timeout 有上限並映射 RFC 9457，不洩漏 token。                                              | adapter timeout/error e2e tests。                                                  |
| P1-D04 | Token issuance              | 成功只回傳 custom token/expiry，無 cookie side effect；issuer 可替換。                                               | API contract 與 adapter contract tests。                                           |
| P1-D05 | Actual provider integration | staging 使用真實 LINE channel 與 Identity Platform 完成交換。                                                        | 不含 token 的 staging synthetic login run 與 Cloud Audit/structured log evidence。 |

### E. CI/CD 與 observability

| ID     | 驗收項目           | 通過標準                                                                                                        | 必要證據                                                                    |
| ------ | ------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| P1-E01 | PR CI              | frozen install、quality、tests、build、Terraform validation、dependency/container scan 全部是 required checks。 | GitHub Actions successful run 與 branch ruleset。                           |
| P1-E02 | Immutable images   | web/api/worker image 以 SHA/digest 建置，非 root 執行且可通過 smoke test。                                      | image metadata、container smoke test、scan report。                         |
| P1-E03 | Keyless deployment | GitHub OIDC/WIF；staging/prod deploy identity 分離，沒有 service-account key。                                  | WIF provider condition、IAM policy 與 workflow permissions。                |
| P1-E04 | Staging deployment | merge main 依序 migration、deploy、smoke；任一步失敗即停止。                                                    | staging workflow run 與三服務 health/readiness。                            |
| P1-E05 | Production gate    | production 只可由 GitHub Environment 人工批准後部署。                                                           | environment protection 設定與未批准時不執行的 workflow evidence。           |
| P1-E06 | Rollback           | staging 已以先前 digest rollback 並確認服務與 schema 相容。                                                     | 演練紀錄、前後 digest、smoke result。                                       |
| P1-E07 | Logging and alerts | log 含 requestId/service/version/environment；不含 PII/secret；5xx alert 有 owner/runbook。                     | captured-log tests、dashboard/alert query、notification channel checklist。 |

### F. 文件與交接

| ID     | 驗收項目                | 通過標準                                                                                | 必要證據                                 |
| ------ | ----------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------- |
| P1-F01 | Contracts and decisions | 公開 contract 有 OpenAPI；架構/第三方決策有 ADR；資料有 dictionary/threat notes。       | repository files 與 validation。         |
| P1-F02 | Operations              | local、Terraform、deploy、secret、migration、rollback、drift runbook 可由未參與者執行。 | command audit 與 dry run。               |
| P1-F03 | Worklog                 | 每個 task 記錄變更、決策、實際驗證、風險、下一步與 commit。                             | `docs/worklog.md` 與 task status。       |
| P1-F04 | Git safety              | 實作只在 `phase1`/task branch；main 僅經 reviewed PR。                                  | branch history、ruleset 與 PR evidence。 |

## 驗收執行規則

1. 每個 task 完成時更新本文件對應 gate 的證據位置與 `docs/worklog.md`，再建立 scoped commit。
2. commit 第一行只放單一重點；body 需以中文與英文說明範圍、原因、驗證與風險。
3. local mock、static validation 與 cloud/provider integration 是不同層級，不得互相冒充。
4. 含付費資源、production、外部訊息或權限變更的操作仍需 owner 明確批准。
5. 最終驗收必須從 clean checkout 重跑自動化 gate，並逐項查核 B05、D05、E01、E04～E07 的外部證據。

## 外部證據 owner

| Gate           | 尚需輸入/權限                                                  | Owner 解除方式                                                                                            |
| -------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| P1-B05         | organization/folder、billing、唯一 project IDs、apply approval | Cloud owner 提供非秘密識別值並批准 saved plan。                                                           |
| P1-D05         | LINE channel ID、callback、Identity Platform project           | Identity owner 設定 staging channel/project 並批准測試；目前 ID token verify flow 不讀取 channel secret。 |
| P1-E01/E05     | GitHub ruleset、Environments 管理權限                          | Repository admin 設定 required checks 與 production reviewers。                                           |
| P1-E04/E06/E07 | staging deploy、rollback、monitoring/notification 權限         | Platform owner 批准部署與演練窗口。                                                                       |
