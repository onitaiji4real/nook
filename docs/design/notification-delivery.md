# Transactional notification delivery design

## User-visible promise

P3-006只提供預約成立、取消、改期結果與24h／2h提醒。UI可顯示「LINE 已接受通知請求」或「通知未啟用／已略過」，不得顯示「已送達」或「已讀」。未加入平台OA、封鎖OA或外部設定未完成時，不妨礙預約本身成立／變更。

## Event-to-job flow

1. Appointment transaction與business write同時建立versioned、ID-only outbox event。
2. 每分鐘private dispatcher最多循環100次；每次以獨立transaction及`SKIP LOCKED LIMIT 1`投影一筆appointment PENDING event。Claim排除同aggregate仍有更早due PENDING event的candidate，因此跨appointment可平行、同appointment保持`availableAt,id`順序。Worker重讀appointment、chain及effective entitlement，upsert/cancel jobs，再將outbox標PUBLISHED。若concurrent insert輸掉dedupe unique race，loser須重讀winner並驗證exact shape；不一致時event標FAILED。其他aggregate完全不碰。
3. Result dueAt固定為outbox createdAt；Reminder只在`database now < dueAt`時建立，錯過的提醒不立即補發。
4. Dispatcher claim已到期job，transaction外enqueue dedicated notification queue的deterministic Cloud Task。Queue body只有jobId；另bounded sweep超齡active jobs。
5. Delivery worker依固定lock order鎖job、appointment、User、LINE identity、recipient及budget，重驗template-specific current truth並先render/validate安全模板；invalid直接SKIPPED。Valid才reserve budget、linearize DELIVERING/STARTED並呼叫provider adapter。
6. Provider 200/409標ACCEPTED；#1..#9 retryable attempt先完成STARTED evidence、退回ENQUEUED/清lease再回503；#10正常accepted仍可成功，retryable/terminal才DEAD_LETTER。Expired STARTED轉AMBIGUOUS；若已是#10或已超max-age則DEAD_LETTER，不再外呼。
7. Dispatcher最後hard delete最多1000筆超過30天的LINE webhook events；cleanup失敗回503供Scheduler重試。

Cloud Task target與OIDC audience共用runtime驗證後的exact worker origin，兩者不可由不同字串拼出；正式環境只接受HTTPS origin，不允許path/query/fragment或credential，避免task被導向非預期endpoint或因audience canonicalization差異持續401。

## Lifecycle behavior

| Appointment event | Result message          | Reminder effect                                     |
| ----------------- | ----------------------- | --------------------------------------------------- |
| Confirmed         | 建立確認通知            | 依0..2 entitlement建立24h／2h                       |
| Cancelled         | 建立取消結果            | 取消除本次取消result dedupe key外的nonterminal jobs |
| Rescheduled       | replacement建立改期結果 | 取消source；為replacement重建future reminders       |
| Checked in        | 無                      | 取消future reminders                                |
| Completed         | 無                      | 取消nonterminal reminders                           |
| No-show           | 無                      | 取消nonterminal reminders                           |

Reschedule current leaf與direct/root chain不一致時fail closed。已enqueue的source task之後執行也會因job／appointment current truth被skip。

## Template presentation

- 全部繁體中文；appointment時間以location timezone snapshot格式化，若資料不合法則不送。
- Exact template與source mapping以P3-006 task〈Canonical LINE text templates〉為唯一contract。Deep link固定為validated `PUBLIC_WEB_BASE_URL + /appointments`，不含appointment ID、bearer token、recipient subject或一次性secret。
- Confirmation不顯示已付款；未來payment provider未證明前保持「已確認・未付款／免定金」的既有truth。
- Provider unavailable、cap exhausted或recipient ineligible只影響通知；appointment API success不能被改寫為失敗。

## Operational states

- `PENDING`：等待due time。
- `DISPATCHING`：短lease中準備enqueue。
- `ENQUEUED`：Cloud Task已存在。
- `DELIVERING`：短lease中進行truth check/provider attempt。
- `ACCEPTED`：LINE接受200或retry-key replay 409，terminal但非delivery receipt。
- `CANCELLED`：business state已使工作失效。
- `SKIPPED`：recipient、cap、time或runtime條件不允許送。
- `DEAD_LETTER`：terminal provider/config failure或retry exhaustion，需要營運處理。

## Operational snapshot

每次dispatcher完成bounded work與webhook cleanup後，以單一database clock讀取平台級快照：最舊due appointment outbox age、最舊active due job delay、dead-letter job總數、最近24小時retryable/accepted attempt數，以及Asia/Taipei當月LINE budget reserved count。Worker再以runtime monthly cap計算basis points utilization；disabled mode的cap與utilization為null。

快照只包含nullable age與non-negative aggregate integers，不含tenant、appointment、job、user、recipient、template、provider request或message欄位。它用於dashboard／log-based metric與alert，不是營收、device delivery或個別顧客通知紀錄；accepted ratio只能衡量provider acceptance。

## Responsive surfaces

P3-006 repository slice不增加顧客notification center或店家自由模板UI。既有consumer/merchant appointment detail若呈現通知狀態，只能讀server提供的coarse status，不能暴露recipient、provider response或內部failure detail；390×844與desktop都不得因狀態badge造成水平溢位。
