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
- 2026-07-15 遠端驗收已建立 active `main` ruleset #18939233，將 verify、terraform 與三個 container contexts 設為 strict required checks；`stg`/`prod` Environments 只允許 `main`，`prod` 要求 reviewer。
- Draft PR [#1](https://github.com/onitaiji4real/nook/pull/1) 的 pull_request [CI run #3](https://github.com/onitaiji4real/nook/actions/runs/29348356639) 五個 jobs 全數成功，因此 `P1-E01` 已 `PASS`。
- `P1-E04`～`P1-E07` 仍需 GCP staging deploy、production approval wait、rollback 與 applied observability 的實際證據；不可以 GitHub 設定讀回或本機驗證取代。
- platform owner 下一步依 `docs/runbooks/deployment.md` 執行 staging deploy、未批准 production wait、rollback 與 alert notification 演練；在這些 gate 完成前 PR 維持 draft，不合併 `main`。
