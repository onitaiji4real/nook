# Identity and tenancy data dictionary

## User

平台內部使用者。`id` 是 authorization principal；display name、email、phone、avatar 均屬 PII，不得寫入 application log 或 audit payload。

## UserIdentity

外部 provider subject 與 local User 的連結。`(provider, provider_subject)` 全域唯一；subject 不得出現在 log。LINE `profile_json` allowlist 僅含 `displayName` 與 `avatarUrl`；不得保存 email、raw token、nonce 或完整 provider response。

## Tenant

租戶安全邊界。tenant-owned repository query 必須由呼叫端顯式提供 `tenantId`；禁止從未驗證 header 推導。`slug` 全域唯一，公開可見但仍不得當作 authorization key。

## Membership

User 與 Tenant 的授權關係；`(tenant_id, user_id)` 唯一。角色為 OWNER、MANAGER、STAFF、VIEWER；狀態不是 ACTIVE 時不得存取 tenant resource。P1-003 只實作 tenant read 與 OWNER onboarding，細部 permission matrix 留待後續業務 slice。

## AuditLog

安全稽核事件，必含 tenant、action、resource 與 request ID；actor 可因 user deletion 變為 null。P1-003 使用 `tenant.created` 與 `authorization.denied`，不保存 tenant name、user profile、token、customer note 或 request body。
