# ADR 0003：Node runtime security baseline

狀態：Accepted
日期：2026-07-14

## Context

Phase 1 最初鎖定 Node 20.17，但 Node 官方已在 2026-03-24 將 v20 標為 EOL。P1-005 使用最新 Trivy database 掃描 20.17 production image，發現 Debian layer 16 個與內建 npm 12 個可修復 HIGH findings；繼續部署 EOL runtime 或忽略 findings 都不符合 release gate。

## Decision

- 開發、CI 與 production image 基線升級為 Node 24.17.0 LTS，並以精確版本 tag 建置。
- 保留 Prisma 6.19 與 firebase-admin 13.9；兩者的現有 unit/integration/migration tests 必須在 Node 24 image 重跑後才可發布。
- runtime stage 使用 digest-pinned Google distroless Node 24 Debian 13 nonroot image，不包含 shell、npm、pnpm、Corepack 或 Yarn；獨立 migration job 直接透過 distroless Node binary 呼叫鎖版 Prisma CLI。Prisma 6.19 的 transitive `effect` 固定到已修復的 3.20.0。
- 每個 release 仍以 Trivy 最新 database 阻擋有修復版本的 HIGH/CRITICAL image findings；不得以全域 ignore 取代升級。

## Consequences

- 本機仍使用舊 Node 時 package manager 會顯示 engine warning，開發者應依 `.nvmrc` 升級後再執行 clean install。
- Node 24 major runtime change需要三服務 health smoke、Prisma migration、LINE/Firebase adapter、database integration 與完整 workspace checks。
- build stage 使用精確 Node tag，但不進入 production；runtime base 已固定 distroless multi-arch digest，application image 仍由 CI build/push 後解析 digest，provenance 由 build log 與 image scan 保存。
