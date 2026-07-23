# ADR 0011：共享 booking occupancy ledger

狀態：Accepted
日期：2026-07-22

## Context

Availability query只能提供快照，不能防止兩個顧客同時選到同一staff與時間。若`booking_holds`與`appointments`各自使用constraint，hold轉appointment或appointment確認與新hold並發時仍會跨表撞單。以application mutex、Redis lock或先查再寫都不能取代system-of-record constraint。

## Decision

- PostgreSQL新增`booking_occupancies`作所有有效占用的唯一ledger。P3-002先由booking hold一對一持有；P3-003在同一transaction把同一筆occupancy ownership原子轉給appointment。
- 啟用PostgreSQL內建contrib `btree_gist`。Partial GiST exclusion constraint同時比較tenant、staff及`tstzrange(occupied_start_at, occupied_end_at, '[)')`，只限制ACTIVE rows。相鄰半開區間允許，任何實際重疊由database拒絕。
- Expiry以單一PostgreSQL transaction time判定。Worker負責一般清理；hold create仍在constraint insert前清除候選staff的expired ACTIVE rows，避免scheduler延遲影響取得時段。
- 同consumer／tenant換位使用transaction advisory lock序列化。Rate-limit attempt使用獨立transaction，避免booking transaction rollback抹除濫用計數。
- 不引入Redis或外部鎖服務。Cloud SQL PostgreSQL仍是預約占用的唯一system of record。

## Consequences

- Hold與appointment不會各自演化出互相看不到的occupancy。P3-003必須重用ledger並提供hold-create／appointment-confirm併發證據。
- `btree_gist`成為database migration prerequisite；migration可重入建立extension，CI與local PostgreSQL都必須驗證。
- ACTIVE expired rows在清理前仍受constraint約束，因此create transaction的targeted cleanup是正確性需求，不只是維運最佳化。
- Ledger與owner lifecycle必須同transaction更新；repository API不可提供任意單表status修改。

## Rejected alternatives

- Holds與appointments各自exclusion constraint：無法處理跨表競態。
- `SELECT`後insert：兩個transaction可同時看到空位。
- Process memory mutex：多instance Cloud Run無共享狀態，重啟即失效。
- Redis distributed lock：增加外部服務、失效模式與成本，仍需database invariant處理鎖過期與寫入競態。
