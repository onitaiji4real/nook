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

每個環境必須填入 `github_repository`。模組會建立該環境專用的 GitHub deployer service account、Workload Identity Pool/Provider，並同時限制 `assertion.repository` 與 GitHub Environment (`dev`、`stg` 或 `prod`)。workflow 必須宣告對應 environment，不能以 branch claim 取代 environment approval。

`deploy_runtime=true` 時 `container_images` 必須剛好包含 web、api、worker，且每個值都以 `@sha256:<64 hex>` 結尾；tag 或缺項會在 plan 前由 variable validation 拒絕。worker 只允許 internal ingress，web/api 才有 public invoker。Terraform 同時建立獨立 migration job；application startup 不會自動執行 migration。

## Validation

不需要 GCP credentials 的完整驗證：

```bash
infra/terraform/scripts/validate.sh
trivy config --exit-code 1 --severity HIGH,CRITICAL infra/terraform
```

`validate.sh` 會對 bootstrap、platform module、dev/stg/prod 執行 `init -backend=false`、`validate`，再執行 mocked Terraform tests 與環境隔離檢查。這些結果只證明 configuration contract，不代表 provider plan 或 cloud apply 已成功。

取得 GCP 權限後，每個環境另執行 saved plan，並使用以下 checklist：

- plan 的 provider project、module environment、state bucket/prefix 完全對應目標環境。
- 沒有 service-account key、secret version 或 secret value。
- foundation plan 在 `deploy_runtime=false` 時沒有 Cloud Run service。
- runtime plan 的三個 images 全為已掃描且不可變的 digest。
- worker 無 public invoker；web/api public exposure 符合核准範圍。
- Cloud SQL 無 public IPv4、強制 encrypted connection，prod 為 REGIONAL 且 deletion protection 開啟。
- WIF condition 同時限制 `onitaiji4real/nook` 與目標 GitHub Environment。
- 5xx alert policy 有 platform-oncall owner、HTTPS runbook 與核准的 notification channel。

## Secret 與 database

Terraform 只建立 Secret Manager container，不提交 secret version。secret 值由經批准的 secret workflow 寫入；API、worker 與 migration job 只能讀 database URL。LINE channel ID 與 Identity Platform project/service account ID 不是 secret；目前 ID token verify flow 不讀取 channel secret。Cloud Run 使用 `latest` secret version reference，但 rollout 前仍須確認目標 version 已啟用。

Cloud SQL 只使用 private IP 並設為 `ENCRYPTED_ONLY`；注入的 database URL 必須啟用 TLS。PostGIS extension 由 Prisma SQL migration 建立；不得手動修改 production schema。

## Monitoring

每個環境會建立 Cloud Run request/5xx service-health dashboard 與 5xx rate alert，兩者都標示 platform-oncall 與 deployment runbook。notification channel 只接受既有 resource name；不得將 email、webhook token 或其他敏感值放入 tfvars/state。沒有 channel 時 policy 仍可建立，但 apply approval checklist 必須記錄由誰補上通知路由。

## Rollback 與事故

- 不以 `terraform destroy` 做 rollback。
- Cloud Run 以先前 image digest 回退流量。
- Database 依 expand-and-contract 回退應用；不可直接倒退 destructive migration。
- state lock、drift 或意外刪除計畫出現時停止 apply，將 plan 與時間記入 `docs/worklog.md`。
- drift review 只能使用 read-only refresh/plan；禁止為了讓 plan 變乾淨而直接修改 production resource 或 state。
