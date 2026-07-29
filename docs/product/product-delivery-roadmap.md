# Nook產品交付與商業化路線圖

狀態：`active`
最後更新：2026-07-23
依據：[商業與技術計畫](business-technical-plan.md)、[垂直任務索引](../tasks/README.md)

## 目的

本文件把最終產品願景拆成可驗收、可營收且不依賴尚未建立之外部帳號的交付順序。目標產品同時具備：

1. 顧客從平台LINE OA／MINI App完成探索、登入、預約、取消與改期。
2. 店家從平台LINE OA快速進入mobile-first RWD營運後台，處理日曆、服務、班表與預約。
3. 店家可選擇付費連接自己的LINE OA，對自己的顧客發送交易通知與經同意的行銷／回訪訊息。
4. 公開Web提供服務介紹、方案價格、店家公開頁與可被搜尋的內容。
5. 訂閱、加購與媒合費具有可稽核的收入來源，不把provider acceptance、預約金額或導流來源誤當已收收入。

## 三條LINE能力必須分開

| 泳道            | 第一版provider／用途                                                        | Recipient與同意                                                                          | 成本與方案                                                                                | Fallback                                          |
| --------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| A. 平台OA入口   | Rich menu／LIFF URL開啟Web；不發交易訊息、不直接mutation                    | 點擊者仍須LINE Login與ACTIVE membership                                                  | 點擊不產生Messaging API訊息費；所有方案基本入口                                           | External browser走同一Web auth                    |
| B. 平台交易通知 | P3-006只使用平台OA Messaging API Push；MINI App service message保留disabled | 只送已驗簽FOLLOWING且同provider identity exact match的顧客；blocked/inactive fail closed | 平台承擔訊息費；reminder entitlement 0..2且平台monthly hard cap；HTTP 200/409只記ACCEPTED | 第一版無Email fallback，未送不影響預約transaction |
| C. 店家自有OA   | Phase 6每tenant Messaging API channel，品牌化交易通知與經同意的回訪         | 每tenant follow/block、purpose consent、退訂與suppression                                | NT$299/月automation entitlement；provider訊息費由店家負擔並獨立cost ledger                | 不得自動退回平台OA造成成本或同意混淆              |

### A. 平台OA作為入口

近期以平台OA rich menu或LIFF連結開啟既有Web。顧客進入預約流程；店家進入`/studio`後，由LINE Login→後端驗證→Identity Platform session完成身分與RBAC。URL不得攜帶tenant、role、LINE subject、bearer token或顧客資料。

此能力的價值是降低店家學習與客服成本，應作為所有方案的基本操作入口，不另按點擊或Messaging API訊息次數收費。第一版不解析店家自由文字命令，也不讓LINE postback直接改預約狀態；所有write仍在authenticated RWD畫面確認並由application service授權。

### B. 平台OA交易通知

P3-006使用平台Messaging API channel發送預約成立、取消、改期與24h／2h提醒。只對verified FOLLOWING recipient建立delivery claim，固定retry key且受platform monthly cap；LINE accepted不等於裝置送達。MINI App service message雖屬平台能力，但在verified MINI App、核准template與notification-token加密/rotation完成前保持disabled；第一版也沒有Email fallback。

### C. 店家自己的OA

後期讓每個tenant連接自己的Messaging API channel，目的是由店家承擔訊息費並使用自己的品牌關係。這是獨立付費模組，必須先完成：

- 每tenant channel與webhook destination ownership驗證。
- Channel secret/access token加密保管、rotation、撤銷與最小權限。
- 平台訊息、店家訊息的provider、成本、同意與退訂分帳。
- Follow/block狀態、recipient identity與跨provider subject不得互推。
- 行銷目的、頻率、quiet hours、退訂與個資停止利用紀錄。

在上述條件完成前，不接受token貼在一般設定欄位、不將token提交repository，也不以共用平台OA代店家無限量群發。

## 交付順序

