# ADR 0004：Cloud Run release ownership

狀態：Accepted
日期：2026-07-21

## Context

Terraform 以 immutable digest 建立 Cloud Run web、API、worker 與 migration job，但 GitHub Actions 也會在每次 release 更新相同 resources 的 image。若兩者都持續宣告 image 的最新值，後續 Terraform apply 可能把已發布版本改回 bootstrap digest。

此外，Terraform 原本在 `deploy_runtime=true` 時同步建立每分鐘呼叫 `/internal/notifications/dispatch` 的 Scheduler job；Phase 1 worker 尚未提供該 endpoint，因此首次 runtime apply 會產生持續 404、重試、告警噪音與非必要成本。

## Decision

- Terraform 是 Cloud Run service/job existence、IAM、network、service account、environment、probe、scaling 與其他 runtime configuration 的唯一宣告來源。
- GitHub Actions release workflow 是 service 與 migration job image revision 的唯一更新來源。Terraform 仍要求 bootstrap images 使用 digest，供首次 resource creation 使用。
- Terraform 只對 service container image 與 migration job container image 使用窄範圍 `lifecycle.ignore_changes`；不得忽略整個 `template` 或 resource。
- Notification dispatcher 使用 `enable_notification_dispatcher` 顯式 feature gate，預設 `false`，且只有 `deploy_runtime=true` 時才能開啟。
- 啟用 dispatcher 前必須完成 authenticated worker endpoint、OIDC audience 驗證、idempotency、retry behavior、integration tests 與 staging smoke evidence；這些工作不屬於 Phase 1。

## Consequences

- 一般 Terraform plan 不會因 CD 發布新 image 而提出回滾 revision，但仍會偵測並修正 image 以外的 runtime configuration drift。
- `container_images` 不是後續 release 的期望版本紀錄；release digest、revision 與 workflow URL 必須保存於 deployment evidence/worklog。
- 若 resource 需重建，Terraform 會使用當次核准 tfvars 中的 digest 建立第一個 revision，因此 apply 前仍須確認該 digest 可用、已掃描且符合目標環境。
- Dispatcher 在 Phase 1 runtime 部署時不存在是預期狀態，不代表通知功能已完成。啟用旗標需另行審查與 owner 核准。
