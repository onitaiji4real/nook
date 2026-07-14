# P1-005：CI/CD and observability

狀態：`blocked`（等待 P1-001 與 P1-002 runtime contract）  
目標：每個變更可被自動驗證，main 可安全部署 staging，production 需要批准。

## Vertical slice

- PR CI：frozen install、lint、typecheck、unit/integration、build、Terraform fmt/validate、dependency/container scan。
- Build：web/api/worker multi-stage images，使用 commit SHA/digest，不用 mutable latest 作部署依據。
- Auth：GitHub OIDC/WIF；staging/prod service account 分離，production 綁 GitHub Environment approval。
- Deploy：migration job 先做 backward-compatible migration，再逐一部署與 smoke test；production 支援 traffic split/rollback。
- Observability：JSON log schema、request correlation、service/version/environment、redaction；health dashboard 和 Phase 1 5xx 告警。
- Documentation：CI contract、deployment/rollback runbook、required branch protection checks。

## Tests

- workflow lint 與最小權限檢查。
- image 在非 root 使用者執行，含 healthcheck/smoke test。
- failed migration/smoke test 中止 deployment；不自動推進 production。
- synthetic secret/PII 不出現在 captured logs 或 workflow artifacts。

## Acceptance criteria

- PR 所有 required checks 可重現；integration DB 為 ephemeral PostgreSQL/PostGIS。
- merge main 完成 staging deploy + smoke test；production 僅在人工批准後執行。
- rollback 已在 staging 演練並記錄；dashboard/alerts 有 owner 與處置連結。
