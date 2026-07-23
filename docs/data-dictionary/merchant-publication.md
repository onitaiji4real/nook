# Merchant publication data dictionary

## Lifecycle fields

| Entity          | Field            | Storage              | Rule                                           |
| --------------- | ---------------- | -------------------- | ---------------------------------------------- |
| MerchantProfile | visibilityStatus | enum                 | `DRAFT`、`PUBLISHED`、`SUSPENDED`              |
| MerchantProfile | publishedAt      | timestamptz nullable | PUBLISHED 必填；下架回 DRAFT 時清空；UTC       |
| PortfolioItem   | status           | enum                 | `DRAFT`、`PUBLISHED`、`HIDDEN`、`DELETED`      |
| PortfolioItem   | publishedAt      | timestamptz nullable | PUBLISHED 必填；其餘 lifecycle transition 清空 |

## Readiness

| Code                | Server-side rule                                                                                  | Fix path            |
| ------------------- | ------------------------------------------------------------------------------------------------- | ------------------- |
| PROFILE_CONTENT     | active tenant、verification 非 REJECTED，且 description／booking policy／cancellation policy 非空 | `/studio/profile`   |
| ACTIVE_LOCATION     | primary location ACTIVE 且有 city／district                                                       | `/studio/profile`   |
| ACTIVE_SERVICE      | 至少一項 ACTIVE 且 bookingEnabled service                                                         | `/studio/services`  |
| ACTIVE_STAFF        | 至少一位 ACTIVE、bookingEnabled、位於 ACTIVE location 且具有效 service assignment 的 staff        | `/studio/staff`     |
| WEEKLY_AVAILABILITY | 上述 eligible staff 至少一段 weekly rule                                                          | `/studio/staff`     |
| PUBLISHED_PORTFOLIO | 至少一項 PUBLISHED portfolio 且 media READY                                                       | `/studio/portfolio` |

## Public allowlist

公開：slug、店名、分類、介紹、verification 狀態（REJECTED 不公開）、公開聯絡連結、經遮罩地點、有效服務與價格、可預約人員 display data、去重週間時間、PUBLISHED＋READY 作品、政策、短效圖片 URL。

永不公開：tenantId、userId、membership、phone、私有完整地址／郵遞區號／location name、availability exception 原因、bucket、object key、checksum、audit、方案或 entitlement 內部值。
