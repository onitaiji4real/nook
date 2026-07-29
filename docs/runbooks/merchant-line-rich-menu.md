# Platform OA merchant rich menu setup

本runbook建立平台官方帳號的「店務入口」rich menu。它不建立店家自有OA、不傳送行銷訊息，也不要求把token貼到repository或工作報告。

## Prerequisites

- LINE Login channel、平台OA與merchant LIFF／MINI App屬同一provider。
- 每個環境有獨立HTTPS Web origin。
- `WEB_AUTH_MODE=firebase-line`及Firebase browser/API identity已完成。
- Consumer LIFF與merchant LIFF使用不同LIFF app ID；兩者Endpoint URL不同，不可共用同一ID硬改endpoint。

Staging與production必須使用不同的OA、LINE Login channel、consumer／merchant LIFF apps及Firebase project／authorized domains；可以由同一公司provider管理，但不得共用channel、LIFF ID、rich menu或callback origin。Staging OA只供測試帳號加入，production menu不可指向staging origin。

## Merchant LIFF app

1. 在LINE Developers同provider內新增merchant LIFF app。
2. Endpoint URL精確設為`https://<web-origin>/line/studio`。
3. 開啟`openid`與`profile`；目前不要求email或chat message scope。
4. 將公開ID放入該環境的`LINE_MERCHANT_LIFF_ID`。不要把channel secret或access token放Web runtime。
5. 確認Endpoint URL、Firebase authorized domain與API CORS都是同一環境，不混用staging／production。

一般consumer登入使用`LINE_LIFF_ID`；merchant平台OA入口使用`LINE_MERCHANT_LIFF_ID`。Production auth enabled時兩者缺一皆fail closed。

## Rich menu actions

建立六個URI action；`<merchantLiffId>`換成控制台公開ID：

| 顯示文案建議 | URI                                                         |
| ------------ | ----------------------------------------------------------- |
| 店務總覽     | `https://liff.line.me/<merchantLiffId>/?route=home`         |
| 預約行事曆   | `https://liff.line.me/<merchantLiffId>/?route=appointments` |
| 服務項目     | `https://liff.line.me/<merchantLiffId>/?route=services`     |
| 人員班表     | `https://liff.line.me/<merchantLiffId>/?route=availability` |
| 作品管理     | `https://liff.line.me/<merchantLiffId>/?route=portfolio`    |
| 預約規則     | `https://liff.line.me/<merchantLiffId>/?route=policies`     |

不得加tenant ID、tenant slug、role、membership ID、LINE subject、return URL、appointment ID、status或token。圖像與文案需owner核准後才發布；未核准時保持draft rich menu。

## Staging device matrix

每一格保存日期、tester role、裝置／LINE版本、expected route、actual result、console/network evidence與issue link；不得保存token或個資。

| Context                 | OWNER                           | MANAGER    | VIEWER                             | STAFF                                     | non-member／revoked |
| ----------------------- | ------------------------------- | ---------- | ---------------------------------- | ----------------------------------------- | ------------------- |
| LIFF browser            | six routes                      | six routes | home/appointments; others fallback | home/scoped appointments; others fallback | generic no-access   |
| LINE in-app browser     | login redirect then same matrix | same       | same                               | same                                      | generic no-access   |
| Safari／Chrome external | login redirect then same matrix | same       | same                               | same                                      | generic no-access   |

另驗證：

- 第一次external init → login → redirect →第二次init。
- 取消LINE授權、init failure、redirect failure都有繁中恢復copy。
- 390×844與desktop無水平溢位、console error或token/raw URL analytics。
- 選擇多membership後立刻撤銷；下一個403清除selected tenant。
- 修改route、加入`returnUrl`／tenant／role不能改變authority。

## Activation and rollback

Activation需要owner同時核准rich menu圖像／文案、隱私說明、support fallback及staging矩陣。先綁獨立staging OA；通過後在獨立production channel／LIFF app建立同版menu。Production綁定後先以owner、non-member各完成home與一個fallback smoke，再逐步開放；不得以repository unit test取代真機證據。

Rollback：

1. 在LINE OA Manager切回上一版rich menu或解除綁定。
2. 保留Web `/studio/login`一般入口與既有session。
3. 不刪除LIFF app或secret以避免不可逆；先停用menu並調查。
4. 以`line.merchant_entry`的safe aggregate與API 4xx/5xx判斷，不收集raw URL或使用者profile。

Production smoke失敗時立即解除production rich menu或切回上一版，保留staging環境調查；禁止把production LIFF ID改指向staging作為暫時修復。
