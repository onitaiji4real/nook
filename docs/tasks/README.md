# Codex 垂直任務

狀態：`ready` 可開始、`blocked` 等待依賴、`in_progress` 執行中、`done` 已驗收。

| ID     | 任務                       | 狀態  | 依賴                            |
| ------ | -------------------------- | ----- | ------------------------------- |
| P1-001 | Repository foundation      | done  | 無                              |
| P1-002 | Terraform cloud foundation | done  | GCP 外部資訊僅在 apply 時需要   |
| P1-003 | Tenant onboarding and RBAC | done  | P1-001                          |
| P1-004 | LINE login exchange        | done  | P1-003                          |
| P1-005 | CI/CD and observability    | ready | P1-001、P1-002 runtime contract |

## 接手規則

1. 一次只接一個任務；更新狀態與 `docs/worklog.md`。
2. 先確認依賴已完成，不在任務內偷渡後續產品功能。
3. schema、domain/application、contract、authorization、tests、observability、docs 均須明確處理；不適用者需記錄理由。
4. 完成時附上執行過的命令與結果、變更檔案、未決風險。
