# P3-006：Reminder jobs與LINE通知邊界

狀態：`in_progress`

## Outcome

把P3-003/P3-005已與appointment transaction一起持久化的versioned outbox event，可靠投影成可取消、可重試、可追蹤的通知工作。第一版只處理平台LINE OA的交易型push與預約提醒；disabled mode保留PENDING等待安全啟用，真正delivery時若顧客未加入OA、預約已改期／取消或成本上限到達則必須truthful skip，不能假裝送達。

本slice不做行銷群發、回訪campaign、店家自有OA、Email fallback、MINI App service message token保管、自由文字模板或店家可編輯通知。這些能力會改變同意、費用歸屬與資料處理者責任，需另立task／ADR。

## Product and commercial decisions

- 平台月費不包含無限LINE訊息。`APPOINTMENT_REMINDER_COUNT`是integer entitlement，P3-006只接受0..2：0不建reminder、1建24小時提醒、2建24小時＋2小時提醒。不得以plan name分支；未來custom rules另立結構化設定與成本方案。
- Confirmation、consumer/merchant cancellation與reschedule result屬交易結果，不計入reminder entitlement，但仍消耗平台OA message budget。Check-in、complete、no-show在本slice只取消不再適用的future reminders，不主動通知顧客。
- `LINE_MESSAGING_MONTHLY_CAP`是平台級hard allocation cap，不是方案權益；LINE push mode必須為positive integer。每個job在外部呼叫前以Asia/Taipei月份原子保留一次budget，ambiguous timeout也不釋放，寧可保守少送，不能併發超額或因retry重複計費。
- LINE API HTTP 200只代表provider accepted，不保證裝置顯示；資料庫、UI與log一律使用`ACCEPTED`，不得稱`DELIVERED`。Blocked／deleted／未加OA的user可能得到200但實際收不到，因此只有已驗簽follow webhook標記為FOLLOWING的recipient可建立delivery claim。
- LINE Login與Messaging API channel必須位於同一LINE provider，且provider page／跨channel資料使用說明符合LINE政策。不同provider的subject不能推測、轉換或cross-link；外部設定未證明前provider保持disabled。
- LINE push是計費訊息。第一版模板只含店家名稱、服務snapshot、依`locationTimezoneSnapshot`顯示的時間、據點名稱與authenticated appointment deep link；不含完整地址、電話、customer name、政策全文、價格、notes或LINE subject，降低lock-screen洩漏。
- MINI App service message保留channel adapter enum但不在本slice啟用。它要求verified MINI App、核准template及每次user action的service notification token；token會更新且最多5次，未完成加密保管與rotation前不得存明文或假裝可用。

## Event projection

Dispatcher每分鐘由private worker endpoint啟動，依序投影outbox、派送due jobs及清理expired webhook rows。Database是system of record，不能把數月後提醒直接全部排進Cloud Tasks。

支援event與效果：

| Event | Projection |
| --- | --- |
| `appointment.confirmed.v1` | 建`appointment.confirmed`立即job；依effective entitlement建future `appointment.reminder.24h`／`appointment.reminder.2h` |
| `appointment.cancelled.v1` | 取消該appointment所有nonterminal jobs；建`appointment.cancelled`立即job |
| `appointment.rescheduled.v1` | 取消source所有nonterminal jobs；對replacement建`appointment.rescheduled`立即job與全新future reminders |
| `appointment.checked_in.v1` | 取消該appointmentfuture reminders，不建message |
| `appointment.completed.v1` | 取消該appointment所有nonterminal reminders，不建message |
| `appointment.no_show.v1` | 取消該appointment所有nonterminal reminders，不建message |

