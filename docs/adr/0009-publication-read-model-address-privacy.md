# ADR 0009：公開商家 read model 與地址隱私

狀態：Accepted

日期：2026-07-22

## Context

內部商家 aggregate 含電話、完整地址、userId、班表例外原因及 Cloud Storage object key。直接序列化內部 model 會增加 PII 與基礎設施資訊外洩風險；住家工作室在預約成立前尤其不得自動揭露門牌。

## Decision

建立獨立 marketplace read model。公開 query 必須同時限制 tenant `ACTIVE`、profile `PUBLISHED`、作品 `PUBLISHED` 及 media `READY`。API 以 allowlist 組裝 response，不重用管理端 DTO。

`Location.isPublicAddress=false` 時只提供 `city`、`district`、`Asia/Taipei` 與 `DISTRICT_ONLY`；`name`、`address`、`postalCode` 固定為 null。電話、userId、完整 availability exception、bucket／object key 永不進公開 contract。圖片只透過 15 分鐘 signed GET URL 交付。

發布是明確 lifecycle transition。作品先個別發布，商家再通過 readiness gate；兩者皆記錄 UTC `publishedAt` 與 safe audit。`SUSPENDED` 不能由商家自行解除。readiness 使用通用能力與狀態，不讀 plan code/name。

## Consequences

- 公開 contract 能獨立版本化，新增內部欄位不會意外公開。
- 地址安全是 server-side invariant，不能只靠 Web 隱藏。
- media pipeline 未設定時公開作品讀取會 503；不退回 raw GCS URL。
- signed URL 是短效傳遞能力，並非撤回後立即失效；需保持短 TTL，未來 CDN caching 必須另立 ADR。
