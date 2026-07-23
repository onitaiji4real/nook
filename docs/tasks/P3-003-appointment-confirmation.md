# P3-003 No-deposit appointment confirmation

狀態：`done`

## Outcome

讓已登入顧客把自己仍有效的booking hold，在單一PostgreSQL transaction內確認為免定金appointment。成功後hold不可再次消費、同一occupancy row由hold原子轉交appointment、狀態歷史與outbox event同時存在，顧客才看到「預約成立」及確認後可揭露的完整地址。

本slice建立真正的預約成立點，但不假裝通知已送達、不提前實作付款、取消改期、店家行事曆或CRM。P3-004才提供雙方列表；P3-005才開放後續狀態transition；P3-006才dispatch reminder／confirmation notification。

## Product and commercial decisions

- API固定為`POST /v1/appointments`，要求verified consumer bearer principal、UUID `Idempotency-Key`及strict body `{ holdId, policiesAccepted: true, policyVersion }`。`policyVersion`只能回傳server在hold階段發出的hash版本，不能傳政策文字。Consumer、tenant、staff、時間、價格、來源、地址與付款狀態都不能由browser指定。
- P3-003只處理免定金：初始appointment狀態直接為`CONFIRMED`，`paymentStatus=NOT_REQUIRED`、`depositAmount=0`。需要定金的流程必須等provider-neutral payment contract、payment intent與webhook idempotency另立task，不可用假付款成功繞過。
- Confirmation使用hold的service／staff／duration／price與service range snapshot，不因catalog在10分鐘內被修改而重算；tenant若已非ACTIVE則fail closed。Merchant unpublish、service/staff inactive不推翻已承諾且仍有效的hold，後續營運異常須走P3-005 cancellation並保留歷史。
- P3-003擴充hold建立流程，在hold transaction內保存店家公開booking/cancellation policy、完整location address及location timezone snapshot，response只公開policy文字與`policyVersion`，不提前公開完整地址。Canonical bytes精確等於Node `Buffer.from(JSON.stringify({ version: 1, bookingPolicy, cancellationPolicy }), 'utf8')`的compact ECMAScript JSON輸出，沒有額外whitespace；object insertion order如程式所示，政策字串採database原值、不做Unicode normalization。`policyVersion`為`v1:`加上述bytes的lowercase SHA-256 hex。Confirmation要求request版本完全相等，並把相同snapshots、顧客`policiesAcceptedAt`與version複製到appointment，消除顧客看過版本與實際保存版本不同的TOCTOU。這些只回給同一consumer或有權tenant actor；不得進HTTP/application log、audit JSON、outbox payload或公開marketplace response。
- Price truthfulness：FIXED（含staff price override）為`EXACT`，可寫`subtotalAmount/totalAmount`；FROM與RANGE為`ESTIMATE`、QUOTE為`QUOTE_REQUIRED`，兩者的amount totals保持null，response仍保留完整price shape。不能把最低價或區間上限冒充最後成交額。
- 新增`AppointmentSource = MERCHANT_LINK | MARKETPLACE | ADMIN | STAFF | IMPORT`。目前唯一consumer入口是店家永久連結，hold source由server固定為`MERCHANT_LINK`；migration以DB default `MERCHANT_LINK` backfill既有rows並保留default直到舊writer全部退場。Browser不得送source或attribution。未來MARKETPLACE必須由server驗證attribution token後在hold階段固定來源；P3-003不產生媒合費，只有後續完成服務且來源可驗證時才能計算8%義務。
- 新增tenant `usageTimezone`作訂閱用量的唯一權威時區，與顧客看到的location timezone分離。Migration先用`pg_timezone_names`驗證所有非空primary-location timezone；任何malformed IANA值直接中止並要求資料修復，不偷偷fallback。有效值用來backfill，只有沒有primary location／null／blank才用`Asia/Taipei`；欄位NOT NULL且DB default為`Asia/Taipei`，所有未來writer仍須以`Intl.DateTimeFormat`驗證IANA timezone。本slice沒有修改timezone的API。Appointment保存`usageTimezoneSnapshot`與`usageMonth=YYYY-MM`；response的`timezone`永遠是`locationTimezoneSnapshot`，Web用它顯示店家當地時間，usage timezone不對consumer公開。月份在確認後不重算，advisory lock固定`appointment-usage:{tenantId}:{usageMonth}`。未來若允許變更usage timezone，必須從下個完整月份生效，不可把同一實際月份拆成兩個bucket。
- `MAX_MONTHLY_BOOKINGS`為INTEGER entitlement，正整數是每個usage month可成立的consumer online appointments上限，`0`明定為unlimited。只計`MERCHANT_LINK/MARKETPLACE`，直接count不可刪除的appointment rows且不依目前status過濾；CANCELLED／NO_SHOW仍占原確認月份用量。`TRIALING/ACTIVE`從tenant所連plan解析，`FREE/PAST_DUE/CANCELED`從唯一`isDefault=true` plan解析；既有migration的partial unique index `plans_single_default_key WHERE is_default=true`是database invariant，本migration contract再次驗證它存在。Resolver仍以bounded find-many防禦性檢查，0或多於1筆default都回503，禁止`findFirst`任選。這是subscription lifecycle規則，不看plan code/name。缺plan、缺entitlement、負數或非整數fail closed 503；達上限回403，hold保持ACTIVE供店家調整方案後在expiry前重試。Migration只為目前唯一default plan明確寫20，不存在程式fallback 20。
- P3-003不建立customer CRM row。Appointment以global verified `consumerUserId`保存identity ownership；P3-004可安全查詢自己的預約，P4 CRM再以tenant-scoped customer projection連結，不提前複製LINE profile、電話或email。

