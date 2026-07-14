# P1-002：Terraform cloud foundation

狀態：`ready`  
目標：將現有 Terraform 骨架提升為可審查、可重複部署的 Phase 1 cloud foundation。

## Scope

- 驗證 bootstrap 與 dev/stg/prod state 隔離。
- 完成 APIs、Artifact Registry、VPC、Cloud SQL、GCS、Tasks、Scheduler、Identity Platform、Secret containers、service accounts、Cloud Run contract。
- 新增 budget/monitoring 最小告警，或以 ADR 說明由 organization policy 管理。
- 建立 GitHub Workload Identity Federation，禁止長效 service-account key。

## Security and authorization

- runtime 使用獨立 service account 與最小 IAM；worker 不公開。
- state bucket 啟用 versioning、uniform access、public prevention；prod destructive resources 有 protection。
- secret 值不由 Terraform state 管理。

## Tests and observability

- `terraform fmt -check -recursive`、每個 root `init -backend=false`、`validate`。
- 使用 mock/example variables 產生 dev plan；若無 GCP 權限，記錄未執行的 provider-level 驗證。
- 加入 tfsec/Trivy config scan 或等價檢查。

## Acceptance criteria

- 三環境無 hard-coded credential，state 與 project 不交叉。
- `deploy_runtime=false` 可先建立 foundation；true 時強制三個 immutable image references。
- runbook 包含 bootstrap、plan/apply approval、secret、rollback 與 drift 處理。
- 未經明確批准不得 apply；工作報告需區分 validated 與 actually deployed。
