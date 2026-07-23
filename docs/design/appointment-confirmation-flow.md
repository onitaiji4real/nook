# Appointment confirmation flow

## Consumer flow

1. 顧客從公開店家頁查詢candidate slot並建立10分鐘hold。
2. Hold ticket顯示server snapshot的預約政策、取消政策與倒數，但不顯示private address。
3. 顧客勾選「已閱讀並接受」後，唯一CTA為「確認預約」；不使用付款文案。
4. API成功後顯示`CONFIRMED · 預約成立`、店家當地日期時間、服務、人員、truthful price、policy及完整地址。
5. 畫面只能說「預約已建立」，不得把outbox row宣稱為LINE通知已送達。

## Failure states

- 401：回到LINE登入流程。
- 403 monthly limit：顯示「店家目前無法接受更多線上預約」，不責怪顧客或揭露方案。
- 409 expired/released：要求重新查詢候選時段。
- 409 policy mismatch：要求重新建立hold，不能暗中接受新版本。
- 503/network：保留畫面與同一React intent的idempotency key，讓顧客在倒數內重試。

LOCAL PREVIEW明示不寫database、不發通知，但保留相同的hold→acknowledge→confirm互動與mobile layout，供產品驗收。
