# Public merchant data security contract

- Public controller 不套 authentication guard，但 repository query 必須以 `slug + ACTIVE tenant + PUBLISHED profile` 限制。
- Response 使用 allowlist mapping；不得回傳 Prisma entity、管理端 DTO 或任意 JSON metadata。
- `isPublicAddress=false` 時 server 固定遮掉 location name、address 與 postal code。前端不得接收到再自行隱藏。
- 圖片只限 PUBLISHED portfolio ＋ READY media；API 以 server credential 產生 15 分鐘 read-only signed URL，永不回 bucket/object key。
- media config 缺少或 signing 失敗回通用 503，不把 provider error、credential 或 object key送給 client。
- 不輸出電話、customer notes、exception reason、token、raw upload 或 EXIF。安全 log 只含 redact 後 tenantId/userId、requestId、operation、outcome。
- 下架阻止新 query／新 signed URL；既有 signed URL 最長仍可用至 TTL 到期，此為已知 residual risk。
