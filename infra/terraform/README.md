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
