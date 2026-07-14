# Terraform 操作 Runbook

## 安全界線

Terraform 可能建立付費資源。本 repo 的初始交付只做靜態檢查；任何 `apply` 前必須由環境 owner 審查 plan、帳務與 deletion protection。production apply 需要人工批准。

## 前置需求

- Terraform >= 1.7、gcloud CLI 與 Application Default Credentials。
- 可建立 project、綁定 billing、管理 IAM 與 GCS 的權限。
- 一個既有 seed project，以及 organization 或 folder ID。

## Bootstrap

1. 複製 `infra/terraform/bootstrap/terraform.tfvars.example` 為不追蹤的 `terraform.tfvars`。
2. 在 bootstrap 目錄執行 `terraform init`、`terraform fmt -check`、`terraform validate`。
3. 產生 saved plan，確認只包含三個 project、Storage API 與三個 state bucket。
4. 經 owner 批准後 apply。保存 outputs，並把 bootstrap local state 遷移到受保護的管理 backend；在此之前不可刪除工作站 state。

## Environment

以 dev 為例：

1. 複製 `backend.hcl.example` 與 `terraform.tfvars.example`，填入 bootstrap outputs。
2. `terraform init -backend-config=backend.hcl`。
3. `terraform fmt -check -recursive` 與 `terraform validate`。
4. `terraform plan -out=dev.tfplan`；確認 project 與 environment 無誤。
5. 初次保持 `deploy_runtime=false`，先建立 foundation。
6. 映像檔以 digest 發布後填入三個 `container_images`，再啟用 runtime。

## Secret 與 database

Terraform 只建立 Secret Manager container，不提交 secret version。secret 值由經批准的 secret workflow 寫入。PostGIS extension 由 Prisma SQL migration 建立；不得手動修改 production schema。

## Rollback 與事故

- 不以 `terraform destroy` 做 rollback。
- Cloud Run 以先前 image digest 回退流量。
- Database 依 expand-and-contract 回退應用；不可直接倒退 destructive migration。
- state lock、drift 或意外刪除計畫出現時停止 apply，將 plan 與時間記入 `docs/worklog.md`。
