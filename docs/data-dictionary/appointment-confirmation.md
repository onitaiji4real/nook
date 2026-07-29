# Appointment confirmation data dictionary

P3-003的成立點是authenticated consumer把自己仍有效的`booking_holds`確認為免定金`appointments`。所有timestamp存UTC；顧客顯示使用`location_timezone_snapshot`，訂閱用量使用獨立的`usage_timezone_snapshot`與`usage_month`。

## Aggregate tables

### `appointments`

- `hold_id`全域唯一；`tenant_id + consumer_user_id + hold_id`另由composite FK綁定owned hold。
- 初始`status=CONFIRMED`、`payment_status=NOT_REQUIRED`、`deposit_amount=0`。
- `source`由hold的server snapshot複製；目前consumer browser只能形成`MERCHANT_LINK`。
- `pricing_status`依hold price truth決定：FIXED=`EXACT`；FROM/RANGE=`ESTIMATE`；QUOTE=`QUOTE_REQUIRED`。只有EXACT可有subtotal/total。
- policy、location、address與timezone皆從hold snapshot複製，不讀confirmation當下catalog。
- `usage_month`為tenant `usage_timezone`下的確認月份，格式`YYYY-MM`；取消或no-show不刪row也不退額度。

### `appointment_items`

- P3-003每個appointment恰建立一筆item；unique appointment ID保證最多一筆，transaction integration test保證至少一筆。
- 保存service ID/name、duration、price shape與currency snapshot。整數金額為minor units；TWD目前等同整數元。

### `appointment_status_history`

- 首筆固定`from_status=null -> CONFIRMED`，actor是verified consumer，時間與appointment `confirmed_at`共用transaction clock。
- 後續狀態變更必須走`@nook/domain` allowlist並新增history；P3-003不提供transition endpoint。

### `appointment_confirmation_keys`

- 主鍵為`consumer_user_id + key_hash`；不保存raw idempotency key。
- 保存canonical request fingerprint與owned appointment composite FK。
- 相同key/same fingerprint及same hold/new key都回原create representation；replay不重寫history/outbox或用量。

### `outbox_events`

- 成立時寫`appointment.confirmed.v1`，dedupe key為`appointment.confirmed:{appointmentId}:v1`。
- Payload只有tenant/appointment ID；不存在policy、address、price、identity profile或「通知已送達」狀態。

## Shared occupancy ownership

`booking_occupancies`要求`hold_id`與`appointment_id`恰有一個非null。Confirmation保留原ACTIVE row與含buffer range，以單一UPDATE把owner由hold轉給appointment；不可release後再insert。Hold release/expiry/create與confirmation皆先lock hold，再lock/update occupancy。

## Monthly entitlement

`MAX_MONTHLY_BOOKINGS`必須是非負INTEGER；`0`表示unlimited。TRIALING/ACTIVE使用tenant plan，FREE/PAST_DUE/CANCELED使用唯一default plan。缺值、型別錯誤、負數或default plan數量異常都fail closed 503；達上限回403且不consume hold。
