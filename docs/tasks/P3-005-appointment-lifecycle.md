# P3-005 Appointment lifecycle: cancel, attendance and reschedule

狀態：`done`

## Outcome

讓顧客依成立時已接受的結構化規則取消或改期自己的預約，並讓店家在RWD工作台安全執行取消、報到、完成與未到店。每次轉換都由domain state machine決定、在PostgreSQL transaction內寫history、audit與outbox；取消或改期要釋放occupancy，改期必須保留舊預約並原子建立replacement，不覆寫歷史時間。

本slice不處理退款、定金、實際LINE通知delivery、CRM備註或媒合費結算。`COMPLETED`只成為未來verified attribution／settlement的必要輸入，不直接產生8%債務或invoice。

## Product and commercial decisions

- 現有`MerchantProfile.cancellationPolicy`是提供顧客閱讀的自由文字，不能被parser當成執行規則。`BookingPolicy`新增`consumerCancelLeadMinutes`與`consumerRescheduleLeadMinutes`，預設皆為1440、允許0至43200；0表示`dbNow < startAt`前皆可自助操作，startAt exact instant不允許，43200為30天。Owner/Manager可在店家政策頁修改，其他角色只讀。
- 建立hold時把兩個lead minutes與依該hold `startAt`算出的deadline放進policy presentation，confirmation複製到appointment snapshot。既有hold與appointment由migration保守backfill 1440；後續店家改設定不回溯改變既有預約。
- 新hold的`policyVersion`升為v2：canonical bytes精確為compact Node `JSON.stringify({ version: 2, bookingPolicy, cancellationPolicy, consumerCancelLeadMinutes, consumerRescheduleLeadMinutes })` UTF-8 bytes，object insertion order如列示，hash為`v2:`加lowercase SHA-256 hex。Hold transaction先形成將實際寫入row的五個snapshot value，再從同一in-memory value object計算hash；禁止二次查current policy或由response重算。既有v1 appointment及由v1 hold確認的appointment可用backfilled lead snapshot取消或作reschedule source，merchant lifecycle也不受policyVersion限制；只有reschedule target hold必須v2。
- Fixed vectors：v1 `('完全預約制','提前24小時')`維持`v1:45e250fe267c7d46d979461c4192a671359ececb21d2738e044b3f4615ccc024`；相同文字加兩個1440的v2為`v2:68ad4ba258354505ca2749f74a30f739ee9194d4b58c93819882fa30aae23dff`。Tests必須證明任一lead改變會改v2 hash、v1 confirmation不以v2重算。
- 顧客cancel/reschedule只允許`CONFIRMED`。Snapshot lead大於0時要求database `dbNow <= startAt - snapshotLeadMinutes`並允許exact deadline；lead為0時要求`dbNow < startAt`。逾期固定409並提示聯絡店家，不解析自由文字、不自行收費，也不允許consumer把已報到預約改成terminal。
- 店家OWNER/MANAGER可處理全店，ACTIVE STAFF只處理同tenant且唯一ACTIVE StaffProfile所屬預約；VIEWER、inactive membership、未綁定或多重STAFF綁定皆403。STAFF路由必須直接以`tenantId + effectiveStaffId + appointmentId`scope，其他staff、foreign或unknown appointment固定404。
- 店家取消只允許`CONFIRMED`且不受consumer self-service deadline限制；店家需選controlled reason code。報到只允許`CONFIRMED`且`dbNow >= startAt - 120 minutes`；未到店只允許`CONFIRMED`且`dbNow >= endAt`；完成只允許`CHECKED_IN`且`dbNow >= startAt`。這些時間由database clock仲裁，browser顯示只作提示。
- 取消與no-show不退`MAX_MONTHLY_BOOKINGS`用量；改期replacement不新增用量，整條reschedule chain只由最初root appointment計一次。月額度依root成立來源分類：只有root source為`MERCHANT_LINK/MARKETPLACE`時計一次；`ADMIN/STAFF/IMPORT` root即使顧客後續自助改期也不轉成online usage，未來若變更需另立ADR與migration。
- 本slice只保存appointment origin `source`，不宣稱存在已驗證MARKETPLACE attribution。`source=MARKETPLACE`單獨永遠不足以產生媒合義務；在server-verified immutable attribution model上線前，所有appointment的媒合費資格均為`UNVERIFIED`且不得計費。未來義務還須同時滿足唯一leaf為COMPLETED、明確final service amount、該consumer在該tenant的首次合格完成服務，並以database unique constraint保證每個`tenantId + consumerUserId`最多一次；ESTIMATE、QUOTE_REQUIRED、catalog現價、root舊價格或null fallback都不得推算8%，上限NT$250只在settlement domain計算。
- Reason只存全域不重疊的controlled code，不接受自由文字、顧客備註、電話或其他PII。Consumer cancel：`CONSUMER_CHANGE_OF_PLANS | CONSUMER_SCHEDULE_CONFLICT | CONSUMER_BOOKED_ELSEWHERE | CONSUMER_OTHER`；merchant cancel：`MERCHANT_CUSTOMER_REQUEST | MERCHANT_STAFF_UNAVAILABLE | MERCHANT_BUSINESS_CLOSURE | MERCHANT_DUPLICATE | MERCHANT_OTHER`；reschedule：`RESCHEDULE_SCHEDULE_CONFLICT | RESCHEDULE_PREFERENCE_CHANGE | RESCHEDULE_OTHER`。Initial CONFIRMED、CHECKED_IN、COMPLETED與NO_SHOW history的reasonCode固定null；CANCELLED與舊appointment的RESCHEDULED history必須使用對應route子集合，replacement initial CONFIRMED reasonCode仍為null。