## Domain and data model

- 新增`AppointmentStatus`：`CONFIRMED | CHECKED_IN | COMPLETED | CANCELLED | NO_SHOW | RESCHEDULED`。狀態機唯一allowlist為`CONFIRMED -> CHECKED_IN | CANCELLED | NO_SHOW | RESCHEDULED`、`CHECKED_IN -> COMPLETED`；`COMPLETED/CANCELLED/NO_SHOW/RESCHEDULED`皆terminal。`RESCHEDULED`表示舊appointment的terminal marker，P3-005在開放該transition時必須同transaction新增replacement link；P3-003沒有後續transition endpoint。付款相關狀態等payment task需要時再expand，不以未實作狀態製造假能力。
- 新增`PaymentStatus=NOT_REQUIRED`與`AppointmentPricingStatus=EXACT | ESTIMATE | QUOTE_REQUIRED`；P3-003 database constraint固定deposit為0、payment為NOT_REQUIRED，後續付款migration再expand。
- `appointments`保存tenant/location/staff/consumer/hold、status、source、service range、confirmedAt、`usageTimezoneSnapshot`、usage month、currency、nullable subtotal/total、deposit、policy/address snapshots、policy version與acceptance timestamp。Location snapshot為name、address text、nullable postal code、city、district、`locationTimezoneSnapshot`；policy兩欄在新hold建立時必須非null/nonblank，否則hold建立fail closed。`holdId`唯一且tenant-owned FKs均使用composite scope。
- `appointment_items`一筆保存hold的service ID/name、duration與FIXED/FROM/RANGE/QUOTE price shape。Database以unique appointment ID保證最多一筆，repository transaction保證至少一筆；普通FK/CHECK不宣稱可保證parent一定有child。未來多服務須另立migration並移除unique、重定義total invariant。
- `appointment_status_history`第一筆為`fromStatus=null -> CONFIRMED`，actor為verified consumer，timestamp使用同一transaction `dbNow`。任何後續status mutation只能呼叫`@nook/domain` appointment state machine並新增history，不可直接update enum。
- `appointment_confirmation_keys`保存`consumerUserId + SHA-256 keyHash`、request fingerprint及appointment ID。Key hash是raw UUID header的UTF-8 lowercase canonical UUID；fingerprint是SHA-256 UTF-8 compact `JSON.stringify({ version: 1, endpoint: 'appointments.create', holdId, policiesAccepted: true, policyVersion })`，object order固定且UUID lowercase。相同key／相同fingerprint回原appointment；不同回409，不探測request中的hold。BookingHold新增`(tenantId, consumerUserId, id)` unique，Appointment以`(tenantId, consumerUserId, holdId)` composite FK綁定owned hold並提供`(tenantId, consumerUserId, id)` unique；ConfirmationKey帶tenant/consumer並以相同composite FK指向appointment。Replay query仍明確包含consumerUserId。Appointment的holdId也唯一，因此同一owned hold換新key重送仍回原appointment，並在同transaction把新key綁到它；新key的policyVersion必須等於appointment保存版本。
- `outbox_events`保存`appointment.confirmed.v1`、aggregate ID、DB-unique dedupe key `appointment.confirmed:{appointmentId}:v1`、safe ID-only payload、status與available timestamp。Appointment、item、history、idempotency mapping、audit與outbox必須同transaction提交；本slice不把outbox row宣稱為LINE訊息已送出。
- `booking_occupancies`新增nullable unique `appointmentId`，並把`holdId`改nullable；database check要求恰好一個owner。Hold與appointment各提供`(tenantId, staffId, id)` composite unique，occupancy owner FK包含tenant/staff，避免跨tenant或換staff。Confirmation以單一UPDATE同時設`holdId=null, appointmentId=<id>`，occupied range與ACTIVE status不變；不得release再insert形成空窗。
- Service range invariant是`appointment.start/end = hold.start/end`；occupancy含buffer，必須保持原值並滿足`occupiedStart <= serviceStart < serviceEnd <= occupiedEnd`，不可誤要求兩個range相等。跨row時間containment由同transaction的locked-row驗證與integration test保護；不把普通CHECK宣稱成跨table constraint。
- EXACT要求item FIXED amount為非負整數minor units、min/max null，appointment `subtotal=total=item amount`；ESTIMATE+FROM要求amount為非負整數minor units、min/max null，ESTIMATE+RANGE要求amount null、`0 <= min <= max`；QUOTE_REQUIRED+QUOTE要求三者全null。ESTIMATE/QUOTE的subtotal/total必須null；所有case deposit=0、item/appointment currency相等。金額沿用現有整數minor-unit contract，TWD目前即整數元；本slice沒有稅、折扣或平台費。
- `booking_holds.status`從ACTIVE轉CONSUMED並保持原snapshot。Audit只寫actor/tenant/appointment/hold ID、from/to status與source；`beforeJson/afterJson`禁止policy、address、price、identity或request body。任何confirmation部分失敗全部rollback，但expired cleanup是下節明定的maintenance outcome例外。

