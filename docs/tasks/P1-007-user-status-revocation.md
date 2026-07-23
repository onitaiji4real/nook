# P1-007：User status revocation

狀態：`done`

## 目標

讓本機 `User.status` 成為登入與 tenant authorization 的強制撤權來源；使用者被標記為 `SUSPENDED` 或 `DELETED` 後，不得再取得 custom token、建立 tenant、讀取 tenant 或列出 membership。

## 商業與安全理由

- 付費 SaaS 必須能對濫用、退款爭議、帳號接管與法遵事件立即停權。
- Firebase token 仍有效時也必須由本機狀態撤權，不能等待 token 過期。
- 前端需要穩定錯誤碼區分「token 無效」與「帳號被停用」，避免無限重新登入。

## 範圍

- Identity repository 提供 active local user lookup。
- LINE exchange 在簽發 Identity Platform custom token 前拒絕非 active user。
- Bearer authentication 在建立 principal 前拒絕非 active user。
- Tenant create application service 再次執行 active-user authorization。
- Tenant membership queries 以 active user relation filter 作 defense-in-depth。
- 更新 OpenAPI、integration tests、gap audit 與 worklog。

## 驗收條件

- [x] Active user 的既有 LINE exchange 與 tenant 流程維持成功。
- [x] `SUSPENDED` 與 `DELETED` user 的 LINE exchange 回 `403 account_inactive`，且不簽發 token。
- [x] `SUSPENDED` 與 `DELETED` user 的 tenant create/read 與 `GET /v1/me` 回 `403 account_inactive`。
- [x] 不存在的 local user 即使 bearer verifier 接受，也無法建立 principal。
- [x] Repository/database tests 證明只有 `ACTIVE` 狀態回傳 active。
- [x] 錯誤與 structured logs 不包含 LINE token、provider subject 或 PII。
- [x] lint、strict typecheck、unit/integration tests 與 production build 通過。

## 非目標

- 不建立管理員停權 UI 或公開停權 API。
- 不設定真實 Firebase／LINE／GCP 帳號。
- 不改變 membership 或 tenant status 的既有撤權語意。
