# Notification與LINE webhook data dictionary

P3-006以PostgreSQL保存可取消的通知工作與provider acceptance證據。所有timestamp存UTC；月度budget bucket使用Asia/Taipei換算後的calendar month。名稱為logical contract，實際migration必須以checks、foreign keys與indexes落實。

## `notification_jobs`

- `id`：UUID primary key，也是Cloud Task body唯一欄位。
- `tenant_id`、`consumer_user_id`、`appointment_id`：以composite foreign keys綁定同一tenant／consumer aggregate；所有query要求tenant truth。
- `source_outbox_event_id`：第一次建立此job的versioned event；同一event replay不得重建工作，後續exact dedupe collision不改寫此欄。
- `channel`：P3-006只建立`LINE_PUSH`；`LINE_SERVICE_MESSAGE`保留enum但runtime拒絕。
- `template_key`：`appointment.confirmed.v1`、`appointment.cancelled.v1`、`appointment.rescheduled.v1`、`appointment.reminder.24h.v1`、`appointment.reminder.2h.v1`。
- `due_at`：result固定使用source outbox `created_at`，確保積壓/replay不延後max age；reminder為appointment start減24h／2h。
- `status`：`PENDING | DISPATCHING | ENQUEUED | DELIVERING | ACCEPTED | CANCELLED | SKIPPED | DEAD_LETTER`。後四者為terminal；`ACCEPTED`不表示device delivered。
- `dedupe_key`：unique `notification:<template-key>:<appointment-id>`，template key本身已含`.v1`；collision exact shape固定比對tenant、consumer、appointment、channel、template及dueAt，不比source event/retry UUID。
- `provider_retry_key`：UUID unique，第一次external attempt前已固定，所有retry沿用。
- `dispatch_attempt_count`、`delivery_attempt_count`：non-negative integer；不以counter代替provider delivery ledger。
- `dispatch_lease_until`、`delivery_lease_until`：nullable UTC timestamp；expired active lease可由bounded worker reclaim。
- `enqueued_at`、`accepted_at`：nullable；只在對應CAS成功時寫入。
- `terminal_code`：nullable safe allowlist code，不保存provider response body或自由文字錯誤。
- `budget_month`：nullable `YYYY-MM`；同job最多原子保留一次。
- `created_at`、`updated_at`。

Result max age由`due_at + 24 hours`推導；兩種reminder由`due_at + 60 minutes`推導，不另存可漂移設定。Boundary為`database now >= expiry`即SKIPPED。

主要index：unique dedupe/retry keys、`status + due_at + id` dispatch、`status + lease` recovery、`tenant_id + appointment_id + status` cancellation、`source_outbox_event_id` projection trace。

## `notification_deliveries`

- `id`、`notification_job_id`。
- `attempt_number`：per-job positive integer；unique job + attempt。由delivery claim transaction分配，代表已授權的outbound attempt。
- `outcome`：`STARTED | ACCEPTED | REPLAYED | RETRYABLE | TERMINAL | AMBIGUOUS`。STARTED在external call前建立；provider結果只可完成一次，expired lease reclaim先把遺留STARTED改AMBIGUOUS。
- `provider_http_status`：nullable integer；network ambiguity可為null。
- `provider_request_id`：nullable safe provider correlation ID，僅接受ASCII `[A-Za-z0-9._:-]{1,128}`；不得保存recipient或response body，不作metric label。
- `code`：safe internal allowlist，例如`line_accepted`、`line_rate_limited`、`line_auth_rejected`、`network_timeout`。
- `started_at`、`finished_at`；STARTED的finishedAt為null，其餘必填。

Delivery attempt identity、job、attempt number與startedAt不可變；outcome只允許STARTED一次完成為其餘狀態。它不等同實際裝置收訊或已讀。Template invalid在budget/STARTED前SKIPPED。Active DELIVERING invocation不建立attempt；valid claim即保守消耗一次attempt，即使process在network前crash。Retryable完成後把job退回ENQUEUED／清lease；#10正常accepted可成功，#10 retryable/terminal或#10 STARTED lease expiry則DEAD_LETTER，永不建立#11。

## `line_messaging_recipients`

- `provider_subject`：`U[0-9a-f]{32}` primary key；敏感識別碼，不可log／audit／回傳browser。
- `user_id`：nullable unique local link；只可由exact verified LINE identity連結。
- `status`：`FOLLOWING | BLOCKED`。
- `observed_at`：最後一個被採用的已驗簽follow/unfollow provider event timestamp。
- `observed_webhook_event_id`：同timestamp、同event type的deterministic lexical tie-breaker。同timestamp一律BLOCKED/unfollow優先於FOLLOWING/follow；只有same type才比較event ID。
- `created_at`、`updated_at`。

Webhook可能先於登入，因此`user_id`可null。Delivery同時要求recipient FOLLOWING及ACTIVE `UserIdentity(provider=LINE)` exact subject match。

## `line_webhook_events`

- `id`：UUID primary key，供bounded cleanup穩定排序。
- `webhook_event_id`：LINE event ID unique idempotency key。
- `event_type`、`source_type`：bounded strings，用於routing；不保存message text的衍生欄位。
- `payload_json`：驗簽後的單一event JSON（不是envelope），可能含PII，30天retention。
- `status`：`RECEIVED | PROCESSED | IGNORED | FAILED`。
- `received_at`、`processed_at`。

Invalid signature、超過256KiB、超過100 events或任一invalid event shape不建立row。Redelivery只讀既有terminal result，不重複更新recipient。`received_at + id`有cleanup index；dispatcher每次hard delete最多1000筆`received_at < database now - 30 days`的rows。

## `notification_provider_monthly_usage`

- `provider` + `usage_month`：composite primary key；P3-006 provider為`LINE_MESSAGING`，month是Asia/Taipei `YYYY-MM`。
- `reserved_count`：non-negative integer。
- `updated_at`。

Budget reservation必須鎖定month row，檢查`reserved_count < LINE_MESSAGING_MONTHLY_CAP`後加1，並在同transaction把job `budget_month`設為相同month。Retry看到已保留不得再加；timeout後不退款。

同一transaction依job、appointment、consumer User、LINE UserIdentity、LINE recipient、budget的固定順序鎖row，完成current-truth validation、budget reservation及job DELIVERING/STARTED linearization。Lifecycle、unfollow或suspension若先commit，delivery必須skip；delivery若先linearize，後續變更不能撤回已開始的external operation。

## `entitlements`

- 新增`APPOINTMENT_REMINDER_COUNT`，`value_type=INTEGER`，P3-006有效值0..2。
- 0不建reminder；1建24h；2建24h與2h。Result notification不由此 entitlement 計數。
- Effective plan resolution沿用既有tenant subscription/default plan規則；缺值、錯型或超界fail closed，不依plan code/name分支。
