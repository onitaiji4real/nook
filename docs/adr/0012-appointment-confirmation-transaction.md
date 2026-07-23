# ADR 0012：Appointment confirmation transaction與可信歸因

狀態：Accepted
日期：2026-07-22

## Context

Booking hold只暫時保留時段，不是可營運、可通知或可計入方案用量的預約。Confirmation若分開寫appointment、history、occupancy與outbox，任何中途失敗都可能造成重複預約、無法通知、名額誤計或地址揭露錯誤。若browser可自行宣告MARKETPLACE來源或價格，也會讓未來8%首次媒合費失去可信依據。

既有`booking_occupancies`已是跨hold／appointment唯一防撞ledger。P3-003還必須兼容滾動部署：舊API只理解hold-owned occupancy，不能在舊revision仍接availability流量時開始建立appointment-owned rows。

## Decision

- 免定金confirmation使用單一Serializable PostgreSQL transaction，建立appointment、單一item、initial status history、safe audit、idempotency mapping與outbox，再以同一row原子轉移occupancy owner並consume hold。
- 所有writer固定先lock hold、再lock occupancy；serialization failure與deadlock有限重試。Expired cleanup回傳maintenance outcome，先commit hold/occupancy EXPIRED再由application回409，不以throw後期待資料留下。
- Idempotency同時使用consumer-scoped key mapping與unique hold appointment。相同key重送及同hold新key都回同一resource；composite consumer/tenant foreign keys防止replay把完整地址回給其他identity。
- Hold建立時由server保存catalog、政策、地址、location timezone及source snapshots。顧客只echo policy version；browser不能送政策內容、地址、price、source或payment state。
- Current direct merchant flow固定`MERCHANT_LINK`。MARKETPLACE只能由未來server-verified attribution token在hold階段設定；本transaction不建立媒合費，完成服務後才可依可信來源計算。
- `MAX_MONTHLY_BOOKINGS`依generic entitlement與tenant usage timezone／usage month仲裁，不依plan name。Appointment成立後即占用該月usage，後續取消不退回。
- Outbox row只表示domain event與預約同transaction持久化，不代表LINE或任何provider已送達。
- Rollout採expand-and-contract：migration與dual-owner-compatible readers先部署，confirmation feature flag保持關閉；舊revision drain且舊hold expiry後才啟用。

## Consequences

- Confirmation成功可作為唯一「預約成立」商業事件；hold不會被計入月額度或收入。
- FROM／RANGE／QUOTE可成立預約但不能偽造exact total；後續店家報價或付款contract需另行expand。
- Policy與完整地址成為敏感appointment snapshots，只能回owner／authorized tenant actor，不得進log、audit JSON或outbox payload。
- P3-002 availability、release與expiry必須支援nullable hold owner及appointment-owned occupancy；部署程序多一個drain/enable gate，但避免舊binary漏算已確認預約。
- P3-004／P3-005／P3-006可分別在既有appointment、state history與outbox之上建立列表、transition及notification delivery，不需重寫成立transaction。

## Rejected alternatives

- Release hold occupancy後另insert appointment occupancy：存在可被其他request搶位的空窗。
- 只靠unique appointment hold ID：無法防hold與其他appointment的staff/time重疊。
- Browser傳source／price／政策文字：可被竄改並破壞媒合費、價格與條款證據。
- Confirmation同步呼叫LINE：provider timeout會把DB成立與message結果綁成不可靠的distributed transaction。
- 依FREE／PRO名稱判斷用量：方案更名或新增時會讓商業規則散落程式碼。
