# ADR 0005：Cloud Billing budget ownership

狀態：Accepted
日期：2026-07-21

## Context

Phase 1 要求最小成本告警，但 repository 原本只啟用 Billing Budgets API，沒有 budget resource，也沒有說明由哪一層管理。直接猜測 billing account、幣別或月額會把未經 owner 核准的商業決策寫進 infrastructure；完全留白則會讓首次部署沒有成本 guardrail。

Cloud Billing budget 只會追蹤估算成本並發送告警，不會限制費用或自動停止服務。自動停用 billing 可能造成正式服務中斷，且需要額外 Pub/Sub、授權、冪等與事故復原設計。

## Decision

- 每個 environment Terraform state 管理該 GCP project 的一個月預算；budget 必須以 project number 限定範圍，不建立涵蓋整個 billing account 的共享 budget。
- `project_budget` 預設為 `null`。只有 billing owner 明確提供 account ID、與該 billing account 相同的 ISO 4217 幣別、正整數月額及門檻後才建立。
- 預設門檻是目前實際支出的 50%、80%、100%；owner 可在 apply input 顯式覆寫。成本計算包含 credits。
- 保留 Billing Account Administrators／Users 的預設 email recipients；若提供既有 Monitoring notification channels，budget 會一併使用。tfvars 只保存 channel resource name，不保存 email、token 或 webhook secret。
- Resource 使用 `prevent_destroy`。將 input 改回 `null` 會被 Terraform 阻止；任何移除或重建都必須有 owner-reviewed change 與 saved plan。
- Phase 1 不建立自動停用 billing、關閉服務或其他 programmatic action。若未來需要，必須另建 ADR 與具 fail-safe／recovery 的垂直任務。

## Consequences

- Repository 可以驗證 budget 的範圍與安全預設，但沒有 owner input 時不會建立資源，也不能宣稱雲端告警已生效。
- 幣別由 Cloud Billing account 決定；即使格式正確，錯誤幣別仍會在 provider apply 被拒絕，因此 saved plan/apply 前必須由 billing owner 核對。
- 預算告警不是 hard cap，通知也可能受成本資料延遲影響；on-call 必須依 runbook 人工處置。
- 真實 apply 需要 Billing Account Costs Manager／Administrator 等適當權限，並需驗證 threshold email／Monitoring channel delivery。