## Expand-and-contract rollout

- Migration先新增nullable hold policy/address/source snapshots、appointment tables/owner欄位與constraints；`BookingHold.source`保留DB default，讓舊create writer仍可寫。Prisma migration的「可重跑」是指fresh database可順序重放全部migrations，既有database執行`migrate deploy`一次成功且第二次回no pending；不要求把同一DDL SQL literal執行兩次。
- 同一release必須更新所有P3-002 reader/writer：availability改讀所有ACTIVE occupancy，不再要求`hold` relation；hold release/expiry只以non-null `holdId`操作；create仍寫hold owner。所有mutating path統一先lock hold row、再lock/update occupancy，避免與confirmation反向鎖造成deadlock。
- Production/staging以`APPOINTMENT_CONFIRMATION_ENABLED=false`先跑migration並部署相容API，確認舊API revisions已drain後才以新revision啟用confirmation。若舊availability binary仍可能接流量，就不能建立第一筆appointment occupancy。新hold writer開始保存完整snapshot後等待舊hold最長10分鐘到期，再開啟confirmation；contract migration日後才移除hold source default或收緊nullable snapshots。

## Confirmation transaction

使用Serializable transaction，所有writer固定hold→occupancy row-lock順序；SQLSTATE `40001`／`40P01`或Prisma P2034最多總共嘗試三次（有限短退避），耗盡回503 `booking_confirmation_unavailable`且不consume hold：

