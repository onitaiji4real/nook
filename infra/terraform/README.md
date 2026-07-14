# Terraform

- `bootstrap/`: 一次性建立 dev/stg/prod projects 與各自的 versioned state bucket。
- `modules/platform/`: 共用 GCP 平台模組。
- `environments/{dev,stg,prod}/`: 各環境獨立 state 與參數。

只提交 `.tfvars.example`/`backend.hcl.example`。實際值、state、plan 與 credentials 禁止進 Git。操作程序見 `docs/runbooks/terraform.md`。
