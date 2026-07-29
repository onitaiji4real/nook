# P2-004：Portfolio and controlled image upload

狀態：`done`

## 目標

讓店家建立作品項目，並以瀏覽器直傳private Cloud Storage的方式安全接收圖片。API只簽發短效上傳policy與保存metadata，不代理圖片位元；worker完成實際格式、大小、像素與ownership驗證後才把資產標為READY。

## 商業與安全規則

- `MAX_PORTFOLIO_IMAGES`是整數entitlement；免費曝光版初始值20。有效PENDING與READY資產計入額度，過期PENDING不占額度；application不得依plan code/name分支。
- OWNER、MANAGER與active STAFF可建立作品；VIEWER只讀。P2-003尚未完成staff profile與membership綁定，因此本task的STAFF權限是tenant-wide，後續細粒度ownership需另立task。
- Client提供UUID、作品文案與可選同tenant staff/service；bucket與object key只能由server產生。每個作品最多一張主圖、10個tag。
- 第一版只接受JPEG、PNG、WebP，宣告大小1 byte至15 MiB，實際解碼像素不超過60 MP且不得為多頁／動畫。SVG、HEIC及其他格式fail closed。
- Signed POST policy有效15分鐘，限制key、content type與content-length-range。API不得接收、log或proxy圖片內容。
- Worker以Cloud Run IAM驗證Cloud Tasks OIDC，另核對queue header；下載前先讀object metadata，解碼後產生1600px display與480px thumbnail WebP，輸出預設移除EXIF。原始上傳物在成功或拒絕後刪除。
- Verification必須idempotent；READY重試直接成功，REJECTED維持終態。產生衍生物後database失敗時可安全覆寫固定object key再重試。
- External GCP credential／runtime URL不足時，GCP adapter回503且不得產生假的成功；repository、contracts、worker processor與Web local preview仍可驗證。

## 驗收條件

- [x] Migration建立portfolio items、tags、media assets、composite tenant constraints與`MAX_PORTFOLIO_IMAGES`。
- [x] API提供tenant-scoped list、upload intent、complete、metadata update、reorder與soft delete；controller不直接存取Prisma。
- [x] Upload intent以transaction檢查entitlement、同tenant staff/service與client UUID idempotency，server控制bucket/object prefix。
- [x] Signed policy限制MIME、大小、key與15分鐘效期；disabled adapter fail closed。
- [x] Cloud Tasks使用OIDC呼叫private worker；worker拒絕錯誤queue、跨tenant、metadata mismatch、過大、壞檔、多頁與非allowlist內容。
- [x] Worker只在驗證與轉檔完成後標READY，保留安全rejection code，不保存原始檔或EXIF，重試idempotent。
- [x] RWD作品工作台在auth enabled時可用signed POST上傳、完成驗證、編輯metadata、排序、刪除及切換發布狀態；disabled時明示React memory預覽。
- [x] Tenant isolation、authorization、quota concurrency、object-key與worker idempotency有unit/integration tests。
- [x] OpenAPI、ADR、data dictionary、security/design contract、Phase 2 plan與worklog同步。
- [x] 相關migration、lint、typecheck、tests、build、browser與live smoke通過。

## 非目標

- P2-005公開店家頁、長效圖片delivery/CDN、publish readiness或consumer SEO。
- LINE/Firebase production provider與GCS staging驗收證據由外部設定runbook追蹤，不屬本task的repository-local acceptance。
- HEIC轉碼、影片、多圖carousel、AI審查、內容檢舉、billing checkout或額外1000張的實際結帳。
