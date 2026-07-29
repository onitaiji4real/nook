# P3-007：Merchant LINE entry與RWD營運入口

狀態：`done`
依賴：P3-006 repository/local acceptance

## Outcome

讓已授權店家人員能從平台LINE OA rich menu／LIFF連結，一鍵進入mobile-first `/studio`後台並回到原本想操作的安全頁面。LINE只提供入口與身分bootstrap；所有預約、班表、服務與政策write仍在RWD畫面顯示current truth、要求使用者確認，並由API application service執行tenant/RBAC authorization。

此slice不做店家自有OA、自由文字bot command、LINE postback直接改預約、行銷群發或每tenant token custody。

## Product and commercial rules

- 平台OA營運入口是降低導入與客服成本的基本能力，所有方案可用；不按點擊次數或訊息次數計費。
- 店家自己的OA與進階LINE automation仍是Phase 6／NT$299加購，訊息費由店家承擔，不得偷用平台OA無限群發。
- 入口參數只能用shared contract的bounded route enum；它是可猜的navigation hint，不是opaque credential或authorization evidence。URL不可包含tenant ID、role、membership、LINE subject、email、phone或bearer token。
- Rich menu click不是登入、active membership、轉換、預約或收入證據。Analytics只記安全route key與authenticated success/failure aggregate。

## Route and authentication contract

- Canonical endpoint固定`/line/studio`；rich menu使用`https://liff.line.me/{liffId}/?route=<enum>`。Route enum只允許：`home | appointments | services | availability | portfolio | policies`。
- Client必須先完成`liff.init()`，之後才讀取LIFF恢復的route、啟動router/analytics或修改URL；不得自行讀／刪／改`liff.*` query。處理完route後才可用`history.replaceState`移除一般`route`參數。
- LIFF browser：`liff.init()`完成即取得login context，不呼叫`liff.login()`。External browser／LINE in-app browser：先`liff.init()`，若未登入則呼叫官方`liff.login({redirectUri})`，redirect後再次`liff.init()`，再讀route。
- `redirectUri`必須是目前origin下且位於LINE Developers Endpoint URL prefix內的canonical `/line/studio` URL，只攜帶同一個validated route enum。不能使用absolute user input、nested return URL或browser提供tenant slug。
- 不自建LINE OAuth authorization request、state或PKCE流程；使用LIFF SDK內建login state。後端仍驗issuer/audience/expiry/ID-token nonce與subject，route永遠不能影響actor identity。Parallel tabs各自從完成init後的URL解析route。
- 登入後由`/v1/me`重新取得ACTIVE user與所有ACTIVE memberships。若現有contract不能完整提供membership ID、tenant safe display name、role與stable ordering，本task必須明確擴充shared contract/OpenAPI；不能由browser猜role。
- 一個ACTIVE membership可自動選取；多個時必須明確選擇。選定tenant ID可沿用P2-006唯一核准的session storage key，但仍是不可信client input；每個API application service必須重新驗證ACTIVE membership、role與tenant scope，竄改不得造成跨租戶讀寫。
- 沒有membership、inactive或全部revoked固定顯示相同安全說明，不回顯tenant是否存在。Membership在選擇後被撤銷時，下一個API 403必須清除selected tenant並回到安全選擇/說明頁。
- Route mapping由versioned shared client contract靜態映射，不新增resolver API；route只決定初始navigation，頁面及API既有authorization仍是唯一權限來源。

## Role × route navigation matrix

`allow`只表示可導向該既有surface，不改變其application authorization；`read`表示既有read-only模式；`scoped`表示STAFF只能看到自己被授權的appointment；`fallback`固定回Studio home並顯示授權不足，不用403內容洩漏資源。

| route          | OWNER | MANAGER | VIEWER   | STAFF    |
| -------------- | ----- | ------- | -------- | -------- |
| `home`         | allow | allow   | read     | read     |
| `appointments` | allow | allow   | read     | scoped   |
| `services`     | allow | allow   | fallback | fallback |
| `availability` | allow | allow   | fallback | fallback |
| `portfolio`    | allow | allow   | fallback | fallback |
| `policies`     | allow | allow   | fallback | fallback |