| 階段     | 可被使用者感知的成果                                 | 收入／成本目的                      | 外部gate                                                     |
| -------- | ---------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| P3-006   | 平台OA交易通知與24h／2h提醒                          | 證明通知成本可控，不承諾已送達      | LINE provider/OA、兩個secret、staging device smoke           |
| P3-007   | 店家從平台OA一鍵進入RWD後台                          | 提高自助率、降低每店客服時間        | Rich menu／LIFF設定與真機入口驗證                            |
| Phase 4  | CRM、completed-only評論、搜尋、收藏、moderation      | 建立留存與平台導流價值              | 評論／隱私政策owner核准；地理資料品質                        |
| Phase 5A | Production/payment foundation與法遵                  | 先證明可安全收費，不先開真實扣款    | GCP/domain/WIF、Cloud Armor、HA/PITR、on-call、Terms/Privacy |
| Phase 5B | SaaS subscription、年繳、加購、entitlement lifecycle | 產生可稽核MRR／ARR                  | Provider/KYC、產品價格、billing portal、對帳、稅務／發票     |
| Phase 5C | Marketplace attribution shadow ledger                | 驗證規則但不認列或收取8%            | Attribution window、退款/爭議/appeal與settlement規則         |
| Phase 5D | 定金／退款provider adapter                           | 降低no-show；定金代收不冒充平台收入 | Webhook secret、reconciliation、chargeback、退款政策         |
| Phase 5E | 正式Beta activation                                  | 20–50家真實店安全使用與有限真實扣款 | 前述foundation、restore drill、support與incident gates全通過 |
| Phase 6  | 店家自己的OA、分群與回訪                             | NT$299/月加購＋訊息費由店家負擔     | 每店channel/token、consent與退訂、cost attribution           |

## 下一批垂直任務

每個task仍須包含schema/migration（若需要）、domain/application contract、authorization、tests、observability、OpenAPI/ADR與worklog。一次只把一個task設為`in_progress`。

### 預約核心收尾

- `P3-006` Reminders & LINE notifications：repository/local verification已完成；真實provider與staging裝置仍依external activation gates啟用。
- `P3-007` Merchant LINE entry & RWD operations：平台OA只作安全入口，店家write仍由RWD確認。

### Phase 4：留存與探索

- `P4-001` Consumer CRM consent boundary：顧客名單、店家備註／標籤、目的限制、停止利用與匯出audit。
- `P4-002` Verified completed-appointment reviews：completed-only、一預約一評論、修改窗與moderation state machine。
- `P4-003` Public search and acquisition attribution：PostGIS有界搜尋、可驗證attribution token、不可由browser自報source。
- `P4-004` Favorites and discovery return path：收藏、取消收藏、隱私與cursor pagination。
- `P4-005` Platform moderation console：最小admin RBAC、理由必填、不可隱性impersonate。

### Phase 5：收入與正式Beta

- `P5-001` Production payment foundation：Cloud Armor、HA/PITR restore drill、SLO、incident owner；任何production payment activation都依賴此task。
- `P5-002` Legal/data lifecycle：versioned Terms/Privacy/退款政策同意、DSAR、資料匯出/刪除/retention與行銷同意證據。
- `P5-003` Subscription catalog and checkout：server-owned price mapping、subscription state machine、raw webhook/idempotency；未交付feature不得標available。
- `P5-004` Billing operations：portal、payment method update、failed-payment/dunning、cancel/resume、proration/credit、refund/chargeback與daily reconciliation。
- `P5-005` Entitlement lifecycle：trial、monthly/annual、upgrade/downgrade、grace period與fail-closed access。
- `P5-006` Add-ons and usage billing：額外staff、storage與個人版payment add-on；LINE automation只由P6-004啟用與收費。
- `P5-007` Marketplace attribution shadow ledger：signed first-touch、first completed service、8%/NT$250計算，但先只shadow，不列收入、不開帳。
- `P5-008` Marketplace settlement and disputes：invoice/settlement、取消/no-show/partial refund、appeal與reconciliation通過後才可真實收8%。
- `P5-009` Deposit and refund adapter：payment intent、webhook truth、refund/chargeback state machine；專業/工作室bundle，個人版NT$99加購，免費版不可用。
- `P5-010` Revenue and accounting reporting：MRR/ARR、cash、deferred revenue、媒合應收、定金代收負債與provider cost分開。
- `P5-011` Merchant operations readiness：邀請/offboarding、support escalation、status/incident communication、backup restore owner。
- `P5-012` Production Beta activation：只有P5-001～011的適用activation gates通過後，才開20–50家真實店與有限真實扣款。

