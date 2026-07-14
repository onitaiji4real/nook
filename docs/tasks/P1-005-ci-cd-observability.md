# P1-005：CI/CD and observability

狀態：`done`（本機實作與可重現 gates 完成；外部環境證據列於 Phase 1 acceptance evidence）
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

## Handoff

- 本機與 CI contract 已完成：workspace quality/tests/build、Terraform mock/isolation、production dependency audit、三個 distroless image build/nonroot/smoke/scan，以及獨立 migration job 命令皆通過。
- 2026-07-14 completion audit 將 web probes 接上 correlation/structured logging，並統一 HTTP request log 的 `operation` 與 `outcome`；4xx/5xx 均標記 failure，只有 5xx 提升為 ERROR。
- `P1-E01`、`P1-E04`～`P1-E07` 仍需要 GitHub/GCP 管理權限與 staging 實際證據；這些 gate 維持 `BLOCKED`，不可用本機驗證替代。
- repository admin 下一步先設定 required checks 與 `prod` Environment reviewer；platform owner 再依 `docs/runbooks/deployment.md` 執行 staging deploy、rollback 與 alert notification 演練。
