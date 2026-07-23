# Portfolio and media data dictionary

## `portfolio_items`

Tenant-owned作品metadata。`status`為`DRAFT | PUBLISHED | HIDDEN | DELETED`；P2-004只建立／管理DRAFT與soft delete，publish由P2-005 readiness gate負責。`staff_id`、`service_id`均以`tenant_id + id` composite foreign key限制同tenant。`sort_order`是tenant內完整排序。

| 欄位                      | 規則                                 |
| ------------------------- | ------------------------------------ |
| `id`                      | client-generated UUID，支援安全retry |
| `tenant_id`               | required；每一查詢與寫入的隔離鍵     |
| `staff_id` / `service_id` | nullable；設定時必須為同tenant資源   |
| `title`                   | trim後1–160字元                      |
| `description`             | nullable，最多2000字元               |
| `status`                  | default `DRAFT`；刪除使用`DELETED`   |
| `published_at`            | nullable；P2-004不得自行填入         |

## `portfolio_tags`

每件作品最多10個trimmed tag，每個1–50字元；以`tenant_id + portfolio_item_id + value`唯一。關聯使用tenant composite key，避免跨tenant掛載。

## `media_assets`

圖片處理狀態與storage provenance。每個portfolio item最多一筆media asset。`PENDING`只有短效upload window；`READY`必須具實際MIME、bytes、width、height、checksum、display key與thumbnail key；`REJECTED`只保存allowlisted rejection code，不保存decoder原文或PII。

| 欄位                                  | 規則                                          |
| ------------------------------------- | --------------------------------------------- | --------- | ----------- | -------- |
| `id`                                  | client-generated UUID；task idempotency key   |
| `tenant_id` / `owner_id`              | owner必須是同tenant portfolio item            |
| `bucket`                              | server config值，client不可指定               |
| `upload_object_key`                   | 固定tenant prefix的暫存原圖                   |
| `object_key` / `thumbnail_object_key` | READY後固定WebP keys                          |
| `declared_mime_type`                  | `image/jpeg                                   | image/png | image/webp` |
| `declared_byte_size`                  | 1–15,728,640 bytes                            |
| `mime_type` / `byte_size`             | worker解碼／storage驗證結果                   |
| `width` / `height`                    | normalized display dimensions，正整數         |
| `checksum`                            | normalized display SHA-256 hex                |
| `status`                              | `PENDING                                      | READY     | REJECTED    | DELETED` |
| `upload_expires_at`                   | signed policy expiry；過期PENDING不占quota    |
| `rejection_code`                      | allowlisted machine code，不保存raw exception |
| `created_by_user_id`                  | audit actor；user刪除時set null               |

Timestamps以UTC `timestamptz`保存；台灣介面再以`Asia/Taipei`呈現。Bucket保持private並啟用public access prevention。