- Projector每次開一個transaction，以`FOR UPDATE SKIP LOCKED LIMIT 1`依`availableAt,id`鎖一筆`aggregate_type=appointment`、`status=PENDING`且`availableAt <= dbNow`的event；candidate必須不存在同aggregate更早的due PENDING event，讓不同appointment可平行、同appointment event依序投影。在同一transaction內重新讀tenant-scoped aggregate、執行upsert/cancel並把event標PUBLISHED；一次request最多重複100次。其他aggregate不被選取。Unsupported appointment event、payload/aggregate ID不一致、missing/cross-tenant aggregate或dedupe shape mismatch是terminal corruption：`attemptCount + 1`後標FAILED。Database/transient failure整筆rollback、event保持PENDING且endpoint回503，不用FAILED吞掉可恢復錯誤。
- Dedupe key exact為`notification:<templateKey>:<appointmentId>`，其中template key已含`.v1`。Collision只比較tenant、consumer、appointment、channel、template與dueAt；source event與既有retry UUID不重寫也不參與shape。任一欄不同視為corruption。Concurrent projector在pre-read後若`createMany(skipDuplicates)`輸掉unique race，必須重新讀winner並執行同一個exact shape check，不能只因count=0就把event標PUBLISHED。
- Outbox payload只作ID allowlist parsing，不信任tenant、status、time、recipient或message content；所有truth由tenant-scoped appointment／chain／entitlement重新讀取。
- Result job `dueAt`固定使用source outbox `createdAt`，不得使用projection time；Reminder `dueAt`精確為appointment `startAt - 24h`及`startAt - 2h`。若projection database clock已達或超過reminder dueAt，該reminder不建立，不把錯過的提醒立即補送。積壓result event仍依原outbox time套24h max age，不重新變年輕。
- Reschedule只依event指定replacement並驗證direct predecessor、root／consumer／tenant一致及replacement目前為CONFIRMED。任何chain不一致fail closed；source queued task即使已進Cloud Tasks，delivery前仍會因job CANCELLED或appointment不再eligible而skip。
- Cancellation projection取消nonterminal jobs時必須排除本event的`appointment.cancelled.v1` dedupe key，再exact upsert該result job；duplicate event/replay不能把自己的result job轉CANCELLED。其他lifecycle cancel同樣只作用明列的template範圍，terminal job永不復活。
- Reminder entitlement只在job projection時依當時effective plan讀取並形成0..2 jobs，之後不在delivery重新解讀。方案變更影響之後投影的新預約／改期，不增刪已建立jobs；避免沒有domain event時出現不對稱的隱性mutation。Result jobs不讀reminder entitlement。

## Notification jobs and dispatch