## State machine and occupancy

- 唯一allowlist維持：`CONFIRMED -> CHECKED_IN | CANCELLED | NO_SHOW | RESCHEDULED`、`CHECKED_IN -> COMPLETED`；`COMPLETED/CANCELLED/NO_SHOW/RESCHEDULED`皆terminal。Application與repository不得自行維護第二份transition matrix，必須呼叫`@nook/domain`。
- `CANCELLED`、`NO_SHOW`與舊預約的`RESCHEDULED`在同一transaction把appointment-owned ACTIVE occupancy改為RELEASED。`CHECKED_IN`及`COMPLETED`保留ACTIVE occupancy，保存實際占用歷史並避免日後匯入重疊紀錄；過去range不會阻擋未來availability。
- 每次成功transition新增一筆`AppointmentStatusHistory`，固定`fromStatus/toStatus/actorUserId/reasonCode/createdAt`；不更新舊history。既有nullable `reason`欄保留且不backfill，P3-005 writer永不寫它；新增nullable enum `reasonCode`，reader只回controlled code。
- 每次成功transition同transaction新增ID-only outbox event，payload只含`appointmentId`及reschedule時的`replacementAppointmentId`。P3-006才依目前狀態建立／取消提醒及送LINE，不得在本slice宣稱通知已送達。
- Lifecycle event type固定為`appointment.cancelled.v1 | appointment.checked_in.v1 | appointment.completed.v1 | appointment.no_show.v1 | appointment.rescheduled.v1`；對應dedupe key逐項固定為`appointment.cancelled:<id>:v1 | appointment.checked_in:<id>:v1 | appointment.completed:<id>:v1 | appointment.no_show:<id>:v1 | appointment.rescheduled:<id>:v1`，ID永遠是source appointment。Unique collision只有在已證明相同結果的replay可接受，其他情況視為corruption並rollback 503。

## Consumer contracts

### Cancel

`POST /v1/me/appointments/:appointmentId/cancel`：

- 必須authenticated且owner由principal `userId`推導；malformed、unknown或其他consumer ID一律privacy-safe 404。
- Header要求`Idempotency-Key`，body strict為`{ reasonCode }`且只能使用consumer cancel enum。
- 成功或same-key replay回200 `AppointmentTransitionResponse`；terminal/invalid transition或超過deadline回409。Response固定`Cache-Control: private, no-store`。

