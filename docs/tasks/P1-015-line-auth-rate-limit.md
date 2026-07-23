# P1-015：LINE auth exchange rate limit

狀態：`done`

## 目標

為公開 LINE token exchange 建立跨 Cloud Run instances 一致、無 raw token／IP 儲存、可觀測且 fail-closed 的 Phase 1 rate limit，降低 provider quota 與成本放大風險。

## 範圍

- PostgreSQL fixed-window bucket schema、expand migration 與原子 repository。
- Environment-global 與 token SHA-256 fingerprint 兩層限制。
- Startup/Terraform bounded config、429 Problem Details 與 `Retry-After`。
- Bucket TTL cleanup、database failure 503 與 provider-call suppression。
- Unit、database concurrency、API integration、OpenAPI、ADR、data dictionary 與交接文件。

## 驗收條件

- [x] 相同 bucket 10 個 concurrent consumes，在 limit=5 時恰有 5 個 allowed，counter 1～10 不遺失。
- [x] 相同 token 第六次於 provider 前回 429，帶 `Retry-After`，LINE verifier 只呼叫五次。
- [x] Database failure 回安全 503，不洩漏 connection detail；raw token、nonce、subject、IP 不進 DB/log。
- [x] Expired fingerprint rows 會由 global consume 清除，schema 有 expiry index 與完整性 constraints。
- [x] Config/Terraform 拒絕不安全 limits/TTL，Cloud Run API 明確收到四個設定值。
- [x] Affected lint、strict typecheck、unit/integration、build、Terraform、Prettier 與 diff checks 通過。

## 非目標與剩餘風險

- 不聲稱這是可信 per-IP policy；目前沒有可信 edge/header chain。
- 不新增 Cloud Armor／Redis。正式大量導流前仍需 edge per-client limit 與實際 load/abuse tuning。
- 不為 search/webhook 提前建立尚不存在的 endpoint policy；各 vertical slice 必須各自設計。