- Job exact identity由unique `dedupeKey`固定：`notification:<templateKey>:<appointmentId>`。同一appointment/template只一筆；reschedule replacement使用replacement ID，自然得到新identity。
- Job不保存rendered body、地址、customer、LINE subject或provider token。保存tenant、consumer、appointment、source outbox event、channel、template、due time、status、fixed LINE retry UUID、dispatch/delivery lease、attempt counts與safe terminal code。
- Status：`PENDING -> DISPATCHING -> ENQUEUED -> DELIVERING -> ACCEPTED`；任一步可依current truth轉`CANCELLED | SKIPPED | DEAD_LETTER`。Terminal不得回到active。Expired lease可由dispatcher／delivery reclaim；所有CAS帶expected status/lease。
- Dispatcher claim先把due PENDING或expired DISPATCHING job設兩分鐘lease，再於transaction外用deterministic Cloud Task name `notification-<job UUID>`enqueue。AlreadyExists視為成功；成功後CAS為ENQUEUED。Crash before enqueue由lease重取，crash after enqueue靠deterministic name去重。
- Cloud Task body exact `{ jobId }`；不含tenant、consumer、appointment、recipient或message。Notification使用獨立Cloud Tasks queue、private worker、automation invoker OIDC與exact queue header；header只是defense in depth，不能取代Cloud Run IAM。Worker只有在LINE notification啟用時取得該queue的enqueuer與automation invoker actAs；API不得enqueue此queue，也不授project-wide enqueuer。Queue `maxAttempts=100`、`maxRetryDuration=86400s`；Cloud Tasks只有attempt count與duration兩條件都達成才停止，因此active lease／process crash等非provider invocation不會在24h前提早刪task。Provider outbound仍由database counter硬限制10次。
- Dispatcher每次另做bounded max-age sweep：PENDING、ENQUEUED及lease已過期的DISPATCHING可標SKIPPED；有未過期lease的DISPATCHING/DELIVERING絕不碰。Expired DELIVERING若有STARTED，先完成為AMBIGUOUS再把job標DEAD_LETTER `delivery_outcome_ambiguous`，不得宣稱SKIPPED；若無STARTED視為corruption DEAD_LETTER。Provider result與sweep都以job + attempt expected-state CAS，同一row lock下先完成者勝；late result不能覆寫terminal outcome。Task window結束後每分鐘sweep確保job terminal。
- Delivery endpoint以CAS把ENQUEUED或expired DELIVERING claim成DELIVERING並設兩分鐘lease。Active DELIVERING的concurrent invocation回503且不呼叫provider；terminal回200。Claim先依同一locked truth snapshot完成template render validation；invalid直接SKIPPED，不reserve budget、不建立attempt。之後才reserve budget並建立STARTED。Expired claim把前一筆遺留STARTED標AMBIGUOUS；若它是attempt #10，job立即DEAD_LETTER `attempt_limit_ambiguous`並回200，不建立#11。否則分配下一個attempt number、把`deliveryAttemptCount + 1`並建立STARTED row；counter代表已授權的outbound attempt，process在真正network call前crash也保守消耗一次。最多10次，禁止同一job concurrent provider calls。
- Provider結果transaction把exact STARTED row完成為ACCEPTED/REPLAYED/RETRYABLE/TERMINAL。#1..#9 retryable把job由DELIVERING退回ENQUEUED並清lease，再回503；#10正常200/409仍可ACCEPTED，#10 retryable/terminal則DEAD_LETTER並回200。Process crash留下DELIVERING與STARTED，lease到期按上一條AMBIGUOUS規則處理；因外呼結果可能ambiguous，重試仍固定同一retry key。
- LINE push第一次及所有retry固定送同一`X-Line-Retry-Key`。Exact 200及same-key 409記ACCEPTED；408/425/429、5xx、timeout/network為retryable；其他4xx、3xx、非200的2xx為terminal protocol/config/request failure。禁止redirect。不能保存provider body，409只能按LINE retry-key replay contract分類。
- LINE retry key provider去重只有24小時，notification queue retry duration固定24小時且job-specific max age可更短；不得把delivery retry延長超過24小時。Provider response body、access token與recipient subject永不保存或記log。
- Result job max age為`dueAt + 24h`，24h/2h reminder max age皆為`dueAt + 60m`；`dbNow >= expiresAt`在provider call前標SKIPPED（不是DEAD_LETTER）。Retry exhaustion／terminal provider failure才是DEAD_LETTER。
- Current-truth eligibility固定如下：confirmation要求該appointment是current reschedule leaf且CONFIRMED；cancel result要求無successor且CANCELLED；reschedule result要求source RESCHEDULED、replacement是direct successor/current leaf且CONFIRMED；兩種reminder要求current leaf、CONFIRMED且`dbNow < startAt`。Checked-in/completed/no-show/cancelled/rescheduled、chain mismatch都不送。
- Delivery lock order固定job → appointment（及template需要的source/successor，UUID ASC）→ consumer User → LINE UserIdentity → LINE recipient → monthly budget。Transaction內完成current truth、ACTIVE user/exact identity/FOLLOWING recipient、budget與DELIVERING/STARTED linearization後commit。Lifecycle/unfollow/suspension若先取得對應lock並commit則必須skip；delivery若先linearize則外呼可能已在flight，不能宣稱可撤回。Identity link與webhook更新也遵守User/identity先於recipient的相容lock order。

## Canonical LINE text templates

Provider request固定為`{to, messages: [{type: "text", text}]}`，exact一則text message、UTF-8最多1000字元。Authoritative fields只有`Tenant.name`、`AppointmentItem.serviceNameSnapshot`、`Appointment.startAt`以`locationTimezoneSnapshot`格式化成`yyyy/MM/dd（週X）HH:mm`、`locationNameSnapshot`及`PUBLIC_WEB_BASE_URL + "/appointments"`。週X固定Sunday=`日`、Monday..Saturday=`一`..`六`。文字欄位使用trim後值，但若含C0/C1 control characters（包含CR/LF/TAB）即invalid；內部一般空白不collapse。Base URL在staging/production必須exact HTTPS origin、不得有path/query/fragment；development/test可用localhost HTTP。任何field缺失、trim後為空、timezone invalid或render超長均SKIPPED `template_data_invalid`，不fallback地址或live catalog。

Exact body：

```text
預約已成立
{tenantName}
服務：{serviceName}
時間：{localizedStartAt}
據點：{locationName}
查看預約：{appointmentUrl}
```

Cancellation只把第一行換成`預約已取消`；reschedule換成`預約已改期`並使用replacement snapshots；24h/2h reminder第一行分別為`預約提醒（24 小時前）`、`預約提醒（2 小時前）`，其餘五行exact相同。不得加入customer、staff、address、phone、price、policy、notes、recipient或payment claim。

## LINE recipient and webhook boundary