### Reschedule

`POST /v1/me/appointments/:appointmentId/reschedule`：

- 顧客先使用既有booking-hold API鎖住新slot，再送strict body `{ holdId, policyVersion, policiesAccepted: true, reasonCode }`與`Idempotency-Key`；checkbox不得預勾，非literal true固定400。在同一transaction `dbNow`下，target hold必須`status=ACTIVE && expiresAt > dbNow`、屬同consumer、同tenant、同location與同service且policyVersion為v2；staff、時間、當前price與policy可變，並以target hold presentation為顧客即將接受的truth。
- Target `holdId` missing/type非string為400；string但非lowercase canonical UUID、unknown或非owner，在source owner scope成功後統一404 `target_hold_not_found`。Owned target為EXPIRED永遠回409 `target_hold_expired`；ACTIVE但`expiresAt <= dbNow`須先原子把hold/occupancy設EXPIRED並commit maintenance outcome，再回同碼且old appointment不變，讓network retry結果穩定。RELEASED/CONSUMED回409 `target_hold_not_active`，policy不符回409 `policy_version_mismatch`，v1回409 `policy_version_unsupported`，tenant/location/service不符回409 `reschedule_target_mismatch`。除expiry maintenance外，任何target驗證失敗都不得改old或target。
- Target hold成立後沿用P3-003承諾：reschedule只重驗Tenant.status=ACTIVE，不重查merchant publication、location/service/staff current status，使用hold snapshots履約。Tenant不再ACTIVE回503 `reschedule_target_unavailable`且old/target不變。
- `policyVersion`必須與target hold snapshot完全相等；新appointment採target hold的staff/time/price/address/policy snapshots，但保留root appointment的`source`、`usageMonth`與`usageTimezoneSnapshot`，避免改期洗掉MARKETPLACE attribution或繞過月額度。
- Target hold的`source`及任何未來attribution欄位一律忽略；replacement逐筆從direct predecessor複製`source/usageMonth/usageTimezoneSnapshot`，並驗證與`rescheduleRootId`指向root的值完全相等，不一致、循環、斷鏈或跨owner視為corruption並rollback 503。未來attribution model上線後也必須沿chain immutable繼承，不能由target hold覆寫或新建。
- 單一Serializable transaction鎖old appointment、target hold及兩筆occupancy，建立replacement appointment/item/initial history、將old標為RESCHEDULED並寫history、把old occupancy設RELEASED、把target occupancy owner由hold原子轉給replacement、consume hold、寫idempotency/audit/outbox與one-to-one link。Replacement的`policiesAcceptedAt/confirmedAt/createdAt`、兩筆新history與transition result `occurredAt`都使用同一`dbNow`。任一步失敗必須完整rollback，舊預約與target hold保持原狀。
- Replacement以nullable unique `rescheduledFromId`指向直接前一筆，並以nullable `rescheduleRootId`直接指向chain root；root兩欄皆null，第一個replacement兩欄都指root，後續replacement繼承predecessor的root ID。Reverse relation可取得唯一`rescheduledTo`。A→B→C每次保留舊row，不允許覆寫A/B時間，也不允許terminal appointment再次改期。
- Same key/same fingerprint與same old+same target+same business inputs的natural replay回同一replacement；same key/different fingerprint、old已被另一請求改期或target hold已被其他流程consume均409。Unknown/foreign old appointment或hold對consumer固定404。
- Natural replay須在同一transaction為目前key建立`AppointmentTransitionKey`，`occurredAt`沿用原RESCHEDULED history時間；不得新增history、audit或outbox。建立前仍先套same-key fingerprint規則，確保該key之後不能被另一mutation重用。
- Reschedule在source owner scope與row lock後的error order固定為：(1) current authorization；(2) same-key replay/conflict；(3) source為RESCHEDULED時，只有唯一successor `holdId`等於request target、successor policyVersion等於request version、source唯一RESCHEDULED history reasonCode等於request reason、`policiesAccepted=true`且chain invariants一致才natural replay，target可已CONSUMED；任一business input不同回409 `invalid_appointment_transition`且不建新key；(4) natural replay未命中後，source status必須精確為CONFIRMED且不得已有successor，CHECKED_IN或任何terminal status一律先回409且不得讀/改target；(5) 驗source lead snapshot deadline，不合回409且不得讀/改target；(6) target owner lookup/expiry maintenance；(7) target tenant ACTIVE、v2 policy與tenant/location/service match；(8) domain mutation。

