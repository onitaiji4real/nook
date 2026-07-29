# P1-011：Firebase verifier error classification

狀態：`done`

## 目標

只在 Identity Platform ID token 確實無效、過期、撤銷或對應帳號不可使用時回 401；Firebase／credential／network／certificate infrastructure failure 必須 fail closed 為 503，避免前端錯誤清除有效 session。

## 範圍

- Firebase verifier 啟用 revocation/disabled-user check。
- Known token rejection codes 映射 `invalid_token`。
- 所有其他 Firebase code、unknown error 與 infrastructure failure 映射 `verifier_unavailable`。
- Guard 維持穩定 HTTP `401 invalid_token` 與 `503 identity_verifier_unavailable` Problem Details。
- 補 adapter、guard unit tests、security sequence、gap audit 與 worklog。

## 驗收條件

- [x] Valid token 以 `checkRevoked=true` 驗證並建立 principal。
- [x] Expired/revoked/invalid/disabled/deleted-user token 回 401。
- [x] Certificate、permission、internal、network 與 unknown failure 回 503。
- [x] Unknown error 不降級成 401，provider message 不進 client contract。
- [x] API lint、strict typecheck、28 unit tests 與 production build 通過。
- [x] OpenAPI 既有 protected endpoints 401/503 contract 與 security docs 同步。

## 非目標

- 不更換 Firebase/Identity Platform provider。
- 不移除 P1-007 的 local `User.status` 每 request 撤權檢查。
- 不執行真實 Firebase staging call；P1-D05 維持 external `BLOCKED`。
