# P2-002：Service catalog and entitlement enforcement

狀態：`done`

## 目標

讓店家以穩定順序管理多個服務項目，並由通用entitlement service執行數量限制，不在application code硬編碼方案名稱。此目錄會成為人員、班表、公開頁與預約的共同服務來源。

## 商業規則

- `MAX_SERVICES`是整數entitlement；免費曝光版初始值為5。
- 限制計算`ACTIVE`服務。`INACTIVE`服務保留歷史識別與內容，不占可用額度。
- OWNER與MANAGER可新增、編輯、停用、重新啟用與排序；active STAFF／VIEWER只讀。
- 最後一個ACTIVE服務不可停用。停用starter service時，必須原子改指向下一個ACTIVE服務。
- 新增與重新啟用需在serializable transaction內讀取entitlement和用量，避免並發超額。
- 價格仍使用TWD整數與P2-001相同FIXED／FROM／RANGE／QUOTE invariant。

## 驗收條件

- [x] Plan、entitlement與plan mapping由migration建立，既有tenant有預設plan。
- [x] API不以plan code/name分支；只讀`MAX_SERVICES`value。
- [x] List/create/update/status/reorder全部tenant-scoped且有RBAC測試。
- [x] 第6個ACTIVE服務與超額重新啟用被一致拒絕。
- [x] 最後ACTIVE服務不可停用，starter replacement在同一transaction。
- [x] 重排必須提交tenant完整service ID集合，缺漏、重複或跨tenant皆回錯且不部分更新。
- [x] RWD服務目錄可在本機新增、停用與排序，明示尚未遠端儲存。
- [x] OpenAPI、data dictionary、design contract與worklog同步。
- [x] 相關migration、unit/integration、lint、typecheck與build通過。

## 驗收摘要

- 第七個local migration已套用；重跑為`No pending migrations to apply`。Serializable concurrent create只允許一筆跨過第四筆ACTIVE，最終維持5筆。
- Contracts 7/7、database unit 6/6、database integration 10/10、API unit 35/35、API integration 31/31、Web unit 11/11通過。
- Repository architecture 17/17、workspace sequential lint/typecheck、所有packages/apps production build、full Prettier與`git diff --check`通過。
- Browser實測桌機新增／停用／排序與375px mobile無水平溢出；live Web／API／worker health/readiness皆200，未登入service catalog GET為401。

## 非目標

- 真實billing checkout、subscription週期、paid plan切換或降級排程。
- 服務對人員的資格、班表、公開頁與預約時段。
- Browser token輸入、dev auth bypass或未經登入的真實Web寫入。