## Merchant contracts

以下endpoint都要求ACTIVE membership、strict JSON、`Idempotency-Key`及`Cache-Control: private, no-store`：

- `POST /v1/tenants/:tenantId/appointments/:appointmentId/cancel` body `{ reasonCode }`。
- `POST /v1/tenants/:tenantId/appointments/:appointmentId/check-in` body `{}`。
- `POST /v1/tenants/:tenantId/appointments/:appointmentId/complete` body `{}`。
- `POST /v1/tenants/:tenantId/appointments/:appointmentId/no-show` body `{}`。

Invalid state、過早報到／完成／no-show回409；非member/VIEWER/無有效STAFF scope回403；已授權actor的malformed/unknown/foreign/other-staff appointment回404。不得先global lookup再判tenant或staff。

所有route要求principal User仍為ACTIVE。Consumer cancel不因tenant SUSPENDED/CLOSED失去取消既有承諾的權利。Consumer reschedule的target hold在建立當下已要求published merchant；reschedule mutation不重查current publication、location/service/staff status，只重驗Tenant.status=ACTIVE，tenant非ACTIVE回503 `reschedule_target_unavailable`，merchant其後unpublish但tenant仍ACTIVE時仍履行已成立target hold。Merchant lifecycle屬履約與歷史紀錄，只要求tenant存在及ACTIVE membership，不以Tenant.status阻擋cancel/check-in/complete/no-show。每次request在同一Serializable transaction重新讀current User、Membership及STAFF profile後才查idempotency key；replay不繞過目前authorization。

新增`BOOKING_POLICY_V2_WRITES_ENABLED`與`APPOINTMENT_LIFECYCLE_ENABLED`。Development/test缺值解析true；staging/production缺值解析false並允許服務以disabled capability啟動；只有ASCII `true|false`合法，其他值使startup validation失敗。Web runtime config同時取得兩個capability並隱藏未啟用CTA，不只在點擊後顯示503。

Mixed-version rollout固定順序：(1) expand migration；(2) 部署兼容v1/v2 reader/writer；flag=false時新hold仍產生既有v1 canonical version、四個lead欄由DB default 1440，confirmation同時接受v1/v2並複製row snapshot；(3) 舊writer revision完全drain後設`BOOKING_POLICY_V2_WRITES_ENABLED=true`，從該切換點起hold writer必須顯式寫current lead snapshots並只產生v2，禁止再產生v1，policy PUT才開放；(4) 等切換點前最後一筆v1 ACTIVE hold `expiresAt <= dbNow`後才設`APPOINTMENT_LIFECYCLE_ENABLED=true`。

Capability-disabled是通用error order的明確例外：consumer transition在ACTIVE User檢查後、merchant transition在User與route-level tenant membership/role/STAFF binding authorization後，但都在appointment/hold lookup、key及body validation前檢查lifecycle flag，關閉固定503。Policy PUT在OWNER/MANAGER、Tenant.status authorization後但在revision/body validation前檢查v2 writes flag，關閉固定503；GET不受兩flag限制。

STAFF effective scope精確為route `tenantId + principal userId + status=ACTIVE`，同tenant恰好一筆才成立，0或多於1筆固定403；其他tenant profile不計，`bookingEnabled`不影響歷史lifecycle，OWNER/MANAGER即使另有profile仍採全店scope。

## Shared transition response and idempotency

`AppointmentTransitionResponse` exact allowlist：