如果任一既有surface目前沒有安全read-only模式，VIEWER也必須fallback；不得為符合表格而在本slice擴張write權限。OWNER/MANAGER write、VIEWER read與STAFF scoped的實際權限仍需逐route integration evidence。

## RWD interaction

- 390×844下入口、登入狀態、tenant selector、主要操作與錯誤恢復不得水平溢位。
- 本slice只導向既有Studio資料面，不新增「下一位顧客」或notification preview，避免在未定義shoulder-surfing與STAFF scope前擴張PII呈現。
- Deep link進入write頁時仍須重新讀current server state；不得從LINE query string預填idempotency key、status或actor。
- Session失效、inactive user、membership撤銷、LINE取消授權、`liff.init()`失敗與external login redirect failure都有可恢復繁中copy。

## Security and observability

- CSP/CORS/session storage規則沿用P2-006；LINE token不進localStorage、URL、log或analytics。
- `liff.init()`完成前不得啟動analytics、讀取/改寫LIFF URL或server redirect；避免primary redirect中的credential fragment與`liff.state`被洩漏或破壞。
- Structured log allowlist：`requestId, operation=line.merchant_entry, outcome, routeKey, httpStatus`；授權後才可記safe tenantId，永不記LINE subject或return URL raw value。
- Auth、`/v1/me`與每個write endpoint仍各自fail closed；前端隱藏按鈕不是authorization。
- Public entry與LINE exchange沿用bounded rate limit；tests涵蓋invalid route、LIFF reserved query、redirect prefix、cancel/replay、parallel tabs與callback URL manipulation。Route manipulation最多改變安全navigation，不能切換actor或tenant authority。
- Route mapping與role navigation須有unit tests；HTTP integration涵蓋inactive/foreign/revoked membership；browser test涵蓋LIFF browser、LINE in-app/external redirect與一般external browser。

## Acceptance criteria

- [x] Shared route-key schema、safe mapping與open-redirect negative tests完成。
- [x] LIFF init-before-URL/analytics、LIFF browser與external login→redirect→second init兩套sequence完成；不自建OAuth flow。
- [x] LINE entry頁、ACTIVE membership contract、single/multi-membership選擇、revocation recovery與role navigation完成。
- [x] 六route × OWNER/MANAGER/VIEWER/STAFF/inactive/no-membership矩陣有application及HTTP evidence。
- [x] Deep-linked write重新讀current truth且由既有application service授權；tenantId/role/status雖可被client竄改但不能跨越server authorization。
- [x] Desktop與390×844以deterministic LIFF／external browser sequence測試及本機實際browser完成入口→目標頁，無水平溢位與console error；真實LINE帳號及裝置矩陣明列於external activation gates。
- [x] Analytics/log不含token、LINE subject、contact、raw return URL或顧客資料。
- [x] Shared contract、必要的`/v1/me` OpenAPI變更、security/design sequence、LINE rich menu設定手冊、worklog與task狀態更新。
- [x] Lint、strict typecheck、unit/API integration、build、architecture、OpenAPI parse與relevant Terraform fmt checks通過。

## External activation gates

- [ ] Owner在平台OA建立rich menu並將六個route key對應到正式LIFF/Web URL。
- [ ] LINE Login、OA與MINI App同provider；staging真機完成merchant與non-merchant帳號矩陣。
- [ ] Owner核准rich menu文案、圖像、隱私說明與support fallback。

## Authoritative LINE references

- [LIFF API reference](https://developers.line.biz/en/reference/liff)：`liff.login()`、`redirectUri` Endpoint URL prefix與external browser流程。
- [Developing a LIFF app](https://developers.line.biz/en/docs/liff/developing-liff-apps)：external browser需init→login→redirect→再次init，且URL操作／analytics必須等init完成。
- [Opening a LIFF app](https://developers.line.biz/en/docs/liff/opening-liff-app/)：LIFF URL additional information、primary `liff.state`與secondary redirect行為。

## Non-goals

- 店家自有OA connection、token保管或per-tenant webhook。
- Chatbot自然語言、自由文字預約操作或postback直接mutation。
- 顧客行銷、分群、優惠券、回訪campaign或message billing。
