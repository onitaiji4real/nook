# P1-013：Required CI format gate

狀態：`done`

## 目標

讓 full repository Prettier check 成為 `main` ruleset 已要求的 `verify` job 內的 blocking step，避免只在本機驗證、PR 卻能帶著 formatting regression 通過。

## 範圍

- `verify` frozen install／architecture 後執行 `pnpm format:check`。
- Format 必須早於 lint/typecheck，且不能 `continue-on-error`。
- 新增 CI quality live checker 與 missing/non-blocking negative tests。
- Root architecture command強制執行 checker。
- 更新 CI contract、gap audit、acceptance evidence 與 worklog。

## 驗收條件

- [x] `verify` job 明確執行 full repository `pnpm format:check`。
- [x] Format step 在 install/architecture 後、lint/typecheck 前，失敗會使 verify 失敗。
- [x] Negative tests 阻擋移除 format 或設為 non-blocking。
- [x] Architecture 14/14、workflow/live checkers、ESLint、Prettier 與 diff check 通過。

## 非目標

- 不更改 `main` ruleset contexts；format 納入既有 required `verify`，不新增 context。
- 不推送或觸發 GitHub Actions；新 workflow 的 remote clean-run evidence 需下一次 `phase1` push取得。