```json
{
  "appointmentId": "uuid",
  "status": "CANCELLED",
  "occurredAt": "2026-07-22T12:34:56.789Z",
  "replacementAppointmentId": null
}
```

- `replacementAppointmentId`只有RESCHEDULED成功時為UUID，其餘固定null。所有timestamp為canonical UTC milliseconds。
- `Idempotency-Key`沿用booking contract：ASCII 16至128 bytes，只儲SHA-256 hash。`AppointmentTransitionKey` exact fields為`actorUserId UUID, keyHash CHAR(64), tenantId UUID, sourceAppointmentId UUID, action AppointmentTransitionAction, requestFingerprint CHAR(64), resultStatus AppointmentStatus, occurredAt timestamptz, replacementAppointmentId UUID nullable, createdAt timestamptz`；PK為`actorUserId,keyHash`。Actor FK連User，source/replacement各以tenant composite FK連Appointment且ON DELETE RESTRICT；hash欄位有lowercase 64-hex check。
- `AppointmentTransitionAction`固定為`CONSUMER_CANCEL | CONSUMER_RESCHEDULE | MERCHANT_CANCEL | MERCHANT_CHECK_IN | MERCHANT_COMPLETE | MERCHANT_NO_SHOW`。DB check固定action/result：兩種cancel→CANCELLED、reschedule→RESCHEDULED且replacement non-null、check-in→CHECKED_IN、complete→COMPLETED、no-show→NO_SHOW，非reschedule replacement必須null。
- Fingerprint精確為SHA-256 of UTF-8 compact `JSON.stringify({ version: 1, endpoint, tenantId, appointmentId, holdId, policyVersion, policiesAccepted, reasonCode })`；object insertion order固定如列示、UUID為lowercase canonical，consumer route `tenantId=null`，每個action未使用欄位固定null。Endpoint只能取logical enum `consumer.cancel | consumer.reschedule | merchant.cancel | merchant.check_in | merchant.complete | merchant.no_show`，不得使用raw URL、host、query或path文字。
- Current authorization及requested appointment scope成功後，同key同fingerprint重播原representation，不重寫history/audit/outbox、不再次釋放occupancy；同key不同fingerprint回409。Natural replay只允許能由source appointment與link唯一證明相同結果的reschedule；其他不同key對terminal status回409，不假裝成功。
- Error沿用repository既有exact `ProblemDetails { type,title,status,detail,instance,requestId,code }`與`application/problem+json`，不得新增resource data。通用order固定：缺少/無效credential 401；inactive User 403；malformed tenant UUID 400；valid tenant但nonmember/inactive membership/role不足或STAFF綁定異常403；完成tenant authorization後，malformed/unknown/foreign/other-staff appointment UUID統一404 `appointment_not_found`。Missing/malformed key、malformed JSON、extra/missing/wrong-type body欄位400；合法資源的state/time/fingerprint business conflict 409；invariant corruption或bounded retry耗盡503。
- Lifecycle code固定為`appointment_not_found | target_hold_not_found | idempotency_conflict | invalid_appointment_transition | consumer_action_deadline_passed | appointment_action_too_early | target_hold_expired | target_hold_not_active | policy_version_mismatch | policy_version_unsupported | reschedule_target_mismatch | reschedule_target_unavailable | appointment_lifecycle_unavailable | appointment_lifecycle_corruption | appointment_lifecycle_retry_exhausted`；同一privacy class使用完全相同title/detail，不因foreign/unknown差異改文案。
- Policy-specific code固定為`booking_policy_unavailable | booking_policy_update_unavailable | booking_policy_revision_conflict`；authentication/validation沿用既有`authentication_required | invalid_token | account_inactive | forbidden | invalid_request`。所有code與HTTP status有OpenAPI及contract test，不以detail文字供Web分支。

## Policy settings and read presentation

