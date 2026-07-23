# ADR 0014：Database-backed通知工作與LINE provider邊界

狀態：Accepted
日期：2026-07-23

## Context

Appointment confirmation與lifecycle transaction已把versioned、ID-only domain event寫入outbox，但outbox不等於通知工作，也不能證明LINE訊息已送達。若confirmation同步呼叫provider，timeout會造成「預約已成立但request失敗」的distributed transaction；若數月後的提醒一次全部放進Cloud Tasks，改期、取消、成本控制與長期排程都難以正確處理。

LINE Login subject只有在LINE Login與Messaging API channel位於同一LINE provider時才能作為相同user ID使用。LINE Push HTTP 200也只代表request accepted；被封鎖或刪除的recipient可能沒有實際收到訊息。因此通知資格、成本與呈現語意都必須fail closed。

## Decision

- PostgreSQL `notification_jobs`是提醒system of record。Worker先把支援的appointment outbox event以tenant-scoped current truth投影成jobs，再把已到期jobs派入Cloud Tasks；不直接把長期排程全部放入queue。
- Projector只claim`aggregate_type=appointment`，每個transaction用`SKIP LOCKED LIMIT 1`完整處理一筆，request最多100筆；不會消費其他aggregate。Job以含version的template key + appointment形成dedupe identity，保留固定provider retry UUID、lease與attempt counter；不保存rendered message、recipient subject、token或敏感template parameters。
- Cloud Task只傳`jobId`，使用dedicated notification queue、deterministic task name與既有private worker OIDC。Queue設100 attempts／24h；依Cloud Tasks兩停止條件皆達成才刪task的contract，非provider 503不會在24h前提早耗盡。Database仍把provider outbound硬限制10次，dispatcher sweep超齡active job。Dispatch crash由lease reclaim，AlreadyExists視為已enqueue；delivery仍需重讀job與aggregate，不信任task payload。
- Enqueue IAM固定queue scope：media啟用時只有API可enqueue media queue，LINE notifications啟用時只有worker可enqueue dedicated notification queue。兩個producer只在對應feature啟用時取得automation invoker的`iam.serviceAccounts.actAs`；不授與project-wide Cloud Tasks enqueuer。
- 第一個provider adapter是平台OA的`LINE_PUSH`。只有verified webhook已標記FOLLOWING，且與ACTIVE local LINE identity exact match的recipient才可送；LINE Login與Messaging channels同provider是production activation gate。
- Provider 200與same-key 409一律記`ACCEPTED`，不記`DELIVERED`或`READ`。Template validation在budget/attempt前完成；每次valid outbound authorization建立STARTED evidence，crash後轉AMBIGUOUS。Retryable再把job退回ENQUEUED/清lease；active lease禁止concurrent provider call。#10正常accepted仍成功，retryable/terminal/expired則dead letter且不得建立#11。所有attempt固定使用第一次就建立的`X-Line-Retry-Key`。
- `APPOINTMENT_REMINDER_COUNT`是generic integer entitlement，P3-006只支援0..2；平台OA成本另由Asia/Taipei月份的global hard cap原子保留。Retry不重複保留，ambiguous timeout不釋放。
- Webhook endpoint以256KiB/100 events bound取得raw bytes，先驗HMAC-SHA256 signature才parse。Valid event以provider event ID去重，follow/unfollow另以timestamp、同timestamp unfollow優先及same-type event ID monotonic CAS防亂序；其他event保存後標IGNORED。Raw單一event payload由dispatcher每分鐘bounded cleanup，保留30天且不得進log/audit。
- MINI App service message只保留adapter邊界，不在本slice啟用。啟用前另需verified MINI App、核准template、notification token加密保管／rotation與獨立ADR。
- 新增`@google-cloud/tasks`至worker作為既有GCP Cloud Tasks的官方client。這是本ADR核准的新增runtime dependency；不得引入其他provider SDK，LINE HTTP adapter使用平台`fetch`。

## Consequences

- 改期／取消可先取消database job；即使舊task已enqueue，delivery current-truth guard仍不呼叫provider。
- 系統能對outbox projection、queue dispatch、provider acceptance與terminal failure分開觀測和重播，不把外部狀態混入appointment transaction。
- 資料表、lease recovery、budget ledger、webhook retention與dead-letter維運增加複雜度，但提供併發、成本與隱私的明確邊界。
- 原商業技術計畫10.1所稱「delivered」在LINE Push實作中收斂為`ACCEPTED`；若未來provider提供可信delivery/read receipt，需另立event與狀態，不能重解釋歷史資料。
- Scheduler與provider mode保持預設關閉；repository/local完成不表示真實LINE已啟用。

## Rejected alternatives

- Confirmation／lifecycle request同步送LINE：provider timeout會破壞核心transaction真實性。
- 只用Cloud Tasks保存數月後提醒：缺乏可查詢、可取消與可重建的長期system of record。
- 相信browser提供LINE user ID：可跨帳號冒用recipient。
- 只依LINE Login成功就推播：未證明同provider或OA follow狀態。
- 每次retry產生新retry key：會失去provider端dedupe並增加重複訊息與費用風險。
- 把平台月費解讀為無限訊息：無法控制LINE OA變動成本，也違反既有商業模型。
