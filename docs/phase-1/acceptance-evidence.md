# Phase 1 驗收證據

最後更新：2026-07-14

本表只記錄已取得的直接證據；完整通過條件見 [Phase 1 驗收標準](acceptance-standard.md)。命令細節與風險以 `docs/worklog.md` 為準。

| Gate        | 狀態      | 目前證據 / 缺口                                                                                                                 |
| ----------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| P1-A01      | `PASS`    | P1-001 worklog：frozen lockfile install 成功。                                                                                  |
| P1-A02      | `PASS`    | P1-001 worklog：format/lint/typecheck 全部成功。                                                                                |
| P1-A03      | `PASS`    | P1-001 worklog：unit/integration/build 全部成功。                                                                               |
| P1-A04      | `PASS`    | P1-001 worklog：三服務 health/readiness smoke test。                                                                            |
| P1-A05      | `PASS`    | P1-001 worklog：fresh migration、重跑與 PostGIS tests。                                                                         |
| P1-B01      | `PASS`    | P1-002 worklog：Terraform 1.15.8、Google provider 6.50.0；五個 configuration validate、3 個 mock tests、Trivy HIGH/CRITICAL 0。 |
| P1-B02      | `PASS`    | `infra/terraform/scripts/check-isolation.mjs` 驗證 project example、backend prefix、environment 與 WIF repository condition。   |
| P1-B03      | `PASS`    | Terraform tests 驗證 foundation-only、拒絕 mutable/incomplete image、接受三個 digest-pinned runtime image。                     |
| P1-B04      | `PASS`    | Terraform tests + Trivy：state/media protection、private worker、WIF、least-privilege runtime bindings、Cloud SQL TLS。         |
| P1-B05      | `BLOCKED` | 尚缺 GCP organization/folder、billing、唯一 project IDs 與 owner-approved apply。                                               |
| P1-C01      | `PASS`    | API integration：membership FK 失敗後 tenant count 為 0，證明 transaction rollback。                                            |
| P1-C02      | `PASS`    | 三個 endpoint e2e + `docs/api/openapi.yaml`；error 使用 application/problem+json 與 requestId。                                 |
| P1-C03      | `PASS`    | API integration：cross-tenant 403、inactive membership 立即 403。                                                               |
| P1-C04      | `PASS`    | tenant.created/authorization.denied audit + captured log test，不含 synthetic name/profile。                                    |
| P1-C05      | `PASS`    | `architecture.test.ts` 禁止 controller Prisma，並檢查 tenant repository method 的 tenantId contract。                           |
| P1-D01～D04 | `NOT_RUN` | P1-004 尚未完成。                                                                                                               |
| P1-D05      | `BLOCKED` | 尚缺 LINE/Identity Platform staging configuration。                                                                             |
| P1-E01～E07 | `NOT_RUN` | P1-005 尚未完成；其中遠端 required checks/deploy/rollback/alerts 需要外部證據。                                                 |
| P1-F01～F04 | `NOT_RUN` | 最終文件與 Git/PR 稽核尚未執行。                                                                                                |
