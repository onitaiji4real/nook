# LINE通知與webhook security contract

## Trust boundaries

- Appointment outbox、Cloud Task body與browser input都不是recipient／time／status真實來源。Projector與delivery必須以tenant-scoped database aggregate重讀current truth。
- LINE Login subject只在Login與Messaging channels同provider時可共用；production未證明前`NOTIFICATION_MODE`保持disabled。
- Browser永不傳、讀或保存Messaging API recipient ID。Local link只能來自已驗證LINE identity的exact provider subject。

## Webhook authenticity and idempotency

- API保留request raw bytes，上限256KiB；以channel secret計算HMAC-SHA256 base64並constant-time比較`x-line-signature`，成功後才JSON parse或write。Edge/application另對webhook做bounded rate limit，單一verified envelope最多100 events。
- 缺／錯signature回401；malformed valid-signature JSON回400。兩者皆不寫webhook event，不回顯secret、signature、body或parser detail。
- `webhookEventId` unique。整個envelope先驗證shape後才逐event transaction處理；provider timestamp必須是非負、safe integer且可轉成有效UTC `Date`，不能讓極端數值延後到database adapter才失敗。只有one-to-one user `follow`／`unfollow`可更新recipient。Monotonic CAS先比provider timestamp，同timestamp時BLOCKED/unfollow永遠優先、同type才以event ID lexical tie-break，阻止舊follow覆蓋新unfollow；group/room與其他event一律IGNORED。
- Raw event可能含訊息內容，限營運角色與retention job存取，30天後hard delete；不得寫application log、audit或error stack。

## Dispatch and delivery authorization

- Scheduler與Cloud Tasks只可透過private Cloud Run ingress及既有automation invoker OIDC。`x-cloudscheduler`／`x-cloudtasks-*` exact header是defense in depth，不是IAM替代品。
- Worker只有在LINE notifications啟用時取得dedicated notification queue的`roles/cloudtasks.enqueuer`與automation invoker的`iam.serviceAccounts.actAs`；API只可在media pipeline啟用時enqueue另一條media queue。不得把兩個runtime授予project-wide enqueuer，也不得在feature disabled時保留actAs。
- Dispatcher endpoint body必須empty；delivery body exact `{jobId: UUID}`，拒絕額外欄位。Task不能指定tenant、recipient、template或dueAt。
- Delivery依job → appointment UUID ASC → consumer User → LINE UserIdentity → recipient → budget固定lock order，重驗terminal status、lease、template-specific leaf/current status、tenant/consumer關係、recipient FOLLOWING、ACTIVE local identity及max age，並先完成template validation。Valid才reserve budget、建立STARTED attempt。此transaction commit是delivery authorization linearization point；先完成的lifecycle/unfollow/suspension一定阻止送出，之後才發生的變更無法撤回已在flight的request。
- 任何blocked、unknown、mismatch、inactive、cancelled或stale truth都轉safe `SKIPPED`／`CANCELLED`，回task 2xx且不呼叫provider。

## Secrets and outbound request

- `LINE_MESSAGING_CHANNEL_SECRET`只注入API；`LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`只注入worker。兩者由Secret Manager runtime reference提供，不進env example值、tfvars、state output、log或worklog。Secret containers可先建立，但`enable_line_notifications=false`時不得建立兩個LINE secretAccessor IAM bindings；activation後API只取得channel secret、worker只取得access token。
- `NOTIFICATION_WORKER_URL`同時形成Cloud Task target與OIDC audience，必須是exact origin。Staging/production只接受HTTPS且不得含credential、path、query、fragment或trailing slash；development/test只額外接受localhost/127.0.0.1 HTTP。Runtime config本身必須執行此驗證，不能只依賴Terraform input validation。
- Access token只送LINE Messaging API HTTPS approved origin；禁止redirect，設定bounded connect/response timeout，response body不保存。
- 第一次及retry固定`X-Line-Retry-Key`。Exact 200/409只記ACCEPTED/REPLAYED；不能向UI宣稱delivered或read。Active lease禁止同job concurrent external call；crash/timeout後可以使用同key再次呼叫。
- Provider token、signature、subject、message body、template params、raw webhook、customer name/notes/address/phone/price不得出現在structured logs。

## Abuse and cost controls

- 只允許compile-time交易型template；沒有自由文字、broadcast、narrowcast、promotion或tenant-owned OA token。
- Reminder count由generic entitlement 0..2；平台monthly cap在external call前以database lock原子保留。Retry同job不重複計數，ambiguous timeout不釋放。
- Notification使用獨立queue，invocation `maxAttempts=100`、retry duration 24h；Cloud Tasks要兩個停止條件都成立才刪task。Job max age可更短，dispatcher另做bounded expiry sweep，但不得碰unexpired DELIVERING。Expired in-flight STARTED轉AMBIGUOUS/DEAD_LETTER；#10 expired STARTED直接terminal且不得建立#11。Provider outbound由database最多10個STARTED attempts控制，不受active-lease 503消耗。Exact 200 accepted、same-key 409 replay accepted；408/425/429、5xx、timeout/network retryable；其他4xx、3xx及非200的2xx terminal。禁止redirect。
- Signature failures、webhook rate limit、queue delay、dead-letter與budget utilization需監控，但metrics label不得包含user/recipient/template parameters。
- Dispatcher operational snapshot只可輸出平台級aggregate：兩個age seconds、dead-letter總數、24小時retryable/accepted attempt數、當月reserved count、approved cap與basis-points utilization。不得加入tenant/job/appointment/user/recipient/template/provider request ID或message欄位；private endpoint response也遵守同一schema。

## Privacy-safe template

Template只可含店家名稱、服務snapshot、location name、正確timezone時間及authenticated appointment deep link。禁止完整地址、電話、customer name、價格、政策、notes或LINE subject，降低lock-screen與轉寄洩漏。
