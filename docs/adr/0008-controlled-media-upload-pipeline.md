# ADR 0008：Controlled media upload and verification pipeline

狀態：Accepted
日期：2026-07-22

## 背景

作品圖片通常遠大於JSON API payload。若由API proxy，會增加Cloud Run記憶體、逾時、流量成本與攻擊面；若只提供無限制signed PUT，client可繞過宣告大小，且object metadata不能證明內容可安全解碼。Private bucket又不能在驗證前把物件視為可發布資產。

## 決策

1. API建立DRAFT portfolio item與PENDING media asset後，以Cloud Storage V4 signed POST policy讓browser直傳。Policy固定server-generated key，限制allowlisted content type、1至15 MiB與15分鐘有效期；API process永不接收圖片位元。
2. Browser完成上傳後呼叫tenant-scoped complete endpoint。API建立具固定task name的Cloud Task，由Cloud Tasks使用專用service account簽OIDC token呼叫private worker。Cloud Run IAM是身份邊界；queue header只是defense in depth，不取代IAM。
3. Worker先以metadata檢查bucket、key、大小與宣告type，再以Sharp fail-on-warning解碼，限制60 MP與單頁。輸出為去除metadata的1600px display與480px thumbnail WebP；成功後刪除原始上傳物並將database狀態改READY。
4. Object paths只有三種固定server pattern：`tenants/{tenantId}/portfolio/{mediaAssetId}/upload`、`display.webp`與`thumbnail.webp`。Request不得提交bucket或key。
5. `MAX_PORTFOLIO_IMAGES`限制有效PENDING與READY。PENDING policy過期後不占額度；同一client UUID重試只能得到同一tenant資源或conflict，不重複消耗額度。
6. Verification以media asset狀態作idempotency key。READY直接回成功，REJECTED不重新處理；固定輸出key允許Cloud Tasks在中途database失敗時重試覆寫。
7. 新增直接dependencies：API使用`@google-cloud/storage`與`@google-cloud/tasks`；worker使用`@google-cloud/storage`與`sharp`。不新增GCP service，沿用既有private media bucket、Cloud Tasks queue、private Cloud Run worker與service accounts。

## 後果

- API的request size與圖片大小解耦，未驗證物件永遠不成為READY portfolio資產。
- Signed policy只能限制client宣告與upload request；實際內容安全仍由worker解碼驗證負責。
- 第一版刻意拒絕HEIC、SVG與animated image，可能要求部分手機使用者先匯出JPEG；支援前須評估decoder、browser UX、成本與測試語料。
- GCP mode需bucket、queue、worker URL與OIDC service account；任一缺少都在startup或operation fail closed。本機預設disabled，不能把local preview視為production upload證據。
- Public image delivery、cache invalidation與CDN留給P2-005；admin API不直接暴露可猜測的public bucket URL。
