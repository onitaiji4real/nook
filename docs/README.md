# 文件索引

| 文件                                      | 用途                                  | 權威性                    |
| ----------------------------------------- | ------------------------------------- | ------------------------- |
| `product/business-technical-plan.md`      | 商業、產品與整體技術基準              | 最高；變更需 ADR/產品決策 |
| `phase-1/implementation-plan.md`          | Phase 1 範圍、依賴、完成定義          | Phase 1 執行基準          |
| `phase-2/implementation-plan.md`          | Phase 2 店家供給交付順序與完成定義    | Phase 2 執行基準          |
| `phase-3/implementation-plan.md`          | Phase 3 預約核心交付順序與完成定義    | Phase 3 執行基準          |
| `phase-1/acceptance-standard.md`          | Required gates 與證據強度             | Phase 1 驗收規範          |
| `phase-1/acceptance-evidence.md`          | Gate 狀態與直接證據                   | Phase 1 驗收進度          |
| `tasks/README.md`                         | 可獨立交接的垂直任務清單              | 任務狀態入口              |
| `tasks/*.md`                              | 單一垂直切片契約與驗收                | 實作交接基準              |
| `api/openapi.yaml`                        | HTTP contract                         | 公開 API 契約             |
| `data-dictionary/*.md`                    | 資料語意與敏感度                      | Schema 設計基準           |
| `design/*.md`                             | 品牌、介面與copy contract             | 前端設計基準              |
| `security/*.md`                           | Threat notes 與控制                   | 安全審查基準              |
| `adr/*.md`                                | 已接受的架構決策                      | 決策依據                  |
| `runbooks/terraform.md`                   | GCP/Terraform 操作與安全界線          | 基礎設施作業基準          |
| `runbooks/deployment.md`                  | 發布、smoke 與 rollback               | 部署作業基準              |
| `runbooks/line-firebase-browser-setup.md` | LINE LIFF／Firebase Web外部設定與驗收 | Browser identity作業基準  |
| `runbooks/booking-hold-expiry.md`         | Hold expiry worker與Scheduler啟用gate | 預約維運作業基準          |
| `ci-contract.md`                          | Required checks 與 release ordering   | CI/CD 驗收基準            |
| `reviews/*.md`                            | 文件、實作與驗收落差稽核              | 稽核發現與改善追蹤        |
| `worklog.md`                              | 時序工作報告、驗證與未決事項          | 執行稽核紀錄              |

文件變更應在 `docs/worklog.md` 留下日期、原因、驗證方式與後續事項。
