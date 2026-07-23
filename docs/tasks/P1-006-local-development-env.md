# P1-006：Local development environment loading

狀態：`done`

## 目標

讓 fresh clone 依 README 建立根目錄 `.env` 後，可直接執行 migration 並啟動 web、API、worker，不需要手動 `source .env`。

## 範圍

- 使用 Node 24 原生 dotenv API 載入 repository 根目錄 `.env`。
- 讓 `pnpm db:migrate` 與 `pnpm dev` 共用相同載入行為。
- 保留 shell／CI 已明確提供的環境變數優先權。
- 不新增第三方 dependency，不讀取、輸出或提交 `.env` 內容。

## 驗收條件

- [x] `.env` 存在時，root command 的 child process 可取得其變數。
- [x] shell 已設定的變數不會被 `.env` 覆寫。
- [x] `.env` 不存在但 CI 已注入環境時，wrapper 不會自行失敗。
- [x] `pnpm db:migrate` 可從 repository root 完成。
- [x] web、API、worker health/readiness endpoints 可從本機存取。
- [x] README 與 `docs/worklog.md` 記錄操作方式、驗證及風險。

## 非目標

- 不設定真實 LINE、Identity Platform 或 GCP credentials。
- 不變更 production runtime 的 secret injection。
- 不加入 Phase 2 產品功能。
