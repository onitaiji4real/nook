# P1-014：Cloud Billing budget guard

狀態：`done`

## 目標

讓每個環境可用 owner 核准的帳務資料建立 project-scoped 月預算告警，同時在資料未提供時保持零資源、零費用與 fail-safe，避免 repository 猜測商業預算。

## 範圍

- 新增 nullable `project_budget` Terraform contract；預設 `null`。
- 驗證 billing account ID、幣別、正整數月額與不重複的正數門檻。
- Budget 只追蹤當前環境 project，以月為週期並包含 credits。
- 保留 Billing Account Administrators／Users 預設 email，並沿用最多五個已核准的 Monitoring channels。
- Budget resource 使用 `prevent_destroy`；取消或刪除必須由 owner 另行審查。
- 以 ADR、runbook、mock tests、gap audit 與 worklog 固化 ownership。

## 驗收條件

- [x] 三環境 example 預設 `project_budget = null`，不建立 budget。
- [x] 無效 account／currency／amount 會在 plan validation 被拒絕。
- [x] Owner-approved input 只建立一個 current-project budget，保留核准的金額、幣別與 50/80/100% actual-spend 門檻。
- [x] Billing IAM recipients 不被關閉，既有 Monitoring channel 可加入通知。
- [x] Terraform mock tests、五個 readonly validate、environment isolation、Trivy、Prettier 與 diff check 通過。

## 非目標與外部阻塞

- Budget 是告警，不是費用上限；本任務不自動停止服務、停用 billing 或建立 Pub/Sub action。
- Repository 不包含真實 billing account、預算金額或 notification recipient。
- 真實建立與通知測試仍需 billing owner 提供每環境輸入、審查 saved plan 並批准 apply；P1-B05／P1-E07 維持 `BLOCKED`。
