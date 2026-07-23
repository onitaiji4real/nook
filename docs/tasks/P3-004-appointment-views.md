# P3-004 Appointment views and merchant calendar

狀態：`done`

## Outcome

讓已登入顧客查詢自己的預約清單與明細，並讓有權限的店家成員在RWD工作台查看有界日期範圍的預約行事曆。所有資料都直接讀P3-003保存的不可變snapshot；本slice是read-only，不改預約狀態、不建立CRM、不宣稱LINE通知已送達。

## Product and commercial decisions

- 顧客入口為`GET /v1/me/appointments`與`GET /v1/me/appointments/:appointmentId`；只能由authenticated principal的`userId`決定owner，query/path不得接受consumer ID。未知、格式錯誤或非本人appointment一律privacy-safe 404。
- 店家入口為`GET /v1/tenants/:tenantId/appointments`與`GET /v1/tenants/:tenantId/appointments/:appointmentId`。ACTIVE OWNER、MANAGER與VIEWER可讀全部；ACTIVE STAFF只能讀`StaffProfile.userId`綁定自己的appointment，未綁定或綁定多筆403。STAFF list明送other staff filter為403；detail對other staff與所有unknown/foreign ID均404。不存在或跨tenant appointment對已授權member仍回404；非member固定403。
- 店家日曆顯示顧客目前的`User.displayName`作現場辨識，但不回`consumerUserId`、email、phone、avatar、LINE subject、identity profile或customer notes。顧客名稱不是CRM snapshot；P4若建立tenant customer projection，須另定retention與更名規則。
- 顧客detail包含已確認時揭露的完整地址與policy snapshot；consumer list與店家summary只回location name/city/district、service/staff，店家另回顧客display name，不回完整地址或policy全文。雙方都不取得內部owner、hold、occupancy、buffer、usage month、entitlement或confirmation key；consumer response也不回source，merchant response的source只供未來對帳參考。
- 所有價格沿用appointment/item snapshot與truthfulness：EXACT才顯示確定total，ESTIMATE與QUOTE_REQUIRED不可補造金額。任何後續catalog或location變更不改既有service/staff/location snapshot；顧客display name是唯一明定的current-profile join。
- 這個slice不計費、不新增媒合歸因、不退月額度。列表可看source供店家未來對帳，但不能依source直接認列8%收入；只有後續完成服務、可驗證attribution及settlement contract都成立後才能產生媒合義務。

## Query contracts

### Consumer list

`GET /v1/me/appointments?view=upcoming|past&limit=20&cursor=<opaque>`：

- `view`必填。完整status enum為`CONFIRMED | CHECKED_IN | COMPLETED | CANCELLED | NO_SHOW | RESCHEDULED`；terminal固定後四者。`upcoming`為`status IN (CONFIRMED, CHECKED_IN)`且`endAt >= asOf`，依`startAt ASC, id ASC`；`past`為terminal或`endAt < asOf`，依`startAt DESC, id DESC`。兩者構成目前enum的完整partition。
- 第一頁以單一PostgreSQL clock取得`asOf`。Opaque cursor版本化保存view、asOf、最後startAt與id；後頁沿用原asOf，cursor view不符、decode失敗或欄位錯誤回400。Cursor不是授權資料，篡改也必須仍受consumer predicate限制。
- `limit`預設20、最小1、最大50。Response為`{ asOf, items, nextCursor }`；多取一筆判斷next cursor，不做unbounded count。

### Merchant calendar

`GET /v1/tenants/:tenantId/appointments?from=<UTC>&to=<UTC>&staffId=<uuid?>&status=<enum?>&limit=100&cursor=<opaque?>`：

- `from/to`必填canonical UTC RFC3339 milliseconds，採半開window overlap：`startAt < to AND endAt > from`。`from < to`且最大31天；不接受location timezone文字或client-local ambiguous time。
- `from/to`只接受與`new Date(value).toISOString()`完全相等的`YYYY-MM-DDTHH:mm:ss.SSSZ`；拒絕offset、缺milliseconds或額外字元。`from < to`且`toEpochMs - fromEpochMs <= 31 * 24 * 60 * 60 * 1000`，不以DST calendar days解釋此API上限。
- 依`startAt ASC, id ASC`，limit預設100、最小1、最大200。第一頁另取PostgreSQL `asOf`；response為`{ asOf, from, to, calendarTimezone, items, nextCursor }`。Cursor保存version、asOf、tenantId、from、to、effective staff、status、lastStartAt與lastId，後頁沿用；任何filter變更或malformed cursor回400，但不宣稱跨request snapshot isolation。
- STAFF effective scope固定查同一tenant、`userId=principal`、`status=ACTIVE`的StaffProfile；`bookingEnabled`不影響歷史read。結果必須恰好一筆，0或多筆皆403。List query省略staffId仍只查自己，明確傳入不同StaffProfile ID回403。OWNER/MANAGER/VIEWER不套此綁定，可省略、指定一位staff或指定status。
- Appointment range以service start/end判斷window；occupancy buffer不對UI顯示。跨午夜appointment只要overlap就出現在window。