- 新增`GET/PUT /v1/tenants/:tenantId/booking-policy`。GET允許ACTIVE OWNER/MANAGER/VIEWER/STAFF且STAFF不需StaffProfile；唯一ACTIVE StaffProfile規則只適用四個merchant appointment mutation endpoints。PUT只允許OWNER/MANAGER、Tenant.status=ACTIVE且v2 policy writes capability已開啟。
- BookingPolicy migration已為所有tenant backfill row；授權後row缺失是corruption，GET/PUT固定503 `booking_policy_unavailable`且PUT不得upsert。GET與成功PUT皆回200、`Cache-Control: private, no-store`及exact `BookingPolicyResponse { revision, slotIntervalMinutes, minimumLeadMinutes, maximumAdvanceDays, consumerCancelLeadMinutes, consumerRescheduleLeadMinutes, updatedAt }`，updatedAt為canonical UTC milliseconds，不回tenant/plan/internal欄位。
- PUT strict body完整包含`expectedRevision`及五個設定值；ranges精確為revision integer>=1、slot interval `5|10|15|20|30|60`、minimum lead 0..10080、maximum advance 1..365、兩種consumer lead 0..43200。Update以tenantId+expectedRevision CAS、成功revision+1；0 rows回409 `booking_policy_revision_conflict`，body/range錯400。Policy PUT不使用AppointmentTransitionKey；network uncertainty由GET刷新revision後處理，相同成功update只寫一次audit。
- `/studio/policies`提供RWD設定，直接顯示「0代表開始前皆可自助」與30天上限；自由文字取消政策仍在商家資料頁，UI不得暗示文字會被系統解析。
- DB只持久化`consumerCancelLeadMinutesSnapshot/consumerRescheduleLeadMinutesSnapshot`；deadline不另存，每次以stored startAt與snapshot計算，禁止讀current BookingPolicy。`cancelUntil/rescheduleUntil`永遠等於startAt減snapshot minutes並使用canonical UTC milliseconds；lead=0時until等於startAt但inclusive=false，lead>0時inclusive=true。
- Hold policy presentation及consumer appointment detail `policies`新增`consumerCancelLeadMinutes, consumerRescheduleLeadMinutes, cancelUntil, rescheduleUntil, cancelUntilInclusive, rescheduleUntilInclusive`。Web依inclusive顯示「之前」或「含該時間」。Consumer detail另加`rescheduleContext: { merchantSlug, serviceId, locationId } | null`，只在current tenant仍published、location/service可用且此appointment可作reschedule source時由server產生；Web只能用它啟動slug-based availability/hold，不能拼tenant ID。
- Detail lifecycle代表「目前可由此client執行」，不是純domain eligibility；lifecycle flag=false時consumer與merchant `allowedActions=[]`。Consumer exact DTO為`{ evaluatedAt, allowedActions }`，enum順序固定`CANCEL | RESCHEDULE`；RESCHEDULE出現iff status/deadline合格且rescheduleContext non-null，CANCEL出現iff cancel合格。Runtime config只提前隱藏，detail response是最終權威，UI不得用browser clock放寬。
- Merchant exact DTO為`{ evaluatedAt, allowedActions, checkInAvailableAt, completeAvailableAt, noShowAvailableAt }`；enum固定且依`CANCEL | CHECK_IN | COMPLETE | NO_SHOW`排序，三個availableAt永遠為canonical UTC milliseconds且分別等於startAt-120m、startAt、endAt，不因current status變null。Database clock、current role/scope/status/time決定allowedActions；mutation仍重驗，409後refresh。
- Web不把transition response、顧客姓名、地址或policy寫入localStorage/sessionStorage/IndexedDB/service-worker cache。成功後清掉當前detail state並重新抓取；切tenant或登出卸載所有appointment mutation state。

## Database and transaction boundaries

