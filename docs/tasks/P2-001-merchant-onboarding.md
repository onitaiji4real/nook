# P2-001：Merchant profile, primary location, and starter service

狀態：`done`

## 目標

建立第一個Phase 2垂直切片：已建立tenant的OWNER能以一個transaction新增或更新店家profile、主要據點與第一項服務；active member能讀取建檔結果。Web提供RWD操作與即時預覽，在browser authentication完成前不假裝已遠端儲存。

## 商業與產品決策

- profile保持`DRAFT`／`UNVERIFIED`；完成三段資料只代表`readyForSchedule=true`，不代表可公開。
- 地址預設`isPublicAddress=false`，居家工作室可只公開縣市與行政區。
- 第一項服務支援固定價、起價、區間與另議；TWD以整數儲存。
- client提供location/service UUID，使相同payload重送更新相同resource；跨tenant重用UUID回409。
- OWNER可寫，active membership可讀。authorization denial有安全audit，不記錄電話、地址、政策或服務內容。
- 不以plan name判斷功能；更多服務與人員的entitlement留給後續task。

## 實作範圍

- Zod request與typed response contract。
- `merchant_profiles`、`locations`、`services` schema與兩個expand-only migrations。
- tenant-scoped Prisma repository與單一PostgreSQL transaction。
- `GET`／`PUT /v1/tenants/{tenantId}/merchant-onboarding`。
- RWD `/studio/onboarding`本機互動預覽；首頁提供可到達的入口。
- OpenAPI、data dictionary、Phase 2 plan、Web說明與worklog。

## 驗收條件

- [x] Contract拒絕不合法price range與非核准LINE／Instagram host。
- [x] Migration可套用且第二次執行回`No pending migrations to apply`。
- [x] 固定價缺少amount由database constraint拒絕，整個transaction回滾。
- [x] 相同client UUID重送不重複建立location/service。
- [x] OWNER write、member read、跨tenant denial與resource conflict由integration tests覆蓋。
- [x] Structured log與audit只含request/user/tenant等safe identifiers。
- [x] `/studio/onboarding`可填寫並即時預覽，預設隱藏完整地址，明示尚未遠端儲存。
- [x] Web、contracts、database與API相關unit/integration/lint/typecheck/build通過。
- [x] OpenAPI、data dictionary、task與worklog已同步。

## 非目標

- LINE/Firebase browser session、真實Web PUT、token input或dev auth bypass。
- 地圖geocoding、公開店家頁、publish、作品、班表、預約與付款。
- 多據點／多服務管理與方案entitlement enforcement。
- 修改tenant顯示名稱；此slice假設tenant已由`POST /v1/tenants`建立。

## 下一步

- `P2-006`已完成安全browser session並接上既有GET/PUT；token仍不得進form或localStorage。
- `P2-002`建立多服務CRUD與entitlement，再由`P2-003`建立人員／班表。
- `P2-005`公開頁必須依`isPublicAddress`redact完整地址，不能直接重用admin response。
