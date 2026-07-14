# P1-004：LINE login exchange

狀態：`blocked`（等待 P1-003）  
目標：後端驗證 LINE token，建立/連結 local identity，再換發 Identity Platform custom token。

## Vertical slice

- Schema/migration：UserIdentity provider subject unique constraint；保存最小化 profile metadata。
- Domain/application：find-or-create identity；相同 provider subject 必須 idempotent。
- API：`POST /v1/auth/line/exchange`，只接受 raw token 與必要 nonce，不接受 userId 作身分證明。
- Authorization/security：驗證 issuer、audience/channel、expiry、signature/LINE verification response 與 nonce；錯誤不揭露 token 細節。
- Adapters：LINE verifier 與 Identity Platform token issuer 可替換、可 contract test。
- Observability/docs：auth outcome 與 provider latency；token/subject 經 redaction；更新 OpenAPI 和 login sequence。

## Tests

- valid、expired、wrong audience、invalid nonce、provider timeout。
- 同一 token/subject 重試只建立一個 identity；concurrent exchange 無重複 user。
- adapter contract 使用 recorded synthetic response，不提交真 token。
- log capture 證明不含 raw token、email 或 LINE subject。

## Acceptance criteria

- 成功回應只包含前端登入所需 custom token/expiry，不建立 cookie side effect。
- provider error 映射為穩定 Problem Details；外部 timeout 有上限。
- secret 只透過 typed config/Secret Manager 注入，文件與工作報告同步。
