# P2-003：Staff and availability

狀態：`done`

## 目標

讓店家建立可提供服務的人員、服務資格、每週固定班表與例外時段，形成後續availability engine的可信輸入。此task不產生consumer slot、不建立appointment，也不把Web本機預覽宣稱為遠端保存。

## 商業規則

- `MAX_STAFF`是整數entitlement；免費曝光版初始值為1，限制計算ACTIVE staff。INACTIVE staff保留識別與歷史關聯，不占額度。
- OWNER與MANAGER可管理人員／班表／例外；active STAFF／VIEWER只讀。`StaffProfile.userId`綁定與邀請不在本task。
- 人員必須綁同tenant的ACTIVE location，至少具備一個同tenant ACTIVE service資格。人員停用時`bookingEnabled=false`，最後一位ACTIVE人員不可停用。
- 每週班表採ISO weekday 1（週一）至7（週日）、`HH:mm` 15分鐘格、`start < end`，允許同日分段但不可重疊；整份班表在一個transaction原子取代。
- 班表rule有`validFrom`與nullable `validUntil`；只有日期有效期間與每日時間同時相交才算重疊。
- 例外時段為`TIME_OFF`／`EXTRA_HOURS`／`BLOCK`，request接受帶offset ISO 8601，database一律保存UTC。相同staff的ACTIVE例外不可重疊；取消保留資料與audit，不hard delete。
- availability engine後續依序套用weekly schedule、exceptions、staff services、service duration／buffer、appointments／holds；P2-003不得提前回傳consumer可預約slot。

## 驗收條件

- [x] Migration建立staff、staff services、weekly rules、exceptions與`MAX_STAFF`，並為既有merchant tenant建立一位安全預設staff與service assignments。
- [x] API不依plan code/name分支；新增／重新啟用以Serializable transaction執行`MAX_STAFF`。
- [x] Staff list/create/update/status/reorder全部tenant-scoped，location與service assignment有database composite tenant constraints。
- [x] 最後ACTIVE staff不可停用；停用同時關閉booking，INACTIVE staff不占額度。
- [x] Weekly schedule整份原子取代，拒絕格式、日期／時間重疊與跨tenant staff。
- [x] Exception create/update/cancel使用UTC、拒絕重疊、保留audit且跨tenant不可讀寫。
- [x] RWD排班工作台可在本機切換人員、設定週間時段與新增／取消例外，明示尚未遠端儲存。
- [x] API採獨立Nest scheduling feature module，controller不直接存取Prisma。
- [x] OpenAPI、data dictionary、design contract、Phase 2 plan與worklog同步。
- [x] 相關migration、unit/integration、lint、typecheck、build、browser與live smoke通過。

## 非目標

- Consumer availability search、slot interval generation、appointment、hold、防撞constraint或預約transaction。
- Staff invitation、登入帳號綁定、細粒度「只能看自己」政策或薪資／抽成。
- 付費checkout、方案切換、額外人員加購結算或降級排程。
