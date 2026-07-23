# Studio authentication shell

日期：2026-07-22

## Purpose

Studio auth shell讓所有店務工作台共用同一組登入、tenant選擇與錯誤語言。它不是獨立示範頁；onboarding、服務、員工班表、作品與發布管理都必須置於相同session context。

## States

| State             | UI contract                                     | Available actions               |
| ----------------- | ----------------------------------------------- | ------------------------------- |
| `LOCAL_PREVIEW`   | 明示資料只存在目前頁面且不會送往API             | 繼續操作預覽、查看設定說明      |
| `NOT_CONFIGURED`  | 正式登入設定不完整且fail closed                 | 重試設定、查看runbook           |
| `SIGNED_OUT`      | 說明LINE登入用途、隱私與session選項             | 使用LINE登入                    |
| `SIGNING_IN`      | 顯示正在安全連線，不顯示token或provider payload | 等候、返回                      |
| `TENANT_REQUIRED` | 無店家時建立第一家；多店家時要求選擇            | 建立／選擇店家                  |
| `READY`           | 顯示目前店家與會員角色                          | 切換店家、登出、進入工作台      |
| `DEGRADED`        | 保留已建立session與未送出的表單內容             | 重試，不因503或網路錯誤強制登出 |

## Interaction rules

- 登入頁使用editorial gate；LINE綠只用於主要登入按鈕，不延伸成整站主色。
- 所有主要touch target至少44px，手機寬度下不產生水平捲動。
- 「信任這台裝置」預設不勾選，並明示共享裝置風險。
- 登入前說明只取得提供店務服務所需的帳號識別；不在Web保存LINE profile或token。
- `/studio`下的正式工作台都由同一個layout提供session；登入頁仍可在未登入狀態存取。
- 切換tenant前先確認目前沒有尚未送出的遠端draft；切換後清除舊tenant cache並重新取得資料。
- `401`清除無效Firebase session；`403`保留登入但顯示權限不足；`429`顯示稍後重試；`503`與network failure保留session及表單。

## Route intent

- `/studio/login`：LINE登入、session persistence選擇與設定錯誤。
- `/studio`：目前店家、membership與工作台入口；無membership時建立第一個tenant。
- `/studio/onboarding`、`/studio/services`、`/studio/staff`、`/studio/portfolio`：auth enabled時以選定tenant讀寫API，disabled時維持明示LOCAL PREVIEW。
