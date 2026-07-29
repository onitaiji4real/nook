# ADR 0002：LINE Login 與 Identity Platform adapters

狀態：Accepted
日期：2026-07-14

## Context

LINE-first 流程必須讓外部瀏覽器把已取得的 LINE ID token 交給後端驗證，再連結平台 local user，最後換成 Google Cloud Identity Platform 可驗證的 principal。前端傳入的 userId、未驗證 JWT payload 或測試 header 都不能作為身分證明。

## Decision

- API 以 LINE 官方 `POST /oauth2/v2.1/verify` 驗證 raw ID token、channel audience 與 nonce；adapter 另行 defense-check issuer、audience、expiry、subject、nonce，timeout 固定為 3 秒。
- Identity Platform 採 `firebase-admin` 13.9.0；此版本支援目前 Node 24 runtime。套件只封裝 custom token 與 ID token 官方契約，不讓 controller 直接依賴 SDK。
- Firebase Admin 使用 Application Default Credentials；Cloud Run API service account 只取得對自身的 `roles/iam.serviceAccountTokenCreator`，不建立 service-account JSON key。
- `AUTH_ADAPTER_MODE=disabled` 是本機預設且 fail closed；`firebase` 模式缺少 LINE channel ID 或 Identity Platform project ID 時，應用啟動立即失敗。
- `(LINE, providerSubject)` 以資料庫 unique constraint 與 transaction 做 find-or-create；concurrent loser 的 transaction 回滾後讀取既有 identity，不能留下 orphan user。
- profile allowlist 僅含 LINE 回應的 `name` 與 `picture`，分別映射到 display name/avatar URL；不保存 email、raw token、nonce 或完整 provider response。

## Consequences and risks

- LINE verify 與 IAM signBlob 都是登入路徑的外部依賴；API 以穩定 Problem Details 區分 invalid identity 與暫時性 provider failure，並只記錄 outcome/latency。
- `roles/iam.serviceAccountTokenCreator` 能代表該 service account 簽章，因此 binding 僅限 API service account 自身；不得授予 project-wide principal。
- `firebase-admin` 是新增的第三方 runtime dependency，必須鎖版並納入 P1-005 dependency/container scanning；升級前需重新確認 Node engine 與 custom-token 行為。
- 真實 LINE/Identity Platform staging exchange 仍需要外部 channel/project 設定，不能以 synthetic contract test 取代。
