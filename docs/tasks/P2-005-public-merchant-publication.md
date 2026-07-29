# P2-005 Public merchant publication

狀態：`done`

## Outcome

讓商家可在後台確認發布缺口、明確發布作品與商家頁，並讓消費者以永久 slug URL 讀取最小且安全的公開資料。Web 同時提供可操作環境中的真實動態 route 與誠實標示的 local preview。

## Scope

- `GET/PUT /v1/tenants/{tenantId}/publication`
- `PUT /v1/tenants/{tenantId}/publication/portfolio/{portfolioItemId}`
- `GET /v1/marketplace/merchants/{slug}`（不需登入）
- `/m/{slug}` 公開頁、SEO metadata 與 `/preview/merchant` 合成預覽
- publish readiness、地址遮罩、短效圖片讀取 URL、audit 與 tenant isolation

不包含 consumer availability、appointment／hold、付款、評論、搜尋排名、QR 圖檔產生或 browser identity session。公開頁只會明示預約即將開放。

## Acceptance criteria

- [x] shared Zod request schemas 與公開／管理 response contract 已建立
- [x] nullable merchant `publishedAt` 與 PUBLISHED lifecycle DB checks 採向後相容 migration
- [x] readiness 不依 plan name，涵蓋 profile、location、service、staff、weekly availability 與 published READY portfolio
- [x] OWNER／MANAGER 可寫；active member 可讀；controller 不直接使用 Prisma
- [x] PUBLISHED 作品必須綁 READY media；商家未完成 readiness 不可發布
- [x] 公開查詢只回 ACTIVE tenant 的 PUBLISHED profile，且不回電話、完整私有地址、userId、storage key 或內部例外原因
- [x] 私有地址只回 city／district；公開地址才回完整地址與郵遞區號
- [x] 公開作品只回 PUBLISHED＋READY，圖片使用 15 分鐘 V4 signed GET URL；media disabled 時 fail closed
- [x] Web 有 mobile-first 公開商家頁、noindex local preview 與 truthful Phase 3 booking boundary
- [x] OpenAPI、architecture／integration／Web tests、migration、lint、typecheck、build 與 browser RWD evidence 全部通過
- [x] task、worklog、README 與 Phase 2 plan 完成交接同步

## Risks / follow-up

- signed URL 可在 15 分鐘內由取得者轉傳；不得把它當成使用者授權機制。只有已公開作品可以簽發。
- `API_INTERNAL_BASE_URL` 尚待 deployment contract 注入；production 不得依賴 localhost fallback。
- QR 應由永久 `/m/{slug}` URL 產生，但本 task 不為此新增第三方 dependency；後續需另立 acceptance。
