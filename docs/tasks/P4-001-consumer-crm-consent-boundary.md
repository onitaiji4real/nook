# P4-001：Consumer CRM consent boundary

狀態：`blocked`
依賴：P3-005 repository/local acceptance

## Specification blockers

開始migration或程式實作前，必須先在ADR、data dictionary與API contract中完成：

- 定義consent grant／withdraw／supersede狀態機、版本與同時事件的唯一順序，以及停止利用後各read/write/export路徑的明確行為。
- 定義customer relationship何時建立、由哪個appointment event投影、取消／改期chain及projection replay/backfill的唯一演算法與checkpoint。
- 定義contact來源、是否允許由LINE／預約資料建立、current truth與snapshot責任，以及欄位級加密、key version、rotation與provider disabled時的fail-closed行為。
- 在選定同步或非同步export後，固定bounded size、artifact格式、TTL、撤銷、download authorization與retry/idempotency contract。
- 在notes encryption完成前，不建立notes明文或暫存欄位；retention與cleanup在legal核准前維持feature-disabled。

## Outcome

讓OWNER／MANAGER能在tenant內查看由真實appointment形成的顧客關係、加入受限的內部備註與非敏感tag，同時把服務營運目的、行銷同意、撤回／停止利用與資料匯出audit分開。預約成立不自動產生行銷同意。

## Domain contract

- `customer`以`tenantId + consumerUserId`唯一；只可由server驗證的tenant appointment投影或transaction建立，不接受browser任意新增關係。
- First/last visit、visit/no-show counts只由appointment state/history投影。COMPLETED才增加visit；NO_SHOW才增加no-show；取消／改期chain不得重複計數。
- 金額沒有final server-owned settlement value時保持unknown，不以catalog現價、estimate或quote推算`totalSpent`。
- Operational purpose固定為履約、客服與預約紀錄；marketing是獨立purpose-specific consent evidence，至少包含version、source、grantedAt、withdrawnAt與actor。
- 撤回marketing不刪除法定／履約資料，也不得影響既有預約；只禁止後續marketing eligibility。刪除、匿名化與retention由Phase 5 legal/data lifecycle處理。
- 第一版tag只允許tenant自訂非敏感標籤，名稱需bounded並禁止控制字元。健康、醫療、族群、宗教、性生活、身分證件及其他敏感推論不使用自由字串tag；未有核准taxonomy前明示禁止。
- Notes是tenant-private PII，需加密at-rest方案與ADR後才能落庫；不得以明文欄位作暫時實作。

## Authorization and privacy

- OWNER／MANAGER可查customer list/detail、管理允許的tag與notes；VIEWER／STAFF在本slice不取得CRM list、notes、聯絡資料或export權限。
- 每個query/write都要求`tenantId`與ACTIVE membership；controller不得直接存取Prisma。
- Consumer只能查自己的consent state與提出withdrawal；不能讀tenant內部notes/tags。
- List採bounded cursor，預設不回phone/email/note內容。需要PII的detail/export是獨立endpoint與明確authorization。
- `/v1/me`或browser selected tenant不作授權證據。Cross-tenant customer ID固定不洩漏存在性。

## Export and audit

- Export採非同步job或明確bounded同步contract；不可把大量PII寫入log、Cloud Tasks body或一般audit metadata。
- 每次PII detail view、export requested/completed/expired、note/tag mutation與marketing consent transition記safe audit：requestId、operation、outcome、tenantId、safe customer/job ID；不記姓名、聯絡資料、note、tag值或檔案URL。
- Export artifact需短效、single-purpose、tenant-bound並可撤銷；具體storage／signed URL設計若新增GCP能力須ADR。

## Delivery slices

1. 規格：ADR、data dictionary、consent state machine、PII classification與retention external gate。
2. Expand migration：customers、consent evidence、allowed tags/links、notes encryption envelope metadata、export jobs與必要unique/index。
3. Database/application：appointment projection、tenant RBAC、consumer withdrawal、idempotency與safe audit。
4. API/OpenAPI：bounded list/detail、notes/tags、consent及export contracts。
5. RWD：merchant customer list/detail與consumer consent recovery；390×844及desktop。
6. Verification：fresh migration replay、tenant isolation、authorization、projection replay/concurrency、PII/log scan、unit/integration/browser/build。

## Acceptance criteria

- [ ] Schema與migration採expand-and-contract；`tenantId + consumerUserId`唯一，projection replay／concurrency不重複。
- [ ] Operational relationship與marketing consent分離；grant／withdraw state machine、version/source與current truth明確。
- [ ] COMPLETED／NO_SHOW統計、取消與改期chain有domain及database evidence，unknown spend不被推算。
- [ ] OWNER／MANAGER、VIEWER／STAFF、consumer self-service與cross-tenant matrix有HTTP integration evidence。
- [ ] Notes at-rest encryption與key/version envelope有ADR及fail-closed test；明文不得落DB/log。
- [ ] Tag boundary拒絕敏感用途、控制字元、超長值與跨tenant links。
- [ ] PII detail/export採獨立authorization、no-store、bounded／expiring contract與safe audit。
- [ ] OpenAPI、data dictionary、security/design、runbook、worklog與task狀態完成。
- [ ] Lint、strict typecheck、unit/integration/browser tests、fresh migration replay、build與architecture gates通過。

## External activation gates

- [ ] Legal/product owner核准operational purpose、marketing consent文案/version、retention與停止利用政策。
- [ ] Security/platform owner核准notes/export encryption、key rotation、artifact TTL與incident owner。
- [ ] Owner核准第一版non-sensitive tag規範；敏感tag保持disabled。

## Non-goals

- 行銷群發、優惠券、segmentation automation、店家自有OA或CRM provider同步。
- DSAR最終刪除／匿名化、法定retention adjudication；由P5-002負責。
- 搜尋、評論、收藏、媒合費、定金、subscription或revenue reporting。
