# Terraform

- `bootstrap/`: 一次性建立 dev/stg/prod projects 與各自的 versioned state bucket。
- `modules/platform/`: 共用 GCP 平台模組。
- `environments/{dev,stg,prod}/`: 各環境獨立 state 與參數。

只提交 `.tfvars.example`/`backend.hcl.example`。實際值、state、plan 與 credentials 禁止進 Git。操作程序見 `docs/runbooks/terraform.md`。

本機驗證：

```bash
infra/terraform/scripts/validate.sh
trivy config --exit-code 1 --severity HIGH,CRITICAL infra/terraform
```

驗證腳本不執行 plan/apply，也不建立 GCP 資源。Terraform provider lockfile 目前依 repository policy 不提交；CI 必須重新執行 init 並驗證實際解析版本。
