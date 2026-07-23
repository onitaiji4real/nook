# Booking hold data dictionary

## BookingHold

`booking_holds` 是顧客已驗證後建立的 10 分鐘 catalog snapshot。它不等於 appointment，不計入每月預約額度、不觸發通知或媒合費。所有 tenant-owned foreign key 都使用 `(tenant_id, id)` composite scope；`consumer_user_id` 指向全域 identity `users.id`。

| 欄位                                               | 型別／限制                                | 意義                                                                            |
| -------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| `id`                                               | UUID PK                                   | 對外可見的 hold ID                                                              |
| `tenantId` / `locationId`                          | UUID composite FK                         | server 由 published slug 與 primary ACTIVE location 決定；client 不得傳入       |
| `serviceId` / `staffId`                            | UUID composite FK                         | server 重新驗證 ACTIVE、booking-enabled 與 assignment 後固定選定                |
| `consumerUserId`                                   | UUID FK                                   | 只來自 verified bearer principal；不接受 body/query 值                          |
| `status`                                           | `ACTIVE / RELEASED / EXPIRED / CONSUMED`  | terminal rows 不可復活；P3-003 才能轉 `CONSUMED`                                |
| `startAt` / `endAt`                                | UTC timestamptz                           | 顧客服務區間，不含 buffer                                                       |
| `serviceNameSnapshot` / `staffDisplayNameSnapshot` | bounded text                              | 建立當下公開名稱；catalog 後續修改不回寫                                        |
| `durationMinutesSnapshot`                          | 5..720                                    | staff override 優先，否則 service duration                                      |
| price snapshots                                    | `FIXED / FROM / RANGE / QUOTE` constraint | staff price override 轉成 `FIXED`；否則完整保存 service price shape 與 currency |
| `expiresAt`                                        | UTC timestamptz                           | PostgreSQL transaction clock + 固定 10 分鐘；replay 不延長                      |
| `idempotencyKeyHash`                               | SHA-256 hex                               | raw UUID key 永不落庫；與 consumer 組合 unique                                  |
| `requestFingerprint`                               | SHA-256 hex                               | endpoint、slug、service、staff-or-any、normalized UTC start 的不可逆摘要        |
| timestamps                                         | UTC timestamptz                           | create transaction 使用同一 `dbNow`                                             |

狀態規則：

- `ACTIVE` 且 `expiresAt > dbNow` 才能繼續被 P3-003 消費。
- `DELETE` 對 own ACTIVE 未過期 hold 轉 `RELEASED`；已到期先轉 `EXPIRED`。
- own `RELEASED`／`EXPIRED` 重試為 204；`CONSUMED` 為 409；其他 consumer 與未知 ID 同為 404。
- 相同 idempotency key 即使 hold terminal 仍只回原 row 與原 expiry，不可建立新 hold。
- Replay若讀到仍標為 `ACTIVE` 但 `expiresAt <= dbNow` 的row，須在回應前把hold與occupancy一併轉為 `EXPIRED`，再回傳current status。

## BookingOccupancy

`booking_occupancies` 是 hold 與未來 appointment 共用的唯一防撞 ledger。P3-002 每個 hold 恰有一筆 occupancy；P3-003 必須在同一 transaction 轉移 ownership，不得建立第二套 appointment-only constraint。

| 欄位                                | 型別／限制                    | 意義                                            |
| ----------------------------------- | ----------------------------- | ----------------------------------------------- |
| `tenantId` / `staffId`              | UUID composite FK             | constraint scope                                |
| `holdId`                            | UUID unique composite FK      | P3-002 occupancy owner                          |
| `status`                            | `ACTIVE / RELEASED / EXPIRED` | 只有 ACTIVE 參與 exclusion constraint           |
| `occupiedStartAt` / `occupiedEndAt` | UTC timestamptz，start < end  | 服務時間加前後 buffer 的半開區間 `[start, end)` |

Partial GiST exclusion constraint 以 tenant、staff equality 與 `tstzrange(..., '[)')` 禁止 ACTIVE 重疊；相鄰區間合法。Application calculator 是 UX 與錯誤分類層，database constraint 才是最後防線。

## BookingHoldRateAttempt

每 10 分鐘 fixed window 對同一 consumer 最多接受 10 個 distinct idempotency key hashes。Primary key 是 `(consumer_user_id, window_start, key_hash)`，同 key replay 不重複計數。Authentication、inactive user及缺少／格式錯誤的key在attempt之前拒絕；key為有效UUID後才先記attempt，因此後續slug、strict body、catalog、slot或conflict造成的400／404／409仍保留attempt。Row 只保存 consumer UUID、window、hash 與 expiry，不保存 email、電話、LINE subject、IP、raw key 或 bearer token。