### Phase 6：店家OA與成長

- `P6-001` Merchant OA connection custody：tenant-owned encrypted credentials、ownership verification、rotation/revoke。
- `P6-002` Merchant OA transactional notifications：provider routing、recipient consent、per-tenant cost ledger與fallback policy。
- `P6-003` Segments and re-engagement consent：目的限制、quiet hours、frequency cap、退訂與suppression list。
- `P6-004` LINE automation add-on billing：NT$299/月 entitlement與provider message cost不混入月費。

## 商業正確性規則

- `Provider accepted`不是device delivered；`appointment completed`不是payment settled；catalog price不是已收營收。
- SaaS訂閱收入、加購收入、媒合費、定金代收與provider成本使用不同ledger／metric，不相互抵銷或重複認列。
- 免費方案必須有成本上限；LINE訊息、圖片、Cloud Tasks與人工客服都不是零成本。
- 方案差異一律由versioned entitlement/value解析；plan code/name只供catalog與呈現。
- 自行導流不抽成。平台媒合費只能由server簽發且未被竄改的attribution evidence觸發。
- 訂閱取消不刪帳務、audit或法定保留資料；到期後權限降級與資料匯出／刪除走明確狀態機。
- 促銷訊息與交易訊息不可共用模糊同意。Blocked、退訂、停止利用或inactive user都必須fail closed。
- 正式catalog必須對每個feature標示`available | beta | coming_soon`；`coming_soon`不可作為已收費權益或續約承諾。
- 專業版與工作室版包含定金模組；個人版可NT$99加購；免費版不可用。不得同一tenant同時收bundle與相同add-on。
- 優惠券、分群、回訪與店家自有OA在Phase 6驗收前只能顯示`coming_soon`，不得在Phase 5以已交付價值銷售。
- Phase 2既有multi-staff基礎仍需在付費catalog建立3/8人entitlement evidence；multi-location與進階staff RBAC是Phase 6，不得提前宣稱。
- P5 attribution只先shadow；P5-008 settlement/dispute完成且owner activation後才產生真實媒合應收。

## Catalog可售追蹤

在P5-003開始真實checkout前，必須建立machine-readable `catalog feature → entitlement → task → acceptance evidence → availability`表。至少涵蓋staff 1/3/8人、服務5/unlimited、作品20/300/1000/3000、每月預約20/unlimited、提醒1/2/custom、顧客資料、報表、CSV、品牌、定金、優惠券、分群、回訪與客服tier。

沒有acceptance evidence的項目一律`coming_soon`；若它是某方案的主要價值，該方案不得production sale。這項規則優先於商業計畫中的建議方案表，避免先收費後補功能。

顧客標籤已建立generic boolean entitlement `CUSTOMER_TAGS`與P4-001 local acceptance evidence，但既有plans在migration一律預設`false`，production `CRM_TAGS_MODE`亦由Terraform固定`disabled`。Taxonomy owner核准及catalog mapping完成前仍是`coming_soon`；不得因repository/API已存在就視為任何付費方案已交付。

## 帳務與收入basis

