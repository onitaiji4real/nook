# ADR 0013：Appointment lifecycle與不可變改期鏈

狀態：Accepted
日期：2026-07-22

## Context

Appointment成立後需要取消、報到、完成、未到店與改期。直接覆寫時間會失去顧客接受過的價格、政策與地址，也會讓月額度、未來媒合歸因與提醒取消無法對帳。只改status不處理`booking_occupancies`則會讓已取消時段仍被占用；先釋放舊位再建立新位則會讓改期中途失敗或被其他request插入。

現有取消政策是自由文字，不能安全解析成期限。Cloud Run rolling revision亦可能同時存在v1/v2 hold writer，schema必須先兼容舊writer，才能開放店家修改結構化規則。

## Decision

- Domain state machine是唯一transition allowlist。每次write使用Serializable transaction、database clock、current authorization、row lock/CAS、history、safe audit與versioned ID-only outbox。
- BookingPolicy新增cancel/reschedule lead minutes與revision；hold及appointment保存lead snapshots。自由文字只供閱讀，v2 policy hash才包含兩個結構化值。
- Cancel/no-show/reschedule把原appointment occupancy設RELEASED；check-in/complete保留ACTIVE歷史占用。
- Reschedule保留舊appointment為RESCHEDULED，建立新appointment並以tenant/consumer-scoped direct predecessor與root links形成不可變chain。Target hold occupancy原子轉成replacement owner，任何失敗完整rollback。
- Replacement繼承chain source、usage month/timezone；target hold source不得改寫歸因。月額度只計root appointment一次，取消/no-show不退款額度。
- `source=MARKETPLACE`不等於verified attribution。Settlement model未上線前不得產生8%媒合義務；未來只可由唯一COMPLETED leaf、server-verified attribution、首次合格新客與明確final amount建立唯一ledger。
- Rollout用`BOOKING_POLICY_V2_WRITES_ENABLED`切換hold writer與policy PUT，再等v1 ACTIVE holds到期後以`APPOINTMENT_LIFECYCLE_ENABLED`開transition endpoints。

## Consequences

- 歷史預約與接受條款不被覆寫，A→B→C可完整追溯且不重複占額度。
- Schema多兩條具名self relation、transition key與controlled reason enum；transaction必須遵守固定鎖序並對P2034/40P01有限重試。
- 店家可調整結構化self-service期限，但既有appointment永遠依snapshot執行。
- P3-006可消費versioned lifecycle events建立／取消提醒，不需把provider delivery放進核心transaction。

## Rejected alternatives

- 覆寫原appointment時間：破壞歷史、政策證據與settlement去重。
- 解析自由文字取消政策：無法可靠處理語言、例外與數值，會造成錯誤允許或拒絕。
- 取消後建立全新無link預約：會重複計額度並可洗掉MARKETPLACE來源。
- Browser自行判deadline或直接更新status：client clock與請求可竄改，無法提供一致授權與occupancy保證。
- `source=MARKETPLACE`即收8%：沒有verified attribution、首次新客及final amount證據。