- Public `POST /v1/webhooks/line/messaging`必須取得raw bytes，先用channel secret驗`x-line-signature` HMAC-SHA256再JSON parse；缺／錯signature固定401，且不寫event、不回顯原因細節。
- Webhook raw body上限256KiB、單一envelope最多100 events；超限回413且不寫資料。驗簽後先完整驗證top-level及每個event的ID/type/source/timestamp shape，任一malformed回400且整個envelope不寫；之後每個event以獨立transaction處理，transient failure回503，已完成event靠idempotency安全重播。
- 每個LINE event以`webhookEventId`唯一存單一event JSON（不是整個envelope）、receivedAt、status與processedAt；redelivery不重複更新recipient。Raw event可能含user message，禁止log／audit，限營運存取。Dispatcher每次最後以`receivedAt < dbNow - 30 days`、`id`順序hard delete最多1000筆，並有cleanup index；清理失敗使request回503但不回滾已完成的獨立projection/delivery transactions。
- P3-006只處理one-to-one user source的`follow`與`unfollow`：follow upsert FOLLOWING，unfollow設BLOCKED。Recipient monotonic order固定比較`timestamp`，較新者勝；同timestamp時BLOCKED/unfollow永遠高於FOLLOWING/follow，只有同type才以event ID lexical較大者勝。舊亂序event記PROCESSED但不得翻轉recipient。其他valid event存raw後標IGNORED，不執行bot command、不回覆。
- Recipient以provider subject為唯一key並可nullable link local User。Webhook先於登入時保留subject；LINE login find/create後以exact subject連結。Subject必須符合`U[0-9a-f]{32}`，不接受browser提供recipient ID。
- Delivery必須同時證明`UserIdentity(provider=LINE, userId, providerSubject)`與recipient FOLLOWING exact match；unknown、mismatch、inactive user皆SKIPPED且不洩漏subject。

## Runtime modes and rollout

- `NOTIFICATION_MODE=disabled|line_push`。Development/test預設disabled但允許test injection fake adapters。Disabled projector仍建立PENDING jobs，但dispatcher不enqueue、不把它們永久SKIPPED；之後啟用時由max-age防止late blast。
- Per-service validation：line_push API只要求channel secret與256KiB raw-body boundary；worker只要求access token、project/region/queue、exact worker origin、task invoker、public Web base URL與positive monthly cap。Worker URL與public Web URL在staging/production皆須為exact HTTPS origin，不得含credential、path、query、fragment或trailing slash；development/test只額外允許localhost/127.0.0.1 HTTP。API不得取得access token，worker不得取得channel secret。Staging/production mode缺值或URL不安全時各自startup fail closed。
- Terraform只建立Secret Manager containers及條件式runtime references，不建立secret versions。`enable_notification_dispatcher=false`維持預設；開啟前必須先完成migration、部署endpoint、填入兩個LINE secret、同provider/OA follow、OIDC／queue integration及staging accepted/retry/cancel smoke。
- Scheduler只呼叫`/internal/notifications/dispatch`。Worker先project outbox再enqueue due jobs；單次bounded batch，不在一個request drain整張表。
- Deployment順序：expand migration → compatible API/worker（mode disabled）→ webhook secret與staging follow → worker fake/provider contract → LINE access token與monthly cap → staging dispatcher/task smoke → owner核准後啟用Scheduler。Rollback先關Scheduler／mode，不能刪jobs/outbox或清state。

## Observability and privacy

- Structured log exact allowlist：`requestId, operation, outcome, count, safe jobId/tenantId/appointmentId, httpStatus`。Controller只能使用request-context middleware驗證／產生的bounded requestId，不得重新讀取raw header。不得包含recipient/user ID、LINE subject、raw webhook、message body、template params、token、signature、provider response body或stack。
- Operations固定`notifications.project|notifications.dispatch|notifications.deliver|line.webhook.receive`；outcome固定`success|accepted|replayed|skipped|retryable|dead_letter|rejected|unavailable`。
- Metrics／alert：dispatcher以database clock回傳PII-free平台aggregate，包括oldest PENDING outbox age、oldest due job delay、retryable/dead-letter count、當月reserved/cap與basis-points budget utilization、accepted count；不得含tenant/job/appointment/user/recipient/template/provider request ID。Queue delay >10分鐘或dead-letter新增需告警；accepted ratio不是actual device delivery rate。

## Acceptance criteria

