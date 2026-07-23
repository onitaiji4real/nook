# Phase 3：預約核心

狀態：`in_progress`
最後更新：2026-07-22
來源：`docs/product/business-technical-plan.md` §7、§18、§20、§21

## 目標

讓已發布店家能把真實班表轉成顧客可理解的時段，並以資料庫constraint、transaction、idempotency與狀態機完成不重複的預約。Phase 3先證明「找得到時段、鎖得住、確認不撞單、雙方查得到」，不提前混入搜尋排名、評論、CRM行銷或平台抽成。

## 交付順序

1. `P3-001` availability engine與公開可預約時段API。
2. `P3-002` 10分鐘booking hold、過期與occupancy constraint。
3. `P3-003` 免定金appointment確認transaction、idempotency與outbox。
4. `P3-004` 店家行事曆與顧客預約列表。
5. `P3-005` 取消、no-show與改期狀態機。
6. `P3-006` reminder jobs與LINE通知邊界。

付款預約必須等免定金確認與provider-neutral payment contract穩定後另立task；不得在P3-003直接綁死特定方案名稱或金流provider。

## 不可跨越的邊界

- Availability是提示，不是鎖定；建立hold與確認appointment時都必須重新驗證。
- 店家時區固定由tenant資料取得；Taiwan預設`Asia/Taipei`，時間點以UTC儲存與傳輸。
- 公開query只接受已發布店家的slug、有效service、可接單staff與bounded日期範圍，不回傳staff私人資料、例外原因、內部備註或完整住址。
- 所有占用區間採半開區間`[occupied_start_at, occupied_end_at)`；背靠背且buffer不重疊時允許。有效appointment與未過期hold都要占用完整區間；buffer不顯示給顧客，但必須參與防撞。
- Appointment status只能透過domain state machine改變；確認預約必須在PostgreSQL transaction內完成並寫status history與outbox。
- 所有write支援明確actor授權與安全audit；public booking flow不得信任client傳入tenant、價格、duration或staff-service關係。
- Entitlement以通用limit/capability查詢，不以方案名稱分支。

## Phase 3完成定義

- Published merchant至少一項服務能產生正確候選時段；weekly、exception、staff-service、duration、buffer、lead time與advance window由P3-001測試，真實hold／appointment occupancy分別由P3-002／P3-003補齊database integration evidence。
- 同一staff與占用區間不能產生兩筆有效hold／appointment；高併發與相同`Idempotency-Key`有database integration evidence。
- 免定金流程能由公開頁完成hold與confirmation；店家及顧客可查詢，tenant isolation與地址隱私不退化。
- 取消／改期保留歷史，不直接覆寫原預約；提醒可被建立、取消與安全重試。
- OpenAPI、ADR、data dictionary、security/design contract、runbook、task與worklog足以由新session接手。

## 目前狀態與外部限制

- Phase 2已提供ACTIVE service/staff、staff-service assignment、週間規則、UTC例外、publish readiness及永久`/m/{slug}`，可作availability輸入。
- P3-001已完成booking policy schema/backfill、純availability calculator、公開candidate API、Web同源proxy及RWD選時介面；目前仍標示`reservation=false`與「尚未保留」。Desktop 1280×800及mobile 390×844真實互動、溢位與console evidence已通過。
- P3-002 repository-local acceptance已完成：shared occupancy ledger、10分鐘authenticated hold API、availability occupancy adapter、retry-safe expiry worker與Web held/release flow均有concurrency、integration、browser與suite證據。Hold固定標示`appointmentCreated=false`。真實LINE／Firebase configured session與private worker Scheduler OIDC仍是明列的external activation gates。
- P3-003 repository-local acceptance已完成：免定金confirmation在單一transaction建立appointment/item/history/audit/outbox並原子轉移occupancy owner；Web可完成policy acknowledgement與confirmed presentation。真實LINE/Firebase與P3-006 provider delivery仍是external gates。
- P3-004 repository-local acceptance已完成：顧客可查自己的upcoming/past列表與隱私安全明細，店家可用tenant timezone、日期、人員與狀態查看有界行事曆；OWNER/MANAGER/VIEWER與STAFF scope、strict DTO、private no-store、RWD與browser evidence均完成。真實LINE/Firebase、真實STAFF綁定及owner隱私文字核准仍是external gates。
- P3-005 repository-local acceptance已完成：顧客可依成立時policy snapshot取消或以target hold原子改期；店家可取消、報到、完成與標記未到店；state machine、authorization、idempotency、history/audit/outbox、occupancy、reschedule chain、BookingPolicy設定、RWD操作與HTTP E2E均完成。真實LINE/Firebase帳號、staging角色矩陣與production mixed-version activation仍是external gates。
- P3-006 repository-local acceptance已完成：database-backed projection、deterministic Cloud Tasks、current-truth delivery、verified recipient、fixed retry key、platform monthly cap、LINE webhook與PII-free operations snapshot均具unit／integration／Terraform證據。真實LINE OA、secret、Cloud Tasks與staging裝置驗收仍是external activation gates；下一個slice是P3-007 Merchant LINE entry與RWD營運入口。
- LINE Messaging API、正式LIFF/Firebase、GCP deployment及付款provider仍需外部設定與staging證據；repository tests不等於production通知或金流證據。