- Subscription invoice paid按服務期間形成cash與deferred/recognized subscription revenue；退款、credit與chargeback是獨立contra entry，不刪原ledger。
- 定金若平台代收，先記merchant payable／代收負債；只有另有明確平台手續費才記platform revenue。
- 媒合費在eligible completed appointment、attribution、settlement與dispute window均成立後才成為receivable；實收另記cash settlement。
- Payment provider fee、LINE message fee與直接雲端/支援成本進各自cost center；是否屬COGS或營業費用由會計owner定義，程式不得用淨額覆蓋gross evidence。
- Tax、電子發票／receipt、退款與provider reconciliation每日對帳；差異進exception queue，不能用application log補帳。

## 必須持續量測的單位經濟

| 指標                  | 定義                                                | 初期guardrail                                       |
| --------------------- | --------------------------------------------------- | --------------------------------------------------- |
| Paid ARPU             | 已付訂閱＋加購／付費tenant月數                      | NT$600–750是假設；需以月繳/年繳/創始方案mix情境驗證 |
| Gross margin          | 收入減金流、LINE、GCP與直接支援成本                 | 長期≥80%                                            |
| CAC payback           | 獲客成本／每店月毛利                                | <6個月                                              |
| Logo churn            | 月內流失付費tenant／月初付費tenant                  | 成熟後<2.5%                                         |
| Self-serve onboarding | 無人工介入完成上線店家比例                          | >70%                                                |
| Support minutes       | 每tenant每月人工支援分鐘                            | <20分鐘                                             |
| Reminder cost         | 平台OA計費訊息／active tenant與accepted appointment | 需受monthly cap與entitlement控制                    |
| Marketplace take rate | 實收媒合費／符合資格完成服務GMV                     | 8%，單筆上限NT$250                                  |

指標只讀可稽核ledger與terminal business state，不從application log或未驗證browser analytics推算營收。

ARPU forecast至少分monthly、annual與founder cohort，使用各自實際月均價格、折扣期限與add-on attach rate；不能只用月繳牌價證明NT$600–750。若實際mix低於guardrail，應調整bundle、add-on或獲客成本，而不是重複認列媒合費或定金。

## 外部帳號與owner決策register

可先完成repository工作，以下項目沒有真實證據前維持`external gate`。`TBD`不是通過；activation owner必須更新狀態、期限與evidence link。

| Gate                                                                                     | Accountable owner     | 狀態           | 目標期限 | Evidence |
| ---------------------------------------------------------------------------------------- | --------------------- | -------------- | -------- | -------- |
| 平台OA、Login/MINI App/Messaging channels同provider、rich menu、webhook與secret workflow | Product/LINE owner    | `not_provided` | TBD      | —        |
| Dev/stg/prod GCP、billing、Terraform state、WIF、domain與production approval             | Platform owner        | `not_provided` | TBD      | —        |
| Payment provider、merchant KYC、products/prices與webhook secrets                         | Finance/product owner | `not_selected` | TBD      | —        |
| 稅務、電子發票／receipt、退款與chargeback責任                                            | Finance/legal owner   | `not_approved` | TBD      | —        |
| Terms/Privacy、LINE跨channel、評論、媒合爭議、行銷同意與retention                        | Legal/product owner   | `not_approved` | TBD      | —        |
| 20–50家Beta名單、support SLA、incident escalation、status communication與on-call         | Operations owner      | `not_staffed`  | TBD      | —        |

External gate不得用假token或硬編production ID通過；fixture/local fake只證明repository contract。

## 每階段完成證據

任務只有在以下證據與task acceptance逐項對應後才可標`done`：

1. Migration fresh replay、第二次no pending及必要constraint concurrency evidence。
2. Tenant isolation、role authorization、idempotency、state machine與PII/secret negative tests。
3. Shared contract、OpenAPI與實際HTTP status一致。
4. Lint、strict typecheck、unit/integration、build、architecture與Terraform gates通過。
5. Desktop與390px mobile真實操作；不是只有截圖或靜態render。
6. `docs/worklog.md`記錄決策、命令、失敗、修正、未決風險與external gates。
7. 真實外部服務只在owner提供帳號/secret並核准環境後驗收；repository done不得冒充production ready。
