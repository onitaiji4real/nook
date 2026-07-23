# Availability policy data dictionary

## BookingPolicy

每個 tenant 必須恰有一筆 `booking_policies`，主鍵同時是 tenant foreign key。建立 tenant 與 owner 時在同一 transaction nested create；migration 對既有 tenant backfill。Availability read 遇到缺 row 必須回 503，不可在讀取路徑補資料或偷偷套預設。

| 欄位                      | 型別／限制                     | 意義                                 |
| ------------------------- | ------------------------------ | ------------------------------------ |
| `tenantId`                | UUID PK/FK                     | tenant scope；刪除 tenant 時 cascade |
| `slotIntervalMinutes`     | 5、10、15、20、30、60；預設 15 | 候選開始時間的當地分鐘間隔           |
| `minimumLeadMinutes`      | 0..10080；預設 120             | 相對注入 clock 的最短提前時間        |
| `maximumAdvanceDays`      | 1..365；預設 60                | 允許查詢的最遠 tenant-local 日期     |
| `createdAt` / `updatedAt` | UTC timestamp                  | lifecycle audit boundary             |

## Availability projection

- 來源只包含已發布且 ACTIVE tenant、ACTIVE location、ACTIVE 且 `bookingEnabled=true` 的 service/staff、有效 staff-service assignment、週間規則與查詢範圍內例外。
- 可營業區間是 `weekly ∪ EXTRA_HOURS`，再扣除 `TIME_OFF ∪ BLOCK`。所有區間採 `[start, end)`。
- Service duration 與前後 buffer 必須完整落在同一可營業區間；response 只回顧客服務的 `startAt`/`endAt`，不公開 buffer。
- Occupancy 是 domain input boundary。P3-002 repository已把同tenant、同staff、`ACTIVE AND expiresAt > now` 的 hold occupancy接入 projection；release／expiry後不再占用。P3-003須在同一ledger加入有效appointment ownership，不得另建互相看不到的constraint。
- UTC 儲存、IANA timezone 計算。不存在 local time 略過，重複 local time採較早 UTC instant。

## Public response

固定 allowlist：`timezone`、`generatedAt`、`reservation=false`、公開 service 摘要、staff `id/displayName`、UTC slots 與 `eligibleStaffIds`。不得含 tenant ID、phone、私人地址、例外原因、storage path、buffer 或 occupancy。