- [ ] 第19個expand migration、Prisma relations/checks/indexes、default reminder entitlement與fresh replay通過。
- [ ] Outbox projection對六種event、future availableAt、stable event-time dueAt、dedupe/cancellation replay、unknown/corrupt event、past reminder與reschedule cancellation有database integration evidence。
- [ ] Dispatcher SKIP LOCKED、lease reclaim、dedicated queue contract、deterministic task name、AlreadyExists、partial enqueue failure、max-age sweep與bounded batch有concurrency／unit evidence。
- [ ] Delivery current-truth/recipient lock matrix、fixed retry key、STARTED/AMBIGUOUS evidence、200/409 accepted、retry分類、10-outbound-attempt dead-letter、max-age及同job無concurrent provider call有evidence；crash/timeout可重做HTTP call，但logical job與budget reservation不得重複。
- [ ] Monthly budget reservation在併發下不超cap；retry不重複保留，cap exhausted truthful SKIPPED且不呼叫provider。
- [ ] LINE webhook raw signature-before-parse、event idempotency、follow/unfollow、same-timestamp unfollow wins、unknown event ignore、invalid signature no-write與30天retention有integration evidence。
- [ ] Recipient只由verified provider subject／webhook建立，cross-user/cross-provider/mismatch/inactive/blocked一律不送且不洩漏subject。
- [ ] 五個canonical template golden test驗證exact繁中內容、snapshot來源、timezone、固定deep link、1000字上限與invalid-data skip，且不含地址、電話、customer name、price、policy或notes。
- [ ] Worker route/header/body與Terraform IAM/static contract、scheduler/queue defense、disabled mode與per-service runtime validation完成；applied Cloud Run IAM只列external gate，Terraform activation仍預設off。
- [ ] ADR、data dictionary、security/design contract、OpenAPI internal contract、runbook、tests、lint/typecheck/build/architecture/migration replay/worklog完成。

## Current verification checkpoint（2026-07-23）

已完成但不等同本task驗收完成：

- 第19個expand migration、Prisma schema、projector、dispatcher、delivery、LINE webhook/provider/template、API/worker route、runtime config、OpenAPI、Terraform與操作/安全文件均已建立。
- Dependency-independent repository/CI/deployment/local-dev contracts 27/27、Terraform release contract 4/4、TypeScript parser 269 files/0 syntax errors、OpenAPI YAML parse、Terraform recursive fmt及`git diff --check`通過。
- Static/concurrency review已修正same-aggregate projection ordering、dedupe winner revalidation、invalid provider timestamp、middleware-owned request ID與notification-disabled LINE secret IAM。

仍缺的authoritative evidence：

- Root workspace的`node_modules/.bin/tsc`、`turbo`、`vitest`缺失，因此strict typecheck、Vitest unit、Prisma integration、完整build與architecture package checks尚未執行。
- Fresh database migration replay、第二次no-pending及notification concurrency integration尚未執行。
- Terraform mock-provider test在受限環境無法啟動既有Google provider process，0 tests executed；不得列為通過。
- LINE/GCP真實帳號、secret、Cloud Tasks與staging裝置驗收仍屬下方external activation gates。

恢復完整驗收的最短路徑：

```bash
pnpm install --frozen-lockfile
pnpm run doctor
```

只有doctor的workspace tools皆為PASS後，才執行完整lint/typecheck/unit/integration/build、migration replay與Terraform checks。P3-006在這些repository/local evidence通過前維持`in_progress`，P3-007維持`blocked`。

## External activation gates（不阻擋repository completion）

- [ ] Owner建立平台LINE OA與Messaging API channel，並確認與LINE Login／MINI App channel在同一provider。
- [ ] Owner發布provider page、隱私／跨channel資料使用說明及OA加好友文案。
- [ ] Secret workflow寫入Messaging channel secret與stateless／approved channel access token；repository、tfvars、state與worklog不得出現值。
- [ ] Staging真實follow/unfollow webhook、blocked user、same-key retry、quota 429及consumer device收訊驗證完成。
- [ ] Owner確認default plan一筆24h reminder、付費方案兩筆reminder與平台OA月度hard cap數字。
- [ ] Verified MINI App、service message templates與notification-token加密/rotation另行驗收後，才可啟用`LINE_SERVICE_MESSAGE`。

## Non-goals

- 行銷／優惠券／回訪群發、broadcast、narrowcast或CRM segmentation。
- 店家自有OA OAuth／token custody、費用轉嫁或店家可編輯模板。
- Email/SMS fallback、notification preference center或quiet hours。
- Provider宣稱的actual read/delivery receipt；LINE push只記accepted。
- 評論邀請、付款通知、媒合費、settlement或營收報表。
