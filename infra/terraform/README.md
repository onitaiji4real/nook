# Terraform

- `bootstrap/`: 一次性建立 dev/stg/prod projects 與各自的 versioned state bucket。
- `modules/platform/`: 共用 GCP 平台模組。
- `environments/{dev,stg,prod}/`: 各環境獨立 state 與參數。

提交各 Terraform root 的 `.terraform.lock.hcl` 與 `.tfvars.example`/`backend.hcl.example`。實際值、state、plan 與 credentials 禁止進 Git。操作程序見 `docs/runbooks/terraform.md`。

本機驗證：

```bash
infra/terraform/scripts/validate.sh
trivy config --exit-code 1 --severity HIGH,CRITICAL infra/terraform
```

驗證腳本不執行 plan/apply，也不建立 GCP 資源。bootstrap、module、dev/stg/prod 各自提交 provider lockfile；validation 使用 readonly mode，禁止 CI 靜默改寫 provider selection。

Cloud Run ownership 依 [ADR 0004](../../docs/adr/0004-cloud-run-release-ownership.md) 分工：Terraform 建立 service/job 並管理 image 以外的 runtime configuration，GitHub Actions 管理後續 image revisions。Notification Scheduler 預設不建立；只有 dispatcher endpoint、authentication、idempotency 與 staging smoke 完成後，才能另行核准 `enable_notification_dispatcher=true`。

Cloud Billing budget ownership 依 [ADR 0005](../../docs/adr/0005-cloud-billing-budget-ownership.md)：每個環境可管理一個 project-scoped 月預算，`project_budget` 預設為 `null`。Billing account、幣別與月額必須由 owner 核准後才放入未追蹤的 tfvars；budget 是告警，不是費用上限，也不會自動停止服務。

LINE exchange rate limit 依 [ADR 0006](../../docs/adr/0006-line-auth-rate-limit.md)：`line_auth_rate_limit` 會把 bounded global/token/window/TTL 設定注入 API，實際 counter 由既有 PostgreSQL 共享。此控制不是 per-IP edge policy，不能取代正式上線前的 Cloud Armor 工作。

# Media pipeline activation

受控圖片pipeline採兩階段啟用：第一次維持`enable_media_pipeline=false`建立private worker；取得Terraform output中的worker HTTPS URI後，把它填入`media_worker_url`、設定browser exact origin於`media_cors_origins`，再設`enable_media_pipeline=true`重新plan/apply。API與worker才會收到`MEDIA_STORAGE_MODE=gcp`。不要自行猜Cloud Run URL，也不要把signed fields或credential寫進tfvars。
