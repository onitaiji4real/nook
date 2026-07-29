# P1-012：Cloud Run 5xx ratio alert

狀態：`done`

## 目標

把 Cloud Run 告警從 5xx absolute request rate 修正為產品要求的「同一服務 5xx / 全部 requests > 2%，持續五分鐘」，並以低流量 floor 避免單一偶發錯誤造成 paging noise。

## 商業規則

- Error ratio threshold：嚴格大於 2%。
- Retest window：連續五分鐘。
- Paging traffic floor：同一服務持續高於 1 request/minute 五分鐘。
- 低於 floor 的錯誤仍出現在 dashboard/log，不建立 paging incident。
- Missing data 視為 inactive，不把 scale-to-zero 當故障。

## 範圍

- 使用 request_count 5xx numerator 與 all-request denominator。
- Numerator/denominator 使用相同 alignment、reducer 與 service_name grouping。
- 用 `AND_WITH_MATCHING_RESOURCE` 將 ratio 與 traffic floor 綁定同一 Cloud Run service。
- 更新 alert documentation、Terraform assertions、runbook、gap audit 與 worklog。

## 驗收條件

- [x] Terraform test 證明 ratio threshold 為 0.02，且包含 denominator。
- [x] Ratio numerator 只含 5xx，denominator 與 traffic floor 包含全部 request。
- [x] Ratio 與 floor 依相同 service_name 匹配，不跨服務湊條件。
- [x] Missing data 不觸發；duration 皆為 300 秒。
- [x] Terraform fmt/validate/test、Trivy、format 與 diff check 通過。

## 非目標

- 不建立或修改 notification channel。
- 不執行 Terraform apply 或 synthetic alert drill；P1-E07 仍需 applied evidence。
- 不在缺少 billing/owner 決策時偷設 budget 金額。

## 驗證結果

- Terraform 五個 configuration readonly validate 與 7 個 mocked tests 通過；runtime case 直接檢查 combiner、2% numerator/denominator/grouping 與 1 request/minute floor。
- Release ownership 3/3、environment isolation、Terraform fmt 通過。
- Trivy Terraform HIGH/CRITICAL 0；full repository Prettier 與 `git diff --check` 通過。
- 未 apply 或觸發 synthetic incident；notification routing、實際 firing/recovery 仍屬 P1-E07 external evidence。
