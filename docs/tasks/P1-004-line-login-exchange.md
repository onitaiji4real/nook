# P1-004：LINE login exchange

狀態：`done`
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

## Handoff evidence

- `@nook/line` 5 個 synthetic contract tests：valid、expired、wrong audience、invalid nonce、provider timeout。
- API integration 4 個 LINE exchange tests：無 cookie/敏感 log、concurrent idempotency、401/503 Problem Details；既有 tenant/RBAC 7 個 regression tests 同時通過。
- Firebase adapter 2 個 unit tests；typed config 在 firebase mode 缺值時 fail closed。
- Terraform 五個 configuration validate、3 個 mocked tests、isolation check 與 Trivy HIGH/CRITICAL 0。
- OpenAPI、ADR 0002、login sequence、data dictionary、runtime env/IAM 與 worklog 已同步。
- 真實 LINE/Identity Platform staging exchange 屬 P1-D05 外部 gate，維持 `BLOCKED`，不以 synthetic tests 冒充。
