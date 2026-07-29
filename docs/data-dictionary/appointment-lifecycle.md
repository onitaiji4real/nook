# Appointment lifecycle data dictionary

P3-005在既有appointment aggregate上新增結構化self-service policy、不可變改期鏈與transition idempotency。所有timestamp存UTC，資格由PostgreSQL transaction clock判斷。

## `booking_policies`

- `consumer_cancel_lead_minutes`、`consumer_reschedule_lead_minutes`：integer 0..43200，default/backfill 1440。
- `revision`：positive integer optimistic-concurrency token；PUT成功以CAS加1。
- 原有slot/minimum lead/maximum advance invariants維持不變。缺row是corruption，不由API upsert。

## `booking_holds`與`appointments`

- 各新增`consumer_cancel_lead_minutes_snapshot`、`consumer_reschedule_lead_minutes_snapshot`，NOT NULL DEFAULT 1440；v2 writer必須顯式寫current policy值。
- Deadline不持久化，以stored `start_at - snapshot minutes`計算。Lead=0的timestamp等於start，但eligibility為exclusive。
- Appointment新增`rescheduled_from_id`與`reschedule_root_id`。Root兩欄皆null；replacement兩欄皆non-null且以tenant+consumer composite FK連同owner appointment。
- `rescheduled_from_id`唯一，確保每筆source最多一個successor；root relation為many-to-one。兩欄建立後不得更新或清空。

## `appointment_status_history`

- 保留既有nullable自由文字`reason`但P3-005不寫不讀。
- 新增nullable`reason_code` controlled enum。CANCELLED/RESCHEDULED首次transition必填對應actor子集合；initial confirmation、check-in、complete、no-show與replacement initial history為null。

## `appointment_transition_keys`

- PK：`actor_user_id + key_hash`；raw key不保存。
- 保存tenant、source appointment、action、canonical request fingerprint、result status/time及optional replacement ID。
- Action/status/replacement shape由DB check固定；source與replacement使用tenant composite FK，actor連User。
- Same-key replay及exact natural reschedule replay不重寫history/audit/outbox。

## Occupancy與quota

- Cancel/no-show/reschedule只把exact appointment-owned ACTIVE row設RELEASED，保留owner與range。
- Reschedule target以CAS清`hold_id`、設`appointment_id`並保持ACTIVE；range包含service range但可因buffer更大。
- Monthly count固定篩`tenant_id + usage_month + online source + rescheduled_from_id IS NULL`，不按status退款或依replacement重複計數。