- 第17個expand migration新增BookingPolicy兩個lead欄與`revision`、BookingHold與Appointment各兩個lead-minute snapshot欄位、Appointment `rescheduledFromId/rescheduleRootId`、history `reason_code`及transition idempotency table。六個lead欄全部以`NOT NULL DEFAULT 1440`新增並加0..43200 check，DB default至少保留至另立contract migration；v2 writer必須顯式寫值。既有BookingPolicy row保留三個舊值並補lead=1440/revision=1；缺row tenant deterministic insert `(15,120,60,1440,1440,revision=1)`，既有hold/appointment backfill 1440。Migration不得刪欄位、改寫既有status/history或由application startup執行。
- Self-link使用既有`(tenantId,consumerUserId,id)` unique，並加CHECK要求兩欄同為null或同為non-null及禁止指向自己。Prisma使用具名`AppointmentRescheduledFrom`與`AppointmentRescheduleRoot` self relations：direct predecessor fields `[tenantId,consumerUserId,rescheduledFromId]`及相同順序`@@unique`供一對一，另保留`rescheduledFromId`全域UNIQUE；root fields `[tenantId,consumerUserId,rescheduleRootId]`為many-to-one不加unique。兩者皆composite FK、ON DELETE RESTRICT。Link只能在replacement INSERT設定，repository不得更新/清空；source必須CONFIRMED且尚無successor。
- 所有write query最外層明確帶consumer owner或tenant/staff scope。Transition transaction使用PostgreSQL `transaction_timestamp()`作唯一`dbNow`，以row lock/CAS防兩個actor同時改同一appointment；serialization/deadlock最多bounded retry三次，耗盡回503且不得留下partial state。
- 所有lifecycle transaction固定依序取得：(1) actor+key advisory lock，(2) source appointment row，(3) target hold row（reschedule only），(4) 涉及的booking occupancy rows依ID ASC一次`SELECT ... FOR UPDATE`；不得反向加鎖。Same-key lookup在advisory lock及current authorization後、任何domain mutation前執行。
- Old appointment occupancy必須exactly one且tenant/staff/appointment owner相符、holdId null、status ACTIVE、occupied range包含appointment service range；target occupancy必須exactly one且tenant/staff/hold owner相符、appointmentId null、status ACTIVE且range包含target hold service range。Buffer使occupancy不要求等於service range。
- Cancel/no-show/reschedule release只CAS status為RELEASED，保留appointment owner與range；target transfer以單一CAS清holdId、設replacement appointmentId並維持ACTIVE，target hold CONSUMED CAS也須exactly one。缺失、多筆、owner/status/range不一致視為corruption，rollback並503。Check-in/complete驗證occupancy仍ACTIVE但不釋放。
- P3-003月額度唯一predicate為`tenantId=? AND usageMonth=? AND source IN (MERCHANT_LINK,MARKETPLACE) AND rescheduledFromId IS NULL`，不加status、root ID、appointment time或current plan filter。既有rows link皆null所以仍是root；replacement必須non-null不計。取消、no-show、completed及rescheduled root都仍計一次。未來settlement只看chain唯一leaf；RESCHEDULED ancestors永不結算，ledger以root appointment ID作唯一商業去重鍵，金額取COMPLETED leaf的明確final amount，source/verified attribution取immutable root chain。

## Audit, logging and client retry

- DB audit只在首次成功domain transition與成功BookingPolicy PUT寫入；same-key/natural replay、4xx/503及target expiry maintenance均不寫audit。Transition audit `action`固定使用AppointmentTransitionAction enum；metadata exact allowlist為`appointmentId, action, reasonCode, replacementAppointmentId, requestId`，nullable欄位省略，不寫outcome或body。Policy update沿用`booking_policy.update` operation並只記revision與requestId。
- Structured application log exact allowlist為`requestId, operation, outcome, httpStatus`及完成authorization後的safe `tenantId/appointmentId`；operation固定六個logical transition與`booking_policy.get|booking_policy.update`，outcome固定`success|replayed|rejected|unavailable`。不得寫raw key/hash/fingerprint/body、holdId、consumerId、policy/address/name、自由文字或error stack。
- Web在使用者確認mutation時只於memory產生一次idempotency key；只對timeout/network error、401經token refresh後及503，以原key重試相同canonical request。任何2xx或4xx停止retry並清key；修改任一fingerprinted欄位必產生新key。切tenant/登出一律清除，絕不持久化。

