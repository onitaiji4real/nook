# 文件索引

| 文件 | 用途 | 權威性 |
|---|---|---|
| `product/business-technical-plan.md` | 商業、產品與整體技術基準 | 最高；變更需 ADR/產品決策 |
| `phase-1/implementation-plan.md` | Phase 1 範圍、依賴、完成定義 | Phase 1 執行基準 |
| `tasks/README.md` | 可獨立交接的垂直任務清單 | 任務狀態入口 |
| `tasks/*.md` | 單一垂直切片契約與驗收 | 實作交接基準 |
| `adr/*.md` | 已接受的架構決策 | 決策依據 |
| `runbooks/terraform.md` | GCP/Terraform 操作與安全界線 | 基礎設施作業基準 |
| `worklog.md` | 時序工作報告、驗證與未決事項 | 執行稽核紀錄 |

文件變更應在 `docs/worklog.md` 留下日期、原因、驗證方式與後續事項。
