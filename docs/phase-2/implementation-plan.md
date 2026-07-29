# Phase 2：店家供給與可預約資料

狀態：`in_progress`
最後更新：2026-07-22
來源：`docs/product/business-technical-plan.md` §2、§18

## 目標

讓已建立tenant的店主能安全完成店家資料、主要據點、服務、作品與可預約時段，逐步形成可公開、可搜尋、可預約的供給。Phase 2先完成店務SaaS必要資料，不提前實作平台抽成或媒合排名。

## 交付順序

1. `P2-001` 商家基本資料、主要據點與第一項服務。
2. `P2-002` 服務項目管理與entitlement限制。
3. `P2-003` 人員、每週班表與例外時段。
4. `P2-004` 作品集與受控圖片上傳。
5. `P2-005` 店家公開頁、地址隱私與publish readiness。
6. `P2-006` LINE/Firebase Web session與商家後台安全儲存。

後續task只有在前一項domain contract穩定後才開始；外部LINE、Firebase、GCS或GCP憑證不足時，可先完成local contract與測試，但不得把mock結果宣稱為production evidence。

## 架構邊界

- Web、API、worker維持三個deployable app，商家功能依feature/module拆分，不建立新的服務。
- 所有商家資料以`tenantId`隔離；write API在application service驗證OWNER或明確定義的角色。
- 商家profile、location、service由API transaction寫入；Web不直接連Prisma。
- 地址預設private；公開頁不可因admin response包含完整地址就直接曝光。
- 時區固定`Asia/Taipei`，時間點以UTC儲存；價格使用TWD整數。
- Publish必須使用readiness與entitlement，不可用硬編碼方案名稱判斷。

## Phase 2完成定義

- 店主可從Web安全登入並完成店家、服務、人員、班表與作品資料。
- 公開店家頁只曝光已核准欄位，地址隱私與publish gate有integration tests。
- 至少一項服務能產出可預約時段，跨tenant讀寫被拒絕。
- 圖片上傳有content-type、size、ownership與object-key限制，不經API proxy大檔。
- OpenAPI、data dictionary、design contract、task與worklog足以讓新session接手。

## 目前限制

- `P2-006`repository-local scope已完成：官方LIFF／Firebase browser session、runtime public config、Studio auth shell、tenant selection/bootstrap與typed API client均已建立；onboarding、服務、人員班表、作品與publication在auth enabled時接正式API，本機auth disabled仍明示LOCAL PREVIEW且不送API。
- `P2-002`服務目錄Web在正式session下已接list/create/update/status/reorder API與動態entitlement；auth disabled時維持React memory預覽且不送API。
- `P2-003`人員與排班具備通用`MAX_STAFF`、RBAC、tenant isolation、週間原子取代與UTC例外contract；Web已接正式API，並以`Asia/Taipei`確定轉換例外時間，disabled模式維持React memory預覽。
- `P2-004`repository／local acceptance已完成：private GCS signed POST、Cloud Tasks OIDC、private worker驗證、通用`MAX_PORTFOLIO_IMAGES`與RWD作品工作台均有contract與測試；外部GCP未設定時仍fail closed，不把本機預覽視為production upload。
- `P2-005`已完成公開merchant read model、地址隱私、作品／店家publish gate、永久`/m/{slug}` route、公開頁preview與Studio publication控制。真實地圖座標、consumer availability slots、appointment／hold仍未完成；後續應另立Phase 3垂直task，不混入已完成的P2-006。
- Phase 1外部GCP／LINE／deployment gates仍依`docs/phase-1/acceptance-evidence.md`，不因Phase 2 local work而視為完成。