### Detail

- Consumer detail回下節owner-only presentation與完整status history。Consumer malformed/unknown/foreign appointment ID一律404。
- Merchant detail回calendar summary加status history；consumer僅有display name。STAFF必須直接以`tenantId + effectiveStaffId + appointmentId`查詢，同tenant其他staff、cross-tenant、unknown或malformed appointment皆404，不得先global lookup；只有list明送other staff filter才403。非member在任何tenant route固定403。
- History固定包含初始建立紀錄，依`createdAt ASC, id ASC`讀取；response item精確為`{ fromStatus: AppointmentStatus | null, toStatus: AppointmentStatus, createdAt }`，排除history ID、actor ID與reason（P3-005另定safe reason contract）。
- 讀取不寫audit，避免每次開日曆產生高成本PII access log；HTTP structured log只保留requestId、operation、outcome及安全tenant/appointment ID，不寫response或query cursor內容。

## Strict response allowlists

- Read DTO不含create-only的`appointmentCreated`。四個endpoint未列出的欄位一律不得回傳；所有timestamp都使用canonical UTC milliseconds。
- `ConsumerAppointmentSummary`精確包含：`id,status,pricingStatus,paymentStatus,timezone,startAt,endAt,confirmedAt,currency,subtotalAmount,depositAmount,totalAmount,service,staff,location`。`service`沿用P3-003完整price shape；`staff={ id, displayName }`；summary `location={ name, city, district }`。
- `ConsumerAppointmentDetail`為consumer summary加`policies={ version, bookingPolicy, cancellationPolicy, acceptedAt }`、完整`location={ name,addressText,postalCode,city,district }`與`history`。不含source或consumer。
- `MerchantAppointmentSummary`精確包含consumer summary的所有欄位，再加`source`與`consumer={ displayName }`；其location維持summary shape，不含address。`MerchantAppointmentDetail`只再加`history`，不加address/policies。
- Consumer list response精確為`{ asOf, items: ConsumerAppointmentSummary[], nextCursor: string | null }`；merchant list response如前節。Detail直接回對應detail DTO。
- Staff display name必須從`appointment.hold.staffDisplayNameSnapshot`讀取；repository可內部join consumed hold但不得回hold ID/欄位。禁止改讀current StaffProfile display name。只有merchant consumer display name明定join current `User.displayName`，空白時回固定「顧客」。
- `pricingStatus/paymentStatus`及nullable totals不得由reader重算；EXACT才有subtotal/total，ESTIMATE/QUOTE_REQUIRED維持null。Deposit目前固定0、payment目前固定NOT_REQUIRED。

## Data and implementation boundaries

- 新migration只新增查詢index：`(consumer_user_id, start_at, id)`、`(tenant_id, start_at, id)`與`(tenant_id, staff_id, start_at, id)`；不得改寫既有appointment snapshots。Migration必須fresh replay全部migrations及existing database deploy/no pending。
- Repository提供consumer list/detail與tenant list/detail四個tenant/identity-scoped方法。Controller不得直接使用Prisma；application service先驗active membership與role，再把effective staff scope傳入repository。
- Repository任何tenant query都必須在Prisma `where`最外層包含`tenantId`；detail不可先用global ID查出後才比tenant。Consumer query最外層必須包含`consumerUserId`。
- Cursor codec使用base64url UTF-8 strict JSON；raw cursor必須ASCII且UTF-8 bytes不超過512，decoded bytes也不超過512。Object只接受exact keys，version固定`1`；UUID為lowercase hyphenated canonical UUID、timestamp必須等於`Date#toISOString()`，optional staff/status固定用`null`。不持久化、不含PII、不用secret簽章；decode error統一400且不寫log。
- Status boundary以appointment row status及database `asOf`決定。P3-005狀態轉換上線後，pagination仍以cursor固定asOf，已變更資料可能在下一次fresh list反映；本slice不提供snapshot isolation跨request保證。

## Web experience

