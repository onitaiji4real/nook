# Web

Next.js consumer、merchant與service marketing web application。

目前root route由`src/features/marketing`提供RWD服務介紹頁；內容與視覺規範見`docs/design/marketing-site.md`。`/studio/onboarding`、`/studio/services`、`/studio/staff`、`/studio/portfolio`與`/studio/publication`各自使用獨立feature module；`/m/{slug}`使用merchant-public feature讀取公開API，`/preview/merchant`則是明示LOCAL PREVIEW且noindex的合成資料驗收頁。

本機Web server-side讀API預設為`http://localhost:8080`，可用`API_INTERNAL_BASE_URL`覆寫；staging/prod release必須注入實際API origin，不能依賴localhost fallback。正式公開頁可查詢候選時段並在完成consumer session後執行hold與預約確認；LOCAL PREVIEW只模擬互動，不寫入正式資料庫。

本機啟動後開啟`http://localhost:3000/studio`。`WEB_AUTH_MODE=disabled`時共用Studio shell會明示LOCAL PREVIEW，disabled模式一律不送API。`WEB_AUTH_MODE=firebase-line`設定完整後，`/studio/login`透過官方LIFF與Firebase SDK建立browser session，`/studio`負責tenant選擇／bootstrap；店務、發布、預約行事曆與政策工作台都透過共用protected client讀寫選定tenant的正式API。作品上傳採signed POST直送object storage，publication則以API readiness作發布門檻。

Browser公開設定由`/api/runtime-config`在runtime產生，詳細變數與provider checklist見`docs/runbooks/line-firebase-browser-setup.md`。custom token與ID token不進React state或Web Storage；session預設隨tab/window結束，只有店主明確信任裝置才使用Firebase local persistence。
