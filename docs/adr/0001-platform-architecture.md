# ADR 0001：Phase 1 平台架構

狀態：Accepted  
日期：2026-07-14

## Context

MVP 需要交易一致性、租戶隔離、地理查詢與小團隊快速迭代。web、同步 API 與背景工作有不同伸縮特性，但 booking、identity、tenant 與 notification 仍共享高度相關的資料模型。

## Decision

- 採 pnpm/Turborepo 的 TypeScript monorepo。
- 採模組化單體，部署為 Cloud Run `web`、`api`、`worker` 三個單位。
- PostgreSQL 16 + PostGIS 為 system of record，透過 Prisma migrations 管理 schema。
- 每個租戶資料存取都顯式要求 `tenantId`，authorization 位於 application service，repository 層再強制 scope。
- dev/stg/prod 使用獨立 GCP project、state、service account、database、storage 與 secret。
- Terraform 是 GCP 資源唯一宣告來源；migration 由獨立部署步驟執行。
- Phase 1 framework 基線為 Next.js 16、NestJS 11、Prisma 6.19；Node runtime 的安全升級由 ADR 0003 取代本文件原先的 20.17 決策。
- health contract 由 `@nook/contracts` 共用；API 與 worker readiness 透過 application service 探測 PostgreSQL，controller 不直接存取 Prisma。
- `apps/api/src` 根目錄只保留 `main.ts` 與 `app.module.ts`；前者負責啟動，後者只負責組裝 feature modules。
- 跨領域技術能力放在 `apps/api/src/platform/{config,http,identity}`，商業能力則依 bounded feature 放在 `apps/api/src/modules/<feature>`。
- 每個非空 feature 目錄必須有且只有一個 Nest module；controller、application service、token 與 feature-specific adapter 應由該 module 擁有。
- 架構測試限制 feature 目錄的 TypeScript 檔案數，若超過上限必須先拆出更小且有明確責任的 feature，而不是繼續堆疊同層檔案。

## Consequences

- 共用 domain package 能降低早期分散式交易與版本協調成本。
- 三個 runtime 可獨立調整實例數，但部署必須維持 contract/schema 相容。
- Cloud SQL 是早期主要固定成本；開發環境使用 ZONAL，production 預設 REGIONAL。
- 未來只有在量測顯示獨立伸縮或故障隔離有明確收益時，才以 ADR 拆出服務。
- 應用在設定缺失時 fail closed，且不得在 startup 自動執行 migration。
- 新增功能可以由單一 feature 目錄追蹤其 HTTP 與 application 邊界；跨 feature 相依需透過 module export/import，而非把檔案搬回 API 根目錄。
- `platform` 只接受跨多個商業 feature 使用的技術能力，不作為無法分類程式碼的共用雜物區。