1. Controller先驗證authentication、user status、UUID key及strict body。Missing/malformed key與body回400；holdId不是canonical UUID時固定privacy-safe 404。
2. 在任何snapshot query前以`consumerUserId + keyHash`取得transaction advisory lock，讀單一PostgreSQL `dbNow`，查confirmation key。Fingerprint相同直接回既有appointment；不同回409。Replay跳過tenant、entitlement與usage重算。
3. 以`SELECT ... FOR UPDATE`依`holdId + consumerUserId`鎖hold；未知或其他consumer固定404，再依status選擇occupancy owner。ACTIVE／RELEASED／EXPIRED必須鎖到exactly one相同tenant/staff且仍由hold擁有的occupancy；RELEASED要求occupancy也為RELEASED後回409且不改資料，既有EXPIRED要求occupancy也為EXPIRED後回409。若ACTIVE hold的`expiresAt <= dbNow`，occupancy必須仍ACTIVE，CAS同時把兩者設EXPIRED、保留hold owner，transaction以`expired` outcome正常commit，application在commit後回409；這不是拋例外後期待狀態留下。
4. CONSUMED不能再找hold-owned occupancy：先以`holdId + consumerUserId`取得唯一appointment，再鎖exactly one相同tenant/staff、`appointmentId`匹配且ACTIVE的appointment-owned occupancy，並驗證range仍包含原hold service range。接著驗證request policyVersion等於appointment版本，建立本次key mapping並回原appointment；不新增history/outbox、不改confirmedAt、不重算月額度。這是natural replay。上述任一路徑缺row、重複、owner/status/tenant/staff/range corruption都rollback並回503 `booking_confirmation_unavailable`，不能提交單邊狀態。
5. ACTIVE path驗證tenant仍ACTIVE、hold snapshot完整、policyVersion相等，且原ACTIVE occupancy owner、tenant、staff一致，原occupied range包含hold service range。Policy不符回409 `policy_version_mismatch`且不改hold；tenant inactive、snapshot缺漏或任何invariant corruption回503 `booking_confirmation_unavailable`並rollback。Catalog、location current value、merchant publication與staff active狀態不重新判斷，使用hold snapshots履行10分鐘承諾。
6. 解析effective entitlement，計算tenant timezone下的`usageMonth`，取得`tenantId + usageMonth` advisory lock，再直接count同month且source為MERCHANT_LINK/MARKETPLACE的appointment rows；`0`跳過上限。達上限或設定錯誤以例外rollback，hold保持ACTIVE。
7. 先建立appointment及item/history/safe audit/outbox，再以單一occupancy UPDATE同時設`holdId=null, appointmentId=<id>`，最後CAS把仍ACTIVE hold設CONSUMED並寫confirmation key。中間狀態只使用非deferrable FK可接受的順序；owner XOR check在單一UPDATE前後都成立。任一row count不符即rollback。
8. Transaction回`created | replayed | expired` discriminated outcome。Created與replayed都回原create representation HTTP 201；`appointmentCreated=true`表示response所代表的appointment已存在，不表示本次request一定insert。Expired在maintenance commit後回409。

兩個connection同時以不同keys確認同一hold只能得到同一appointment；同一consumer同時確認不同tenants／holds各自依occupancy與entitlement仲裁，不使用process memory mutex。

## API and response contract

- Request body額外欄位、`policiesAccepted !== true`、policyVersion格式錯誤、missing/malformed key回400；holdId missing/type錯誤回400，但格式非canonical UUID、未知或其他consumer固定privacy-safe 404。Authentication 401、inactive user 403。
- `hold_expired`、`hold_not_active`使用409；entitlement reached用403 `monthly_booking_limit_reached`並提供店家名額已滿的顧客安全文案，不向顧客顯示「請升級你的方案」。Entitlement configuration unavailable為503。
- Created、same-key replay與same-hold/new-key natural replay都回201同一representation；`appointmentCreated=true`是資源狀態欄位。Response包含appointment ID/status、source、timezone、service range、confirmedAt、service/staff/price snapshot、payment/pricing truth、policy version/snapshot及完整location snapshot。排除tenant ID、consumer ID、occupancy/buffer、internal note、identity profile與entitlement值。
- Full address只因request principal擁有該appointment而回傳。404／409／403 responses不得洩漏其他consumer、hold、tenant usage、方案名稱或競爭者資料。

## Web experience

- Hold response與ticket顯示server-snapshotted policies及policyVersion；checkbox明確接受該版本。只有consumer session ready、hold ACTIVE、倒數未歸零且checkbox勾選才可送出。按鈕文案不得是「付款」或在response前顯示成功；policy version mismatch要求重新建立hold，不可暗中接受新版。
- Creating appointment時鎖定重複submit並在該React intent記憶體沿用同一idempotency key；不把key持久化到Web Storage。Network failure保留key可retry；reload／另一tab可用新key並由same-hold natural replay安全回原appointment。409 expired／released／policy mismatch要求重新查詢；403 merchant limit顯示「店家目前無法接受更多線上預約」且不責怪顧客；401回登入流程；503保留hold畫面並提供稍後重試。
- 成功顯示`CONFIRMED · 預約成立`、店家當地日期時間、服務／staff／price truth、政策與完整地址。不得宣稱LINE通知已送達，只能說「預約已建立」。
- LOCAL PREVIEW明示模擬confirmation、不寫database、不發通知；desktop與390×844 mobile皆可在fixed bar不遮擋下完成hold→acknowledge→confirm。

## Acceptance criteria

