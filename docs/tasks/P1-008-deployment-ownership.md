# P1-008：Deployment ownership and scheduler safety

狀態：`done`

## 目標

消除 Terraform 與 CD 同時管理 Cloud Run image 的回滾風險，並確保尚未實作的 notification dispatcher 不會在 Phase 1 runtime provisioning 時自動啟用。

## 範圍

- 以 ADR 定義 Terraform 與 GitHub Actions 的 Cloud Run ownership。
- Terraform 只忽略 service/job 的 image 欄位，其餘 runtime 設定維持 declarative reconciliation。
- 新增預設關閉且依賴 runtime 的 Scheduler feature gate。
- dev/stg/prod 明確傳遞 flag，範例值一律關閉。
- 新增 mocked Terraform tests 與 static release-contract tests。
- 更新 CI/deployment/Terraform runbooks、gap audit 與 worklog。

## 驗收條件

- [x] Terraform 建立 runtime 時仍強制三個 bootstrap images 使用 immutable digest。
- [x] 後續 Terraform plan 不管理 service/job image，且沒有忽略整個 template/resource。
- [x] `deploy_runtime=true` 不會隱式建立 notification Scheduler job。
- [x] `enable_notification_dispatcher=true` 且 runtime 關閉時 plan validation 失敗。
- [x] 三環境 example 皆明確保持 dispatcher 關閉。
- [x] Terraform fmt/validate/test、release/isolation contract 與文件格式通過。

## 非目標

- 不實作 `/internal/notifications/dispatch` 或通知業務。
- 不執行 Terraform apply、Cloud Run deploy 或 Scheduler 建立。
- 不更動 GCP、GitHub Environment、LINE 或 production 設定。

## 驗證結果

- Terraform 1.15.8／Google provider 6.50.0：bootstrap、module、dev、stg、prod readonly init/validate 全數通過。
- Mocked Terraform tests 5/5：foundation default-off、image validation、private runtime、invalid dispatcher combination、explicit dispatcher activation。
- Release ownership static tests 3/3，live checker 與 environment isolation checker 通過。
- Trivy Terraform HIGH/CRITICAL 0；full repository Prettier 與 `git diff --check` 通過。
