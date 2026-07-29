# Appointment views data dictionary

P3-004不建立新的business aggregate，只為P3-003既有appointment資料增加有界查詢index與read projection。所有timestamp仍以UTC保存；API另外回snapshotted location timezone與tenant usage timezone供顯示。

## Read sources

### `appointments`

- Consumer list/detail永遠以`consumer_user_id`為最外層predicate；tenant calendar/detail永遠以`tenant_id`為最外層predicate。
- `status`決定upcoming/past partition；`start_at, id`是穩定cursor排序鍵。Calendar採`start_at < to AND end_at > from`半開overlap。
- `location_*_snapshot`、`pricing_status`、`payment_status`及nullable totals直接讀成立時snapshot，不以目前catalog或location重算。
- `consumer_user_id`只作owner predicate或current display-name join，不出現在任何read DTO。

### `booking_holds`

- Appointment以已consume hold取得`staff_display_name_snapshot`。顯示人員名稱不得改讀current `staff_profiles.display_name`。
- Hold ID、status、expiry、policy與內部occupancy欄位都不進list projection。

### `appointment_items`

- P3-004讀唯一item的service ID/name/duration與完整price shape。EXACT才顯示subtotal/total；ESTIMATE與QUOTE_REQUIRED維持null。

### `appointment_status_history`

- Detail依`created_at ASC, id ASC`讀取。輸出只有nullable `fromStatus`、`toStatus`與`createdAt`；排除history ID、actor ID及reason。

### `users`

- Merchant projection只join current `display_name`；null或空白固定顯示「顧客」。這不是tenant CRM snapshot，也不提供contact、avatar或identity provider資料。

### `tenants`與`staff_profiles`

- `/v1/me` membership的`tenantTimezone`與calendar response的`calendarTimezone`都來自`tenants.usage_timezone`。
- STAFF scope只接受同tenant、同principal user且`status=ACTIVE`的唯一profile。`booking_enabled`不影響歷史read；零筆或多筆均拒絕。

## Indexes

第16個migration只增加：

- `appointments(consumer_user_id, start_at, id)`
- `appointments(tenant_id, start_at, id)`
- `appointments(tenant_id, staff_id, start_at, id)`

沒有改寫既有snapshot、沒有建立consumer search index，也沒有新增跨tenant資料集。

## Cursor projection

Cursor不持久化。Consumer cursor保存version、view、database `asOf`、last start與ID；merchant cursor另綁tenant、from/to、effective staff與status。編碼為base64url strict JSON，raw與decoded各不超過512 bytes，且不含姓名、地址或其他PII。