- 新增`/appointments`顧客頁：configured LINE/Firebase session時載入upcoming，能切換past、載入更多、展開明細；signed-out顯示LINE登入CTA。Disabled/local mode顯示`LOCAL PREVIEW · 不會讀取真實預約`及合成upcoming/past資料。
- `GET /v1/me`的membership DTO新增`tenantTimezone=Tenant.usageTimezone`。新增`/studio/appointments`並加入Studio導覽；正式頁必須先用selected membership的tenantTimezone，以該IANA timezone的今日local 00:00到第7天local 00:00換算UTC from/to，不得fallback browser timezone。DST日仍以七個local calendar days計算；API的31天限制則維持elapsed milliseconds。
- Calendar response的`calendarTimezone`必須等於該tenant usage timezone且Web以它做日期分組；每個item另以自己的`timezone=locationTimezoneSnapshot`格式化服務時間。可切前後週、today、staff與status並載入更多；LOCAL PREVIEW使用合成資料。不得用瀏覽器自行過濾完整tenant dataset冒充授權，正式模式每個filter都重新呼叫server API。
- 店家以mobile-first agenda cards為主，desktop可加日期分組；不在本slice做拖拉改期。顧客與店家皆必須呈現loading、empty、error、retry與pagination狀態，390×844無水平溢位或fixed element遮擋。
- 所有日期以response timezone格式化，禁止以瀏覽器timezone暗中改日；current profile顧客名只在merchant view顯示。狀態文案使用繁體中文且不把`CONFIRMED`誤譯為已付款。
- 四個read endpoints一律回`Cache-Control: private, no-store`。Web不得把response寫入localStorage、sessionStorage、IndexedDB或service-worker cache；登出或切tenant時component state必須卸載/清空，避免跨session沿用姓名或地址。

## Acceptance criteria

- [x] 第16個migration只新增三個有界查詢index；fresh database可重放全部16個migrations，existing database deploy成功且第二次no pending。
- [x] Consumer upcoming/past boundary、排序、limit、opaque cursor固定asOf與cross-page no-duplicate有unit/integration evidence；任何cursor篡改仍不能跨consumer。
- [x] Consumer detail只允許owner，malformed/unknown/foreign ID皆404；回完整address/policy/history但不回consumer ID、identity、hold、occupancy、usage或entitlement資料。
- [x] OWNER/MANAGER/VIEWER可查tenant calendar/detail；STAFF只計同tenant ACTIVE profile且bookingEnabled不影響read，未綁定/多綁定與list other-staff filter 403，detail other-staff/unknown/cross-tenant 404；inactive membership/nonmember 403。
- [x] Merchant range強制canonical UTC、`from < to`、最多31天、overlap semantics、limit<=200與filter-bound cursor；跨午夜及相同startAt以ID穩定排序。
- [x] Merchant response只回current consumer display name與營運必要snapshot，排除email、phone、avatar、LINE identity、完整地址、policy、notes與raw actor IDs。
- [x] 四個strict response allowlist、history nullable/tie-break、hold staff-name snapshot與merchant-only current consumer name有contract/integration evidence；所有read response含`Cache-Control: private, no-store`且Web不持久化payload。
- [x] 所有tenant-owned repository query最外層明確帶tenantId，consumer query帶consumerUserId；controllers不import Prisma，read API不寫audit或log payload/cursor/PII。
- [x] Price/status/timezone presentation不改寫P3-003 truth；EXACT/ESTIMATE/QUOTE_REQUIRED與所有appointment statuses都有contract tests。`/v1/me`回membership tenantTimezone，Studio以七個local-day boundary建立query，calendar response另區分tenant calendarTimezone與item location timezone。
- [x] `/appointments`與`/studio/appointments`完成configured/preview、loading/empty/error/retry/filter/detail/pagination states；desktop/mobile browser與console驗收通過。
- [x] OpenAPI、data dictionary、security/design contract、tests、lint、typecheck、build、architecture、migration replay、browser/live smoke與worklog完成。

## Non-goals

- 取消、改期、check-in、complete、no-show write endpoints（P3-005）。
- LINE/OA notification dispatch、reminder jobs或delivery tracking（P3-006）。
- CRM customer row、電話/email、顧客備註、標籤、搜尋或匯出（Phase 4）。
- 拖拉行事曆、resource timeline、Google/Apple Calendar sync、多據點彙總或analytics。
- 付款、退款、invoice、媒合費認列或subscription billing。

## External activation gates（不阻擋repository completion）

- [ ] Staging以真實LINE/Firebase consumer驗證自己的列表與foreign ID 404。
- [ ] 至少一位真實STAFF account綁定StaffProfile，驗證只能讀自己的calendar；目前repository/integration先建立synthetic identity evidence。
- [ ] Owner確認顧客display name在店家日曆的隱私告知文字；本slice不顯示其他contact/profile欄位。
