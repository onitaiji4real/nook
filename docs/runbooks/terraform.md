# Terraform 操作 Runbook

## 安全界線

Terraform 可能建立付費資源。本 repo 的初始交付只做靜態檢查；任何 `apply` 前必須由環境 owner 審查 plan、帳務與 deletion protection。production apply 需要人工批准。

## 前置需求

- Terraform >= 1.7、gcloud CLI 與 Application Default Credentials。
- 可建立 project、綁定 billing、管理 IAM 與 GCS 的權限。
- 一個既有 seed project，以及 organization 或 folder ID。
- 各 Terraform root 的 `.terraform.lock.hcl` 必須存在，且包含本機 `darwin_arm64` 與 CI `linux_amd64` 的已簽署 provider checksum。

## Bootstrap

1. 複製 `infra/terraform/bootstrap/terraform.tfvars.example` 為不追蹤的 `terraform.tfvars`。
2. 在 bootstrap 目錄執行 `terraform init -lockfile=readonly`、`terraform fmt -check`、`terraform validate`。
3. 產生 saved plan，確認只包含三個 project、Storage API 與三個 state bucket。
4. 經 owner 批准後 apply。保存 outputs，並把 bootstrap local state 遷移到受保護的管理 backend；在此之前不可刪除工作站 state。

## Environment

以 dev 為例：

1. 複製 `backend.hcl.example` 與 `terraform.tfvars.example`，填入 bootstrap outputs。
2. `terraform init -lockfile=readonly -backend-config=backend.hcl`。
3. `terraform fmt -check -recursive` 與 `terraform validate`。
4. `terraform plan -out=dev.tfplan`；確認 project 與 environment 無誤。
5. 初次保持 `deploy_runtime=false`，先建立 foundation。
6. 映像檔以 digest 發布後填入三個 `container_images`，再啟用 runtime；這些值只用於首次建立或重建 resource。

每個環境必須填入 `github_repository`。模組會建立該環境專用的 GitHub deployer service account、Workload Identity Pool/Provider，並同時限制 `assertion.repository` 與 GitHub Environment (`dev`、`stg` 或 `prod`)。workflow 必須宣告對應 environment，不能以 branch claim 取代 environment approval。

`deploy_runtime=true` 時 `container_images` 必須剛好包含 web、api、worker，且每個值都以 `@sha256:<64 hex>` 結尾；tag 或缺項會在 plan 前由 variable validation 拒絕。worker 只允許 internal ingress，web/api 才有 public invoker。Terraform 同時建立獨立 migration job；application startup 不會自動執行 migration。

依 ADR 0004，Terraform 管理 Cloud Run resources 與 image 以外的 runtime configuration，GitHub Actions 管理後續 service/job image revisions。`lifecycle.ignore_changes` 只涵蓋 container image；若 plan 顯示 image 以外的 template drift，仍須審查原因，不得擴大 ignore 範圍使 plan 變乾淨。

`enable_notification_dispatcher` 預設為 `false`，Phase 1 保持關閉。只有 worker 已提供經 OIDC 驗證、具 idempotency 與 retry tests 的 `/internal/notifications/dispatch`，並取得 staging smoke evidence 與 owner 核准後，才能設定為 `true`；未啟用時 Terraform 不建立 Scheduler job。

`api_cors_allowed_origins` 是 API 的 exact browser-origin allowlist。空 list 代表安全地拒絕所有 cross-origin browser access；取得 Web URL 或 custom domain 後，以 scheme、host、optional port 的完整 origin 加入，不能包含 path、wildcard、credential 或重複值。Production 只接受 HTTPS。CORS 不使用 cookie credentials，API authentication 仍透過 bearer token。

`line_auth_rate_limit` 明確注入 API 的 PostgreSQL fixed-window policy。Phase 1 預設 global 120/min、相同 token fingerprint 5/min、window 60 秒、bucket TTL 600 秒；TTL 不得短於 window。這些值必須以 staging load/abuse與 provider quota evidence 調整，不得為排除 429 任意提高。它不是 per-IP policy，正式大量導流前仍須補 External Application Load Balancer／Cloud Armor 或等效可信 edge。

`project_budget` 預設為 `null`，因此不建立 Cloud Billing budget。依 ADR 0005，billing owner 必須為每個環境核准 billing account ID、該 account 的幣別、整數月額與 threshold percentages，並把值寫入未追蹤的 tfvars。預設門檻為 50%、80%、100% current spend；Budget 只涵蓋該 environment project 且包含 credits。它只發告警，不會限制支出或停止服務。

Budget 保留 Billing Account Administrators／Users 的預設 email recipients，並沿用 `monitoring_notification_channels` 中最多五個完整 channel resource names。不要把 email、webhook token 或其他 secret 放入 tfvars。Resource 有 `prevent_destroy`；改回 `null` 或重建若產生 delete plan，必須停止並由 billing owner 另行核准，不得用 target 或 state 操作繞過。

Cloud Run startup probe 必須呼叫 application readiness：Web `/api/readiness`、API/worker `/ready`。Cloud Run 在 startup probe 成功後即可送流量，因此不能退回只檢查 port 的 TCP probe。Liveness 維持 Web `/api/health`、API/worker `/health`，避免短暫 dependency failure 造成不必要 restart。Private worker 不需開 public ingress；Cloud Run probe 在 instance 內驗證 readiness，deployment workflow 再讀 revision Ready condition。