- [x] Fresh database可順序重放全部15個migrations；原有13個migrations的database向前套用兩個P3-003 migrations一次成功、第二次no pending。既有hold occupancy仍合法，舊writer由source default相容；confirmation只在相容revision drain與舊hold expiry gate後啟用。
- [x] Database constraints固定tenant/staff/consumer composite owner scope、最多one item、price/pricing/total shape、policy acceptance、unique hold confirmation、idempotency mapping、outbox dedupe與occupancy恰一owner；至少one item與跨rowrange containment由transaction/integration證明，不做超出database能力的宣稱。Corrupt cross-consumer key/appointment/hold fixture不可讀到完整地址。
- [x] Domain unit tests固定initial no-deposit confirmation及完整allowlist：CONFIRMED可到CHECKED_IN/CANCELLED/NO_SHOW/RESCHEDULED，CHECKED_IN只可到COMPLETED，四個terminal不能離開。Repository/API不得繞過state machine直接決定to-status。
- [x] 兩個獨立connections同時確認同一hold只建立一筆appointment/item/history/outbox，兩方都得到同一appointment；occupancy始終ACTIVE且沒有release/insert空窗。
- [x] Appointment、item、history、safe audit、outbox、key mapping、hold CONSUMED與occupancy owner transfer任一失敗全部rollback。Released/cross-consumer/unknown hold不建立任何partial rows；expired path只允許hold/occupancy同時轉EXPIRED並先commit，再回409。
- [x] Idempotency同key同hold及同hold新key都回原appointment；同key不同hold回409。Replay不新增history/outbox、不重算月額度、不改confirmedAt；raw key、policy/address、consumer profile不得寫log或outbox。
- [x] Monthly entitlement依subscription lifecycle從effective plan generic code解析，並在tenant/usageMonth lock下仲裁；第limit+1筆即使併發也拒絕，0為unlimited，缺失／非法值／default plan數量異常503且沒有fallback 20。Tenant usage timezone與location response timezone各自有snapshot與邊界測試；取消等後續狀態不退usage，replay不重複計數，limit failure不consume hold。
- [x] Confirmation使用hold catalog/policy/address/source snapshots；FIXED/staff override為EXACT且subtotal=total=item amount，FROM/RANGE為ESTIMATE null totals，QUOTE為QUOTE_REQUIRED null totals。Browser不能注入price、source、tenant、staff、time、consumer、address或payment狀態。
- [x] Initial status為CONFIRMED、payment為NOT_REQUIRED、deposit為0；history actor來自principal。Response標示`appointmentCreated=true`，不把outbox row冒充已送通知。
- [x] Hold先回policy snapshot/version但不回完整地址；canonical hash有固定test vector，confirmation只接受相同version。Confirmed owner可收到相同policy與完整address snapshot；其他consumer固定404。公開merchant/hold不因appointment schema新增而洩漏地址。
- [x] P3-002 release/expiry/create與P3-003 confirmation統一hold→occupancy lock order；availability納入全部ACTIVE occupancy。Serialization/deadlock三次耗盡回503且沒有partial state。
- [x] Web configured session完成acknowledgement/loading/retry/expired/limit/confirmed states；mobile可操作且LOCAL PREVIEW誠實。一般顧客從held到confirmed不超過一次acknowledgement與一次CTA。
- [x] Shared contracts、OpenAPI、ADR、data dictionary、security/design contract、tests、lint、typecheck、build、architecture、browser及live smoke通過；worklog記錄失敗重跑與remaining risks。

## Non-goals

- 定金、付款provider、refund、payment webhook或`PENDING_PAYMENT`。
- 店家／顧客appointment list、日曆、搜尋或staff admin操作；屬P3-004。
- Cancel、reschedule、check-in、complete、no-show endpoints；屬P3-005。
- 實際LINE/OA notification、reminder dispatcher與delivery tracking；屬P3-006。
- Customer CRM、電話/email收集、customer note、internal note、評論、媒合費invoice或GMV settlement。
- Browser自報MARKETPLACE來源、未驗證attribution token、依方案名稱分支或把hold計入月預約額度。

## External activation gates（不阻擋repository completion）

- [ ] 真實LINE／LIFF→Firebase configured session在staging完成hold→confirmation，並證明完整地址只回同一consumer。
- [ ] Owner確認Free／付費方案的正式`MAX_MONTHLY_BOOKINGS`值與`0=unlimited`營運定義；repository先以現有default plan=20建立contract。
- [ ] P3-006部署前完成LINE service-message／OA channel、通知模板與費用歸屬；P3-003 outbox不等於provider delivery。
