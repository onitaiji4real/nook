# MKT-001：Service introduction site

狀態：`done`

## 目標

把 Web root 從 Phase 1 scaffold升級為可直接檢視的RWD服務介紹站，讓潛在店家理解Nook的定位、LINE-first流程、產品藍圖、方案方向與媒合規則。

## 商業假設

- 第一受眾是一人美甲、美睫與小型工作室，不是大型連鎖或消費者marketplace流量。
- 首頁先說明「減少預約往返」的SaaS價值，再談平台媒合。
- 店家自帶顧客不抽成；平台首次媒合規劃8%、單筆上限NT$250。
- 方案使用商業技術計畫的規劃價，但明確標示尚待封閉Beta確認，不冒充已可購買。
- 在隱私政策、條款與受控intake流程完成前，不放會收集聯絡資料的假表單。

## 範圍

- Hero、產品操作流程、產品藍圖、四級方案、媒合規則、創始店家計畫、FAQ與footer。
- 桌面、tablet與mobile responsive layout。
- 語意化heading/navigation/list/details、skip link、focus state與reduced-motion支援。
- SEO metadata與Open Graph基礎文案。
- Marketing內容與UI分離於`src/features/marketing`，app route只負責composition。
- Server-render contract tests驗證誠實launch狀態、方案、媒合規則與無dead signup/form。

## 驗收條件

- [x] 首頁不再顯示Phase 1 scaffold placeholder。
- [x] 1280×720與390×844實際瀏覽器無document horizontal overflow。
- [x] Mobile navigation精簡且FAQ可鍵盤／原生details操作。
- [x] 所有CTA都指向存在的section，沒有空`href`或未持久化的申請form。
- [x] 文案區分已上線狀態、產品藍圖與規劃價格。
- [x] Web unit 5/5、lint、strict typecheck與production build通過。
- [x] 完整repository Prettier與diff check通過。

## 非目標

- 不收集email、電話、LINE ID或其他個資。
- 不建立登入、onboarding、店家後台或真實booking UI。
- 不新增analytics、CRM、表單SaaS、外部font/image CDN或cookie。
- 不把畫面中的店務後台示意宣稱為已上線功能。

## 下一步

- 完成privacy／terms草案與early-access資料契約後，再建立可稽核的創始店家申請slice。
- Phase 2店家onboarding開始後，把真實登入／後台入口接到header；在此之前維持誠實Beta狀態。
- 有正式domain與分享素材後補canonical URL、Open Graph image與production SEO crawl驗證。