## Validation

不需要 GCP credentials 的完整驗證：

```bash
infra/terraform/scripts/validate.sh
trivy config --exit-code 1 --severity HIGH,CRITICAL infra/terraform
```

`validate.sh` 會對 bootstrap、platform module、dev/stg/prod 執行 `init -backend=false -lockfile=readonly`、`validate`，再執行 mocked Terraform tests 與環境隔離檢查。若 provider constraint 或 checksum 與 committed lockfile 不一致，驗證會停止。這些結果只證明 configuration contract，不代表 provider plan 或 cloud apply 已成功。

經 ADR/依賴審查要升級 provider 時，在五個 root 執行 `terraform providers lock -platform=darwin_arm64 -platform=linux_amd64`，審查版本與 checksum diff，重跑完整 validation 後再提交；不得在一般 CI run 自動更新 lockfile。

取得 GCP 權限後，每個環境另執行 saved plan，並使用以下 checklist：

- plan 的 provider project、module environment、state bucket/prefix 完全對應目標環境。
- 沒有 service-account key、secret version 或 secret value。
- foundation plan 在 `deploy_runtime=false` 時沒有 Cloud Run service。
- runtime resource 首次建立或重建所用的三個 images 全為已掃描且不可變的 digest。
- plan 不會把 CD 已發布的 service/job image 改回 bootstrap digest，且 image 以外的 runtime drift 仍可見。
- notification dispatcher 保持關閉，除非 endpoint/authentication/idempotency/staging evidence 已另行驗收。
- Cloud Tasks producer沒有project-wide enqueuer：media啟用時API只綁media queue，LINE notification啟用時worker只綁notification queue；兩者的automation invoker actAs也只在對應feature啟用時存在。
- API CORS origins 與該環境實際 Web URL 完全一致；production 沒有 HTTP、wildcard、path 或跨環境 origin。
- 三服務 startup probe 是 HTTP application readiness path，liveness 仍是 health path；worker 保持 private。
- worker 無 public invoker；web/api public exposure 符合核准範圍。
- Cloud SQL 無 public IPv4、強制 encrypted connection，prod 為 REGIONAL 且 deletion protection 開啟。
- WIF condition 同時限制 `onitaiji4real/nook` 與目標 GitHub Environment。
- 5xx alert policy 有 2% ratio、1 request/minute floor、platform-oncall owner、HTTPS runbook 與核准的 notification channel。
- `project_budget` 若啟用，billing account／幣別／月額由 owner 核准，filter 只含目標 project，預設 IAM recipients 未停用，且沒有任何自動停用 billing 的 action。
- API 收到四個 `line_auth_rate_limit` env values，limits/TTL 符合 application bounds；database migration 已先於新 revision 執行，避免 auth path 因 bucket table不存在而 503。

## Secret 與 database

Terraform 只建立 Secret Manager container，不提交 secret version。secret 值由經批准的 secret workflow 寫入；API、worker 與 migration job 只能讀 database URL。LINE channel ID 與 Identity Platform project/service account ID 不是 secret；目前 ID token verify flow 不讀取 channel secret。Cloud Run 使用 `latest` secret version reference，但 rollout 前仍須確認目標 version 已啟用。

Cloud SQL 只使用 private IP 並設為 `ENCRYPTED_ONLY`；注入的 database URL 必須啟用 TLS。PostGIS extension 由 Prisma SQL migration 建立；不得手動修改 production schema。

## Monitoring

每個環境會建立 Cloud Run request/5xx service-health dashboard 與 5xx ratio alert，兩者都標示 platform-oncall 與 deployment runbook。Alert 以同一 service 的 5xx request_count 除以全部 request_count；ratio 嚴格大於 2% 且同一服務流量持續高於 1 request/minute 五分鐘才 paging。低於 floor 的錯誤仍可由 dashboard/log 檢查；missing data/scale-to-zero 不觸發。

Notification channel 只接受既有 resource name；不得將 email、webhook token 或其他敏感值放入 tfvars/state。沒有 channel 時 policy 仍可建立，但 apply approval checklist 必須記錄由誰補上通知路由。首次 staging apply 後需以 synthetic traffic 分別驗證低流量不 page、超過 floor 且 5xx >2% 會 page、恢復後 incident 關閉；static/mock test 不替代 P1-E07 evidence。

Cloud Billing budget threshold 觸發後也必須驗證 Billing IAM email 與每個 Monitoring channel 的 delivery。成本資料是估算值且可能延遲；budget alert 不是 hard cap。若要新增 Pub/Sub 或自動成本處置，先建立獨立 ADR、權限模型、冪等與復原演練，不得直接在既有 budget 上接 destructive action。

## Rollback 與事故

- 不以 `terraform destroy` 做 rollback。
- Cloud Run 以先前 image digest 回退流量。
- Database 依 expand-and-contract 回退應用；不可直接倒退 destructive migration。
- state lock、drift 或意外刪除計畫出現時停止 apply，將 plan 與時間記入 `docs/worklog.md`。
- drift review 只能使用 read-only refresh/plan；禁止為了讓 plan 變乾淨而直接修改 production resource 或 state。
- Image revision 由 release workflow 管理；在 Terraform state/plan 中看不到 image drift 是預期行為，實際 digest 需由 Cloud Run revision 與 deployment evidence 稽核。
