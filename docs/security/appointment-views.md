# Appointment views security contract

## Identity and authorization

- Consumer routes只從verified bearer principal取得`consumerUserId`，不接受client傳入consumer ID。Malformed、unknown、cross-consumer detail ID一律404。
- Tenant routes先驗ACTIVE membership。OWNER、MANAGER、VIEWER可讀全店；STAFF只可讀同tenant唯一ACTIVE linked profile的appointments。
- STAFF list明送其他staff filter回403；detail直接以`tenantId + effectiveStaffId + appointmentId`查詢，因此其他staff、unknown與cross-tenant一律404。非member固定403。
- Controller不接觸Prisma；所有tenant repository query最外層必須有`tenantId`，consumer query最外層必須有`consumerUserId`。

## Response privacy

- Consumer summary不含source、consumer identity、完整地址或policy；owner detail才回成立時完整地址、policy snapshot與安全history。
- Merchant response只增加current consumer display name與source。禁止回consumer ID、email、phone、avatar、LINE subject/profile、完整地址、policy全文、notes、raw actor ID或hold/occupancy資料。
- Staff名稱固定使用appointment consumed hold snapshot，避免catalog變更改寫歷史。Merchant current consumer name是明定的唯一current-profile join。
- 四個endpoint都設定`Cache-Control: private, no-store`。Web不把response存入localStorage、sessionStorage、IndexedDB或service worker cache。

## Query and cursor safety

- Merchant from/to只接受canonical UTC三位毫秒與`Z`；半開overlap window最大31 elapsed days，limit最大200。Consumer limit最大50。
- Cursor是無簽章的pagination state，不是授權憑證。Codec限制ASCII/base64url、exact keys、version、canonical UUID/timestamp及512-byte上限；任何篡改後的query仍重新套owner/tenant/staff predicate。
- Read operation不寫PII audit，避免日曆瀏覽產生高成本敏感紀錄。Structured logs只允許requestId、operation、outcome及安全entity ID；不記response、姓名、地址、query cursor或完整URL。

## Browser session boundary

- 登出或切換tenant時appointment component state會隨route/session重新建立；不得跨session沿用姓名或地址。
- LOCAL PREVIEW只使用repository內合成資料，明示不讀真實顧客、預約或LINE delivery state。
- 真實LINE/Firebase consumer與STAFF account仍需在staging做negative authorization驗證，不能以local preview取代。
