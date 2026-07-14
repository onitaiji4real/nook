# Phase 1 驗收證據

最後更新：2026-07-14

本表只記錄已取得的直接證據；完整通過條件見 [Phase 1 驗收標準](acceptance-standard.md)。命令細節與風險以 `docs/worklog.md` 為準。

| Gate   | 狀態      | 目前證據 / 缺口                                                                                                                                          |
| ------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-A01 | `PASS`    | P1-001 worklog：frozen lockfile install 成功。                                                                                                           |
| P1-A02 | `PASS`    | P1-001 worklog：format/lint/typecheck 全部成功。                                                                                                         |
| P1-A03 | `PASS`    | P1-001 worklog：unit/integration/build 全部成功。                                                                                                        |
| P1-A04 | `PASS`    | P1-001 worklog：三服務 health/readiness smoke test。                                                                                                     |
| P1-A05 | `PASS`    | P1-001 worklog：fresh migration、重跑與 PostGIS tests。                                                                                                  |
| P1-B01 | `PASS`    | `a8e1db4` clean checkout：Terraform 1.15.8、Google provider 6.50.0 multi-platform lock、五個 readonly validate、3 mocks、Trivy HIGH/CRITICAL 0。         |
| P1-B02 | `PASS`    | `infra/terraform/scripts/check-isolation.mjs` 驗證 project example、backend prefix、environment 與 WIF repository condition。                            |
| P1-B03 | `PASS`    | Terraform tests 驗證 foundation-only、拒絕 mutable/incomplete image、接受三個 digest-pinned runtime image。                                              |
| P1-B04 | `PASS`    | Terraform tests + Trivy：state/media protection、private worker、WIF、least-privilege runtime bindings、Cloud SQL TLS。                                  |
| P1-B05 | `BLOCKED` | 尚缺 GCP organization/folder、billing、唯一 project IDs 與 owner-approved apply。                                                                        |
| P1-C01 | `PASS`    | API integration：membership FK 失敗後 tenant count 為 0，證明 transaction rollback。                                                                     |
| P1-C02 | `PASS`    | 三個 endpoint e2e + `docs/api/openapi.yaml`；error 使用 application/problem+json 與 requestId。                                                          |
| P1-C03 | `PASS`    | API integration：cross-tenant 403、inactive membership 立即 403。                                                                                        |
| P1-C04 | `PASS`    | tenant.created/authorization.denied audit + captured log test，不含 synthetic name/profile。                                                             |
| P1-C05 | `PASS`    | `architecture.test.ts` 禁止 controller Prisma，並檢查 tenant repository method 的 tenantId contract。                                                    |
| P1-D01 | `PASS`    | `@nook/line` synthetic tests 驗證 valid/expired/wrong audience/invalid nonce/timeout；API 只接受 raw token + nonce。                                     |
| P1-D02 | `PASS`    | API/PostgreSQL concurrent exchange integration：兩個 200、僅一個 User 與一個 `(LINE, subject)` identity。                                                |
| P1-D03 | `PASS`    | LINE adapter 3 秒 timeout；API e2e 驗證 invalid token 401、provider timeout 503 與穩定 Problem Details。                                                 |
| P1-D04 | `PASS`    | API e2e 僅回 customToken/expiresIn、無 Set-Cookie；Firebase adapter contract tests 通過。                                                                |
| P1-D05 | `BLOCKED` | 尚缺 LINE/Identity Platform staging configuration。                                                                                                      |
| P1-E01 | `BLOCKED` | clean checkout workflow contract 與等價命令通過；GitHub API 目前回報 0 runs，且尚缺 required ruleset。                                                   |
| P1-E02 | `PASS`    | `a8e1db4` clean checkout 重建三個 digest-pinned distroless Node 24 image；皆以 `65532:65532` 執行，migration、六個 probes、healthcheck 與 Trivy 全通過。 |
| P1-E03 | `PASS`    | Terraform/workflows 僅使用 OIDC/WIF，stg/prod identity 與 environment claim 分離；credential scan 無 service-account key。                               |
| P1-E04 | `BLOCKED` | migration-first、zero-traffic candidate、smoke、promotion/stop ordering已通過 static contract；尚缺 staging workflow run。                               |
| P1-E05 | `BLOCKED` | production 僅 manual dispatch 且綁 `prod` Environment；尚缺 reviewer protection 與未批准 run 證據。                                                      |
| P1-E06 | `BLOCKED` | rollback script/runbook 已通過 shell/static checks；尚缺 staging 前後 digest 與實際 smoke 演練。                                                         |
| P1-E07 | `BLOCKED` | captured-log/redaction/release dimensions 與 dashboard/5xx owner/runbook 已完成；尚缺 applied query/notification。                                       |
| P1-F01 | `PASS`    | OpenAPI、ADR 0001～0003、data dictionary、threat notes、CI contract 與文件索引皆存在並通過格式/contract validation。                                     |
| P1-F02 | `BLOCKED` | local/Terraform/migration/deploy/rollback runbooks 與本機 command audit 已完成；尚缺真實 staging deployment dry run。                                    |
| P1-F03 | `PASS`    | P1-001～P1-005 task 均為 done；worklog 含變更、決策、驗證、風險、下一步與 Phase 1 implementation commit inventory。                                      |
| P1-F04 | `BLOCKED` | 八個既有實作/文件 commits 全在 `phase1`，未直接更新 main；尚缺 GitHub ruleset 與 `phase1` → `main` reviewed PR evidence。                                |
