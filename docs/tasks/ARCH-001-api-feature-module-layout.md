# ARCH-001：API feature module layout

狀態：`done`
依賴：P3-007 repository/local acceptance

## Outcome

把 `apps/api/src` 從平面檔案與過大的 marketplace module，整理成可依功能獨立修改、測試與交接的 Nest modules，同時以自動化測試防止結構再次退化。

## Boundaries

- `apps/api/src` 根目錄只保留 `main.ts` 與 `app.module.ts`。
- 跨多個商業功能共用的技術能力放在 `platform/{config,http,identity}`。
- 每個商業功能放在 `modules/<feature>`，並由單一 `<feature>.module.ts` 擁有 controller、application service、token 與 feature-specific adapter。
- `AppModule` 只做 module composition，不直接宣告 controller 或 provider。
- 本任務不改變HTTP contract、資料庫schema、domain規則或deployment topology。

## Acceptance criteria

- [x] API root沒有feature implementation檔案。
- [x] health、LINE auth／webhook／studio entry、tenancy、onboarding、service catalog各自有feature module。
- [x] 原marketplace拆成publication、booking與appointments；scheduling、portfolio維持獨立module。
- [x] 所有直接import與測試路徑已更新。
- [x] Architecture test限制API root、AppModule責任、每個feature的module數量與單層檔案上限。
- [x] ADR與worklog記錄決策、驗證與後續風險。
- [x] API lint、strict typecheck、unit、ephemeral database integration、build、repository architecture及format通過。

## Verification

- `pnpm --filter @nook/api typecheck`
- `pnpm --filter @nook/api lint`
- `pnpm --filter @nook/api test -- architecture.test.ts`：13 files／67 tests
- `node infra/dev/run-in-ephemeral-database.mjs -- pnpm --filter @nook/api test:integration`：7 files／57 tests
- `pnpm --filter @nook/api build`
- `pnpm check:architecture`：26 tests與所有static gates
- `pnpm exec prettier --write apps/api/src apps/api/test docs/adr/0001-platform-architecture.md`
- `git diff --check`

## Remaining risks

- `apps/api/test`仍是依測試種類命名的平面目錄；若測試數量繼續成長，應另開任務依feature分成unit／integration，避免在本次純source邊界搬移中增加第二種高風險變更。
- `packages/database/src`仍有多個feature repository放在同一層；Phase 4新增CRM repository前，應先規劃package內的feature目錄與公開export邊界。
