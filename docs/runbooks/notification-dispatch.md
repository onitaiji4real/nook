# Notification dispatch與LINE activation runbook

## Safe defaults

- `NOTIFICATION_MODE=disabled`及Terraform `enable_notification_dispatcher=false`是預設。
- Disabled mode可跑migration、projector與fake adapter test，但不得enqueue或呼叫LINE；projected jobs保持PENDING，由固定max-age避免之後late blast。
- Secret Manager只建立containers；repository/Terraform不得建立secret versions或輸出值。
- line_push API只掛channel secret；worker只掛access token、queue/runtime設定、public Web base URL與monthly cap。兩個service不得互拿對方secret。

## Local verification

啟動PostgreSQL、API與worker後，先以disabled/fake provider完成：逐筆transaction outbox projection、due dispatch、same job replay、cancel-after-enqueue、active delivery concurrency、retryable回ENQUEUED、cap exhausted、invalid webhook signature no-write、亂序follow/unfollow及30天bounded retention。Local header只驗證application defense，不能證明Cloud Run IAM。

```bash
curl -i -X POST \
  -H 'x-cloudscheduler: true' \
  -H 'x-request-id: local-notification-dispatch' \
  http://localhost:8081/internal/notifications/dispatch
```

Delivery smoke只可使用fixture job與fake adapter。真實access token不得放`.env.example`、shell history、command output或worklog。

## Staging activation order

1. 套用expand migration並確認fresh replay；部署API/worker compatible revision，mode仍disabled。
2. 在LINE Developers確認平台OA Messaging channel與Login/MINI App channel屬同一provider；完成provider page、隱私與跨channel說明。
3. 由核准secret workflow寫入channel secret與access token；確認API只掛secret、worker只掛token。
4. 設定LINE webhook URL，實測valid/invalid signature、follow、unfollow、redelivery與blocked user；確認raw payload無log且retention可執行。
5. 設`LINE_MESSAGING_MONTHLY_CAP` approved positive value，啟用staging `line_push`但Scheduler仍off；以單一fixture task驗exact 200 accepted、same-key 409 replay、408/425/429/5xx/timeout retry，以及其他4xx、3xx、非200 2xx terminal。
6. 驗證dedicated notification queue `maxAttempts=100`／24h retry duration（兩停止條件皆達成才刪task）、deterministic task name、automation invoker OIDC、queue exact header、private ingress、10次database outbound cap、unexpired DELIVERING不被sweep、#10 STARTED crash終止及cancel-after-enqueue。IAM plan必須顯示worker只對notification queue有enqueuer及activation-scoped actAs；API不能enqueue該queue。
7. Owner核准後才設`enable_notification_dispatcher=true`；觀察至少一個完整24h／2h時窗，再考慮production。

## Monitoring and triage

- Alert：oldest PENDING outbox age、oldest due job delay >10分鐘、dead-letter新增、retryable spike、budget utilization與webhook signature failure異常。
- Private dispatcher response/log的`operationalSnapshot`是安全平台aggregate：`oldestPendingOutboxAgeSeconds`、`oldestDueJobDelaySeconds`、`deadLetterJobCount`、24小時retry/accepted、當月reserved/cap與basis points utilization。任何新增欄位若含tenant、job、appointment、user、recipient、template或provider request ID都必須拒絕。
- Queue delay增加：先查Scheduler、OIDC audience、Cloud Run ingress、queue throttling與database lease；不得把worker改public或移除auth header。
- Webhook rows超過30天：查dispatcher cleanup count/index與database failure；一次仍只刪1000筆，以每分鐘bounded catch-up，不另開未授權public endpoint。
- `401/403` provider failure：視為token/channel configuration incident，關閉line_push或Scheduler，rotation後用新fixture驗證；不得無限retry。
- `429`：保持bounded retry，檢查LINE quota及platform monthly cap；不可提高cap繞過owner核准。
- Accepted ratio下降：只代表provider request acceptance，不能解讀為device delivery rate；檢查recipient FOLLOWING資料與同provider設定。

## Rollback and recovery

1. 先關`enable_notification_dispatcher`或把runtime mode設disabled，停止新external calls。
2. 不刪outbox、jobs、delivery attempts、budget ledger或webhook evidence；修正後由lease/dedupe恢復。
3. 若template或truth guard有privacy風險，保持所有jobs停用並取消受影響nonterminal jobs；不要直接重送。
4. Token疑似洩漏時立即在LINE撤銷/rotation，再更新Secret Manager；repository history不能用刪檔當作撤銷。
5. Recovery先在staging以固定retry key與fake/fixture完成，再逐步恢復Scheduler。Ambiguous timeout的budget reservation不退款。

## Production external gates

- 真實follow/unfollow、blocked recipient、same-key retry、quota 429與consumer device收訊均已有staging證據。
- Default/paid reminder entitlement與platform monthly cap數值已有owner書面核准。
- Required alerts、30天webhook retention與dead-letter查詢已部署。
- MINI App service message不得隨LINE Push一起開啟；它有獨立template/token custody驗收。
