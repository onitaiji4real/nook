# Identity and tenancy data dictionary

## User

平台內部使用者。`id` 是 authorization principal；display name、email、phone、avatar 均屬 PII，不得寫入 application log 或 audit payload。

## UserIdentity

外部 provider subject 與 local User 的連結。`(provider, provider_subject)` 全域唯一；subject 不得出現在 log。LINE `profile_json` allowlist 僅含 `displayName` 與 `avatarUrl`；不得保存 email、raw token、nonce 或完整 provider response。

## Tenant

租戶安全邊界。tenant-owned repository query 必須由呼叫端顯式提供 `tenantId`；禁止從未驗證 header 推導。`slug` 全域唯一，公開可見但仍不得當作 authorization key。Phase 1 的關閉語意是將 status 設為 `CLOSED`，不執行 hard delete；有 audit evidence 的 tenant 由 database foreign key 阻擋刪除。

## Membership

User 與 Tenant 的授權關係；`(tenant_id, user_id)` 唯一。角色為 OWNER、MANAGER、STAFF、VIEWER；狀態不是 ACTIVE 時不得存取 tenant resource。P1-003 只實作 tenant read 與 OWNER onboarding，細部 permission matrix 留待後續業務 slice。

## AuditLog

安全稽核事件，必含 tenant、action、resource 與 non-null request ID；actor 可因 user deletion 變為 null。P1-003 使用 `tenant.created` 與 `authorization.denied`，不保存 tenant name、user profile、token、customer note 或 request body。Contract migration 對舊 null row 使用 `legacy-<audit UUID>`，只表示 migration provenance，不可解讀為原始 HTTP request。Audit row 對 tenant 使用 `ON DELETE RESTRICT`；保存年限、legal hold、匿名化與 purge 必須由 owner／法遵另行核准，在此之前不自動刪除。

## AuthRateLimitBucket

公開 auth endpoint 的短期 security counter，不屬於 tenant business data。複合 key 為 `scope`、SHA-256 `key_hash`、UTC `window_start`；另存正整數 `request_count`、`expires_at` 與 `updated_at`。Token bucket 不保存 raw token、nonce、LINE subject 或 IP，不能用於 user analytics、tenant export 或 authentication。預設 expiry 是 window 起始後 10 分鐘，由 global consume 清除；expiry index支援 bounded cleanup。
