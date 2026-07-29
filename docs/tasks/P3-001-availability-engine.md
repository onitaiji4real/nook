# P3-001 Availability engine

狀態：`done`

## Outcome

讓已發布店家的顧客可依服務、日期與選填staff取得可預約起始時間；結果正確套用週間規則、例外、staff-service資格、服務duration/buffer與明確booking policy，且不洩漏私人排班資料。

## Scope

- 建立tenant一對一booking policy及backfill：`slotIntervalMinutes`允許5／10／15／20／30／60且預設15、`minimumLeadMinutes`為0～10080且預設120、`maximumAdvanceDays`為1～365且預設60。Migration backfill既有tenant；tenant create transaction必須nested create policy，新tenant不得缺row。Availability若遇legacy／損壞的missing row要fail closed 503並記safe operation，不在read path偷偷repair或套隱性預設。本task只提供schema/backfill/read；店家修改API/UI另立task。
- 建立純domain availability calculator與timezone conversion boundary。
- Repository projection只讀Phase 2既有`Service.bookingEnabled`、`StaffProfile.bookingEnabled`、ACTIVE status、staff-service assignment、weekly rules、exceptions，以及後續可注入的半開occupancy區間；P3-001不新增或backfill這兩個既有欄位。
- 公開`GET /v1/marketplace/merchants/{slug}/availability`，要求`serviceId`、店家當地日期`date=YYYY-MM-DD`與`days=1..7`，`staffId`選填；tenant timezone只能由repository取得，client不得指定。
- Response固定回`timezone`、`generatedAt`、`reservation=false`、公開staff allowlist及依start聚合的`eligibleStaffIds`；`startAt`／`endAt`為顧客服務時間的UTC ISO，不回occupied range或buffer。
- 公開頁加入服務／日期／staff選擇及時段顯示；沒有時段、API暫時失敗與LOCAL PREVIEW需誠實區分。
- Shared contract、OpenAPI、data dictionary、security/design contract、tests與worklog。

## Acceptance criteria

- [x] Calculator注入clock並依tenant IANA timezone把local weekly interval轉為UTC；slot以當地午夜為對齊原點，正確處理跨UTC／跨午夜、duration與前後buffer，完整occupied range必須落在同一可營業區間內。
- [x] 可營業區間為`weekly ∪ OPEN`後再扣除`CLOSED ∪ BLOCK`；CLOSED/BLOCK永遠優先，OPEN不能覆蓋，重疊同類型先合併。Asia/Taipei與至少一個DST timezone有測試；不存在local time略過，歧義local time只採較早UTC instant。
- [x] Occupancy一律使用`[start, end)`，相鄰不算重疊；P3-001只定義domain input與empty adapter，database schema／constraint歸P3-002，appointment adapter歸P3-003。
- [x] 只回ACTIVE＋booking-enabled且具service assignment的staff。未知／未發布slug、跨tenant或inactive service、指定無效／未assignment staff固定回404；有效query但無時段固定回200空集合。
- [x] `days`超過7、格式錯誤、date早於tenant今日或查詢終點超過booking policy固定回400 Problem Details，不自動裁切。Lead time以注入clock的UTC instant計算，再向上對齊下一個local slot。
- [x] Query可安全重試且不建立hold；response固定`reservation=false`並由UI稱為「候選時段／目前可用」，不得暗示已保留。
- [x] Repository以tenant scope讀取資料；公開controller不碰Prisma，projection排除exception reason、phone、storage path與完整私人地址。
- [x] Response allowlist只含staff `id`／公開顯示名稱、UTC服務起訖、timezone與eligible staff IDs；不含exception reason、phone、storage path、buffer、occupied range、完整私人地址或內部識別。
- [x] Public service/staff selector沿用現有marketplace merchant response；該response已server-side只回ACTIVE＋`bookingEnabled=true` services/staff，並以staff `serviceIds`公開有效assignment。選「任何人員」時slots依start/end聚合`eligibleStaffIds`，指定staff時每個slot只含該ID，讓P3-002可在hold時選定具體staff而不重做contract。
- [x] RWD公開頁可在手機完成service／staff／date選擇並看到loading、empty、error、available狀態；不提供假的「預約成功」。
- [x] Unit/integration/browser tests、OpenAPI、docs、lint、typecheck、build、architecture與live smoke通過。
- [x] Database tests證明migration backfill所有既有tenant、建立tenant與policy同transaction，且缺policy時availability fail closed而非套用隱性default。

## 非目標

- Booking hold、appointment create/confirm、顧客資料、付款、通知、取消、改期或店家日曆。
- 把availability response當成鎖定、在browser儲存時段所有權，或只靠前端防撞。
- 搜尋排名、地圖距離、多人同時服務、多服務組合、資源／房間容量。

## 主要風險

- DST雖非台灣目前問題，calculator仍須以IANA timezone為輸入，不能以固定`UTC+8`散落在query logic。
- Exception與weekly規則若直接在SQL拼slot會難以測試；repository先回bounded projection，domain calculator保持純函式。
- 這個endpoint只能提供候選時段。P3-002/P3-003完成前，公開頁不得顯示可確認預約的CTA。
