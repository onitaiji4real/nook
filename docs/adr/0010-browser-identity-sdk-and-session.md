# ADR 0010：Browser identity SDK與session lifecycle

狀態：Accepted

日期：2026-07-22

## Context

API已有LINE ID token驗證與Firebase custom token簽發，但Web沒有取得LINE token、交換Firebase session或刷新Authorization bearer的能力。自行實作LINE authorization code或Firebase REST lifecycle會增加state、redirect、token refresh與provider相容性風險；把ID token存在localStorage則會擴大XSS後的credential暴露。

## Decision

Web新增官方`@line/liff@2.29.1`與`firebase@12.16.0` SDK，不新增identity service：

- LIFF SDK處理LIFF browser與external browser的初始化、redirect state、登入、raw ID token與登出。Web只把raw ID token及token內provider nonce送到既有exchange API；不把decoded profile送到server。
- Firebase Web Auth使用server簽發的custom token建立session，之後每次API request向current user即時取得ID token；不自行保存custom token或ID token。
- 預設`browserSessionPersistence`，關閉tab/window清除。店主明確勾選「信任這台裝置」才使用`browserLocalPersistence`，並提示共享裝置風險。
- Web server提供runtime public config endpoint，讓同一container image可跨環境promote；不使用build-time `NEXT_PUBLIC_*`凍結值。endpoint只回Firebase Web公開設定、consumer／merchant兩個LIFF ID與API public origin。兩個LIFF app分離是因Endpoint URL prefix不同，不能共用ID後在控制台來回改endpoint。
- `WEB_AUTH_MODE=disabled`時Studio保留明示LOCAL PREVIEW且不送API；`firebase-line`缺任一設定時route fail closed。Production API/Web origins必須HTTPS。
- tenant selection只保存非credential的tenant ID於sessionStorage；不保存LINE profile、Firebase token或PII。

## Dependencies and risk

兩套套件都是對應provider的官方SDK，會增加browser bundle、provider耦合與供應鏈面；採exact version、lockfile、dynamic import及只在登入流程載入LIFF。Firebase auth使用modular imports以控制bundle。版本更新需release note與登入回歸測試。

不用SDK的替代方案需自行管理LINE authorization code/channel secret與Firebase Secure Token refresh，安全與維護成本更高。Server cookie/BFF可降低browser bearer exposure，但會引入CSRF、cookie domain與server session storage；本phase沿用既有Identity Platform bearer contract，若未來需要高敏感資料再另立ADR評估BFF。

## Consequences

- 外部帳號未完成前只能LOCAL PREVIEW；這是預期fail-closed狀態。
- Firebase Web config與兩個LIFF ID是公開identifier，不是secret；仍只能回傳必要欄位。
- local persistence提升回訪轉換，但依賴店主對裝置的明確信任。
- XSS仍可在當下向Firebase取得token，因此CSP、dependency hygiene與禁止dangerous HTML仍是必要防線。