## Web experience

- `/appointments`在configured與LOCAL PREVIEW detail提供取消與改期。取消先顯示accepted cancellation policy、server deadline與controlled reason；改期沿用公開頁availability＋hold流程，清楚顯示新舊時間、staff、price與policy差異，確認前不改舊預約。
- `/studio/appointments`detail依role/status顯示允許的取消、報到、完成、未到店操作；每個 destructive action都有確認畫面、loading、retry、success與409 stale-state refresh。VIEWER與非所屬STAFF不顯示write CTA。
- `/studio/policies`完成結構化規則設定。Desktop與390×844不得水平溢位、fixed CTA不得遮擋內容；狀態文案使用繁體中文，`CONFIRMED`仍顯示「已確認・未付款」，不把狀態轉換誤稱付款或LINE通知成功。

## Acceptance criteria

- [x] 第17個migration為backward-compatible expand；lead snapshot、self-link、reason code、idempotency與DB checks完整，fresh replay全部migrations及existing deploy/no-pending通過。
- [x] Domain matrix是唯一transition allowlist；所有allowed/forbidden pair、時間boundary及terminal behavior有unit evidence。
- [x] Consumer cancel owner/privacy、deadline exact boundary、reason allowlist、same-key replay、conflict與occupancy release有API/database integration evidence。
- [x] Merchant OWNER/MANAGER/assigned STAFF與VIEWER/other STAFF/nonmember矩陣、過早action、unknown/foreign privacy、audit及outbox有integration evidence。
- [x] Cancel/no-show/reschedule只在同transaction釋放一筆正確occupancy；check-in/complete保留ACTIVE，corruption/serialization failure fail closed且無partial writes。
- [x] Reschedule transaction保留舊row、建立唯一replacement link、使用target snapshots、保留root source/usage、consume target hold且併發只能一方成功；任何失敗完整rollback。
- [x] Booking quota只計root一次；cancel/no-show不退、A→B→C不重複計數，MARKETPLACE attribution不因改期變MERCHANT_LINK。
- [x] Booking policy GET/PUT、snapshot/backfill、hold/deadline presentation及自由文字不被解析都有contract/integration evidence。
- [x] 六個appointment lifecycle transition要求authorization、strict body、idempotency、private no-store；policy PUT以revision CAS防lost update；logs/audit/outbox不含raw key、body、policy、address、consumer name或其他PII。
- [x] Consumer與merchant RWD操作涵蓋configured/preview、confirm/loading/error/retry/stale refresh；desktop/mobile browser與console驗收通過。
- [x] OpenAPI、ADR、data dictionary、security/design contract、tests、lint、typecheck、build、architecture、migration replay、browser/live smoke與worklog完成。

## Non-goals

- 付款、定金、退款、invoice、chargeback或payment provider。
- LINE/OA notification dispatch、reminder scheduling或delivery tracking（P3-006）。
- Merchant代consumer直接建立replacement hold、拖拉行事曆或跨服務／跨據點改期；店家目前可取消後請顧客重約。
- CRM自由文字備註、顧客標籤、no-show封鎖規則或自動停權。
- 媒合費ledger、settlement、退款後佣金調整或營收報表。

## External activation gates（不阻擋repository completion）

- [ ] Owner確認預設24小時cancel/reschedule self-service window及最大30天設定範圍。
- [ ] Staging以真實LINE/Firebase consumer驗證deadline前取消、改期及foreign ID 404。
- [ ] 真實OWNER、VIEWER與綁定STAFF account在staging驗證操作矩陣與手機工作流。
- [ ] P3-006上線前驗證reschedule/cancel outbox能取消舊提醒且不發送過期訊息。
- [ ] Production依序完成expand、v2 writer exclusive、啟用policy v2 writes、v1 ACTIVE hold drain與lifecycle activation；mixed-version insert、v1/v2 fixed hash vectors及lead值變更會改v2 hash都有自動化證據。
