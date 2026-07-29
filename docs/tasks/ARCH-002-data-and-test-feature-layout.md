# ARCH-002：Database 與 API test feature layout

狀態：`done`
依賴：ARCH-001

## Outcome

讓API application、database repository與測試使用相同的feature語彙，避免資料層和測試層再次形成難以導覽的平面檔案桶。

## Boundaries

- `packages/database/src/index.ts`維持唯一public entrypoint；consumer仍只從`@nook/database`匯入。
- Repository implementations依feature放在`packages/database/src/<feature>`，不新增deep package imports。
- API tests依`architecture`、`unit/<feature>`與`integration/<feature>`分層。
- 本任務不改變repository public symbols、schema、migration、HTTP contract或business behavior。

## Acceptance criteria

- [x] Database `src`根目錄只保留`index.ts`。
- [x] 18個repository依appointments、booking、LINE、onboarding、notifications、portfolio、publication、scheduling、service catalog與tenancy分層。
- [x] `src/index.ts`保留原有public exports，應用端無需修改package import。
- [x] API test根目錄沒有平放的`.test.ts`；unit與integration依feature分類。
- [x] Architecture test限制database root、每個repository feature的檔案數與API test top-level結構。
- [x] 原本會隨日期過期的booking hold／confirmation fixtures改由未來星期五推導，完整database integration不再有18個自然失敗。
- [x] README、ADR、task index與worklog完成。

## Verification

- Database strict typecheck、ESLint、build
- API strict typecheck、ESLint、build
- Database unit：15 files／39 tests
- API unit與architecture：13 files／69 tests
- Fresh database integration：database 11 files／63 tests
- Fresh database integration：API 7 files／57 tests
- 19 migrations皆由兩次獨立ephemeral database run從零套用
- Repository architecture：26 tests與所有static gates
- Prettier與`git diff --check`

## Remaining risks

- Database integration tests仍集中在`packages/database/test`根目錄；目前26個檔案尚可導覽，但新增Phase 4 tests前應採相同feature目錄，不再增加根層檔案。
- `src/index.ts`會隨feature持續成長；若public surface超過可讀範圍，應以內部feature barrel組織後仍由單一package entrypoint re-export，避免開放未受控deep imports。
