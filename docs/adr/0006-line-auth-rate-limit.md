# ADR 0006：LINE auth exchange rate limit

狀態：Accepted
日期：2026-07-21

## Context

`POST /v1/auth/line/exchange` 是不需 bearer token 的公開入口，每次有效處理會呼叫 LINE verify endpoint，成功後還會呼叫 Identity Platform。若沒有跨 instance 限流，攻擊者可放大外部 provider traffic、增加成本並消耗登入容量。

Cloud Run 可以水平擴展且 scale-to-zero，單一 Node.js process 的 memory counter 不能提供整個 environment 一致的上限。現階段也沒有 External Application Load Balancer／Cloud Armor 與可被 API 信任的 client-IP header contract；直接相信 client 可注入的最左側 `X-Forwarded-For` 會形成 spoofing bypass。

## Decision

- Phase 1 使用既有 PostgreSQL 建立 fixed-window rate-limit buckets，不新增 Redis、Cloud Armor 或第三方 dependency。
- 每次 LINE exchange 在呼叫 provider 前依序消耗兩個 bucket：
  - environment-global：每 60 秒最多 120 次，限制整體 provider amplification。
  - raw LINE ID token fingerprint：每 60 秒最多 5 次，限制相同 token replay。
- Fingerprint 使用 SHA-256，只保存 64 字元 digest；不保存 raw token、nonce、LINE subject、IP 或 request body。LINE ID token 具高 entropy/signature，digest 只作短期 equality key，不作 authentication。
- Bucket 以 UTC window start 組成 primary key，`INSERT ... ON CONFLICT DO UPDATE` 原子遞增，確保多個 Cloud Run instances 與 concurrent requests 共用一致計數。
- Bucket TTL 預設 10 分鐘；每次 global consume 會刪除過期 rows。TTL 不得短於 window，所有數值均由 startup config 與 Terraform validation 限制。
- 超限回 RFC 9457 `429 line_exchange_rate_limited` 與整數秒 `Retry-After`，且不呼叫 LINE verifier。Database failure fail closed 為 `503 auth_rate_limit_unavailable`。
- 成功、invalid token、provider failure 都計入 attempt。Global bucket 先消耗，因此 token bucket rejection 仍計入環境總量。

## Consequences

- 限流跨 instances 一致，不依賴 sticky session；但 PostgreSQL 成為公開 auth path 的必要依賴。這與既有 identity/user persistence 相同，database unavailable 時登入會暫停而非繞過保護。
- Fixed window 在邊界附近可能容許接近兩倍短暫 burst。120/min 是 Phase 1 起始值，可支援早期店家 onboarding 並限制 provider成本；staging/load evidence 出現後才能調整，不應只為消除 429 任意放寬。
- Global limit 可被攻擊流量消耗，不能取代 per-client edge defense。正式公開行銷／大量導流前仍須以 External Application Load Balancer + Cloud Armor（或等效可信 edge）加入 per-IP/device policy，並在新的 ADR 定義可信 header chain。
- Bucket fingerprint 是短期 pseudonymous security telemetry；只有 expiry cleanup，不進 audit log、analytics、backup-driven business reporting 或 tenant export。
