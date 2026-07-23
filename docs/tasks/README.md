# Codex 垂直任務

狀態：`ready` 可開始、`blocked` 等待任務依賴、`in_progress` 執行中、`done` 表示該任務 acceptance criteria 已由 repository／local evidence 驗證。`done` 不代表 Phase 1 或外部 GCP／LINE／deployment gates完成；整體狀態只以 `docs/phase-1/acceptance-evidence.md` 為準。

| ID      | 任務                         | 狀態 | 依賴                            |
| ------- | ---------------------------- | ---- | ------------------------------- |
| P1-001  | Repository foundation        | done | 無                              |
| P1-002  | Terraform cloud foundation   | done | GCP 外部資訊僅在 apply 時需要   |
| P1-003  | Tenant onboarding and RBAC   | done | P1-001                          |
| P1-004  | LINE login exchange          | done | P1-003                          |
| P1-005  | CI/CD and observability      | done | P1-001、P1-002 runtime contract |
| P1-006  | Local development env        | done | P1-001                          |
| P1-007  | User status revocation       | done | P1-003、P1-004                  |
| P1-008  | Deployment ownership         | done | P1-002、P1-005                  |
| P1-009  | API CORS allowlist           | done | P1-001、P1-005                  |
| P1-010  | Deployment readiness         | done | P1-002、P1-005                  |
| P1-011  | Firebase error mapping       | done | P1-004、P1-007                  |
| P1-012  | Cloud Run 5xx ratio          | done | P1-002、P1-005                  |
| P1-013  | Required format gate         | done | P1-001、P1-005                  |
| P1-014  | Cloud Billing budget guard   | done | P1-002、owner inputs at apply   |
| P1-015  | LINE auth rate limit         | done | P1-004、P1-006                  |
| P1-016  | Local dev startup order      | done | P1-006                          |
| P1-017  | Audit lifecycle contract     | done | P1-003                          |
| MKT-001 | Service introduction site    | done | Product plan、P1-001            |
| P2-001  | Merchant onboarding slice    | done | P1-003、MKT-001                 |
| P2-002  | Service catalog entitlements | done | P2-001                          |
| P2-003  | Staff and availability       | done | P2-002                          |
| P2-004  | Portfolio controlled upload  | done | P2-003                          |
| P2-005  | Public merchant publication  | done | P2-004                          |
| P2-006  | Browser identity and storage | done | P2-005                          |
| P3-001  | Availability engine          | done | P2-003、P2-005                  |
| P3-002  | Booking hold and occupancy   | done | P3-001                          |
| P3-003  | Appointment confirmation     | done | P3-002                          |
| P3-004  | Appointment views & calendar | done | P3-003                          |
| P3-005  | Appointment lifecycle        | done | P3-004                          |
| P3-006  | Reminders & LINE notifications | in_progress | P3-005                      |
| P3-007  | Merchant LINE entry & RWD operations | blocked | P3-006                  |

## 接手規則

1. 一次只接一個任務；更新狀態與 `docs/worklog.md`。
2. 先確認依賴已完成，不在任務內偷渡後續產品功能。
3. schema、domain/application、contract、authorization、tests、observability、docs 均須明確處理；不適用者需記錄理由。
4. 完成時附上執行過的命令與結果、變更檔案、未決風險。
5. Task 標為 `done` 後仍須查閱 Phase 1 acceptance evidence；不得把 local/static proof 延伸為 external gate 通過。
