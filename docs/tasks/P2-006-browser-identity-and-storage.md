# P2-006 Browser identity and storage

狀態：`done`

## Outcome

讓店主能從LINE LIFF或一般外部瀏覽器安全登入，將LINE ID token交換成Firebase custom token，建立可更新的browser session，選擇有權限的tenant，並讓四個Studio工作台透過同一個受保護API client正式讀寫資料。

外部LINE／Firebase帳號與GCP設定不足時，runtime必須fail closed；既有LOCAL PREVIEW仍可驗收畫面，但不得送出PII、保存token或冒充遠端成功。

## Scope

- Web runtime public config endpoint與production validation
- LIFF `init/login/getIDToken/logout`，支援LIFF browser與external browser
- LINE exchange後以Firebase `signInWithCustomToken`登入，Firebase SDK管理ID token refresh
- 預設browser session persistence；店主明確選擇後才使用local persistence
- Studio auth shell、登入／登出、session狀態、tenant selection／tenant bootstrap
- typed API client；401重新登入、403顯示授權不足、503保留session並可重試
- onboarding、service、staff/availability、portfolio/media與publication readiness正式API接線
- tests、browser evidence、外部設定checklist與交接文件

不包含Messaging API webhook、官方帳號聊天指令、appointment/hold、付款或production provider驗收；那些需要後續task與外部帳號資訊。

## Acceptance criteria

- [x] 新增dependency前ADR記錄Firebase Web SDK與LIFF SDK版本、用途、風險與替代方案
- [x] browser只取得runtime public config，不暴露channel secret、service account或server credential
- [x] token不進URL、manual input、localStorage/sessionStorage、log、analytics、React render或錯誤訊息
- [x] LIFF external browser與LIFF browser共用官方SDK流程；server仍驗證raw ID token，不信任decoded profile
- [x] Firebase Auth管理custom token交換、ID token refresh與sign-out；API request才即時取得ID token
- [x] session預設tab/window關閉即清除；local persistence需店主明確opt-in
- [x] `/studio/login`與Studio auth shell具configured／unconfigured／loading／signed-out／signed-in／error狀態
- [x] active memberships可選tenant；無membership的使用者可安全建立第一個tenant
- [x] 四個Studio工作台在auth enabled時正式讀寫API，disabled時維持明示LOCAL PREVIEW
- [x] 401／403／409／429／503與network failure皆有安全、可恢復的繁中UI
- [x] contract/unit/integration/browser tests覆蓋session、RBAC、tenant isolation、no-token-storage與RWD
- [x] OpenAPI、security、data、design、README、Phase plan、external setup checklist與worklog同步
- [x] lint、typecheck、tests、build、architecture與live routes通過

## 驗收摘要

- Staff工作台已接正式list/create/status、週間完整取代與例外新增／取消；`datetime-local`依`Asia/Taipei`確定轉換成UTC，首位人員只指派一項有效服務，避免超過API assignment上限。
- Portfolio工作台已接signed POST intent、GCS multipart upload、complete、metadata、排序、soft delete及作品公開／撤下；signed fields與credential不進storage、URL或log。Publication工作台依API readiness控制店家發布／撤下，LOCAL PREVIEW不會冒充正式發布。
- Credential module以靜態boundary test禁止Web Storage、URL與console sink；唯一storage adapter只允許tenant ID與登入偏好三個明確key。Web 12 files／38 tests、root 18/18 test tasks、architecture 17/17及Web production build均通過。
- Browser在1280×800與390×844驗收Studio總覽、staff、portfolio與publication，document無水平溢位、readiness不足時發布按鈕停用、console warning/error為0。Live routes皆200，未登入publication API為401。
- 外部LINE／Firebase／GCS production provider仍需依runbook提供設定與staging證據；此項明確排除於本task，不把LOCAL PREVIEW或synthetic adapter測試宣稱為production登入／上傳成功。

## Commercial checks

- 登入阻力不能迫使店家每天重做建檔；可信個人裝置提供明確opt-in長期登入。
- 多tenant店主必須看得懂目前正在操作哪一家，避免把價格／地址／班表寫錯店。
- Provider暫時失敗不可清除既有Firebase session；只有確定401才要求重新登入。
- Auth未設定不應阻擋投資人／設計驗收，但LOCAL PREVIEW不得與正式儲存混淆。
