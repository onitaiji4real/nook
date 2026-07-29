# Staff scheduling design contract

## Purpose and visual language

`/studio/staff`是商家後台第三個可操作slice，讓店家在同一工作台選擇人員、維護固定週間與日期例外。視覺採「cobalt appointment ledger」：暖紙網格承接既有後台，墨黑人員索引、鈷藍選取／時段、acid entitlement與朱紅例外形成營運層級。

畫面顯示穩定能力代碼`MAX_STAFF`與ACTIVE用量，不顯示或依賴方案名稱。Weekly hours是本機預覽摘要，不是consumer可預約slot或營收預測。

## Interaction contract

- 初始提供一位ACTIVE與一位INACTIVE synthetic staff，使用者可切換查看各自班表。
- 每個ISO weekday可新增、修改或移除多段`HH:mm`時段；原生time input使用15分鐘step。
- 例外表單可建立休假、加開或保留時段，拒絕結束早於開始與ACTIVE重疊；取消只改狀態，保留卡片。
- 本機狀態遵守`MAX_STAFF = 1`、最後ACTIVE不可停用與INACTIVE不得接單；每次操作以`role=status`回報。
- 文案必須指出React memory在重新整理後還原、API儲存時轉UTC、登入串接完成前不遠端儲存。
- 不提供bearer token輸入、不寫localStorage、不宣稱已產生consumer slot或遠端儲存成功。

## Responsive behavior

- Desktop：staff index、weekly ledger、exception desk三欄並列，時間與營運例外可同時掃讀。
- Medium desktop／tablet：staff與weekly並列，exception desk移到全寬下方。
- Mobile：品牌topbar保留，人員索引、週間、例外依序單欄；三個工作區連結固定在viewport底部。fixed nav的祖先不得使用會形成containing block的`backdrop-filter`。
- 390px viewport不得產生document水平溢位；必要資訊不依賴hover，所有操作使用原生button、input、select與label。
- SSR與client必須產出完全相同的日期文字；本機預覽採確定性`M/D HH:mm`格式，不依賴server/browser ICU差異。

## API handoff boundary

後端已有獨立Nest scheduling feature module，以及RBAC、tenant isolation、audit、Serializable `MAX_STAFF`、班表原子取代與UTC exception contract。Web需等P2-006取得真實Identity Platform browser session後接線；由session取得ID token並呼叫tenant-scoped API，處理Problem Details，不新增dev auth bypass。

P2-003只建立availability inputs。Consumer slot generation仍需service duration/buffer、active staff/service、weekly rules、exceptions、appointments與holds；UI不得把週間時段稱為「可預約空檔」。
