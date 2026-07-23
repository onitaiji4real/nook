# Booking hold expiry runbook

## Repository and local verification

Lazy cleanup 是 correctness path：即使沒有 scheduler，create transaction 仍會在 insert 前把候選 staff 的已到期 ACTIVE hold／occupancy轉為 EXPIRED。Worker job 只降低 stale rows 與查詢成本；scheduler 延誤不得造成永久無法預約。

本機可在 worker 執行時呼叫 private-operation contract：

```bash
curl -i -X POST \
  -H 'x-cloudscheduler: true' \
  -H 'x-request-id: local-expiry-check' \
  http://localhost:8081/internal/booking-holds/expire
```

這只驗證 handler，不代表 cloud authentication。缺少 scheduler marker 應回 403；連續執行應只在第一次回傳正數，之後對相同資料回 0。

## Staging activation gate

目前 Terraform 不自動建立 hold expiry Scheduler job。啟用前必須：

1. 部署含 `/internal/booking-holds/expire` 的 worker revision，保持 `INGRESS_TRAFFIC_INTERNAL_ONLY`。
2. 使用既有 automation invoker service account，確認只有它具 worker `roles/run.invoker`。
3. Scheduler 使用 POST、worker Cloud Run URI 作 OIDC audience，並加 `x-cloudscheduler: true`。建議每分鐘執行；batch 固定 100，Scheduler retry 不得改成並行 fan-out。
4. 在 staging 以真實 Google-signed OIDC 證明 2xx；無 token、錯 audience、非 automation identity 與只偽造 header 都必須拒絕。
5. 觀察 expired count、operation failure、worker 5xx 與 booking hold 409 比例，再由 owner 核准 production。

不得把 service-account key、OIDC token、database URL 或 Terraform state 寫入 repository／worklog。若 scheduler 連續失敗，先修 IAM／audience／ingress；不要把 worker 改成 public，也不要移除 lazy cleanup。
