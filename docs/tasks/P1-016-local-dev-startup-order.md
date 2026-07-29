# P1-016：Local dev startup order

狀態：`done`

## 目標

讓 `pnpm dev` 在 macOS／Node 24 能穩定啟動 Web、API、worker，不因 Turbo 同時執行 shared package builds 與 persistent dev tasks而長時間只剩Web可用。

## 範圍

- Root `.env` 載入後委派 `dev:workspace`。
- 九個 shared packages以pnpm workspace concurrency 1先完成build。
- Build成功後才由Turbo同時啟動三個persistent apps。
- 移除Turbo `dev -> ^build`隱式並行dependency builds。
- 新增local-dev static contract與三個負向/正向tests。
- 後續補上dependency-independent `node infra/dev/doctor.mjs`，只顯示版本、key存在性、必要工具與服務狀態，不輸出`.env`值；讓部分啟動時可區分未安裝依賴與尚未啟動服務。
- pnpm 11.15移除舊版package-manager controls且預設會下載`packageManager`精確版本；repository workspace以`pmOnFail: warn`允許符合`engines.pnpm >=11.7.0`的Homebrew新版，本機保留warning，CI仍由workflow明確安裝11.7.0。

## 驗收條件

- [x] Sequential shared package build 9/9完成。
- [x] `pnpm dev` 不再出現Turbo dependency build卡住API/worker的狀態。
- [x] Web `/`、health、readiness與API/worker health/readiness共七個端點全部HTTP 200。
- [x] Contract拒絕移除workspace concurrency 1或恢復Turbo `^build` dependency。
- [x] Root architecture、lint、Prettier與diff checks通過。

## 非目標

- 不改production build、CI build或Cloud Run startup ordering。
- 不新增watch mode給shared packages；Phase 1修改shared package source後需重新啟動`pnpm dev`以重建dist。若未來需要package hot reload，必須另行設計而不能重新引入不受控的parallel build。
