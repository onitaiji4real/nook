# P1-010：Deployment application readiness

狀態：`done`

## 目標

在 candidate revision 切入流量前驗證 Web、API、worker 的 application readiness，而不把 private worker 暫時公開或把 process/Cloud Run control-plane Ready 誤當成 dependency readiness。

## 範圍

- Cloud Run 三服務 startup probe 改呼叫各自 application readiness endpoint。
- `/health` 保留作 liveness，只代表 process 可服務。
- Deployment script 對 public Web/API candidate URL 直接呼叫 readiness。
- Private worker 由 Cloud Run 內部 startup probe 驗證 `/ready`，release 再確認 revision Ready condition。
- 新增 Terraform assertion、deployment static negative tests 與 live checker。
- 更新 CI/Terraform/deployment runbooks、gap audit 與 worklog。

## 驗收條件

- [x] Web startup probe 使用 `/api/readiness`；API/worker 使用 `/ready`。
- [x] 三服務 liveness 繼續使用不依賴外部系統的 health endpoint。
- [x] Web/API candidate readiness failure 在 promotion 前中止並觸發既有 rollback trap。
- [x] Worker `/ready` failure 使 Cloud Run startup/revision 無法 Ready，promotion 前會被拒絕。
- [x] Static negative tests 阻擋 TCP-only startup、health-only smoke 與 worker check 移到 promotion 後。
- [x] Terraform fmt/validate/test、architecture/workflow checks、Trivy、format 與 shell syntax 通過。

## 非目標

- 不把 worker 改成 public ingress。
- 不新增 Cloud Run probe job、Load Balancer 或第三方 synthetic monitoring。
- 不執行 staging/production deployment；真實 revision failure/rollback 仍屬外部 gate。

## 驗證結果

- Terraform 五個 configuration readonly validate、7 個 mocked tests 與 environment/release ownership checks 通過。
- Deployment readiness negative tests 3/3；repository/env tests 合計 11/11，live repository/workflow/readiness checkers 通過。
- `bash -n`、Terraform fmt、Trivy HIGH/CRITICAL 0、full repository Prettier 與 `git diff --check` 通過。
- 未執行真實 Cloud Run deploy；P1-E04 維持 `BLOCKED`，需 staging workflow 證明 probe failure 會停止 promotion/rollback。
