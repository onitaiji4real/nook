# P1-009：API CORS allowlist

狀態：`done`

## 目標

讓 LINE 內建瀏覽器與一般外部瀏覽器中的 Web，在 Web/API 使用不同 origin 時能安全呼叫 API；只允許經設定的精確 origin，不使用 wildcard 或 cookie credential。

## 範圍

- 新增 typed `API_CORS_ALLOWED_ORIGINS` runtime configuration。
- 只接受 unique exact HTTP(S) origins；拒絕 wildcard、path、credential、非 HTTP protocol 與重複值。
- API 明確限制 methods、request headers、credentials 與 preflight cache。
- Local `.env.example` 允許 `http://localhost:3000`。
- Terraform 以 list input 注入 API；empty list 預設拒絕所有 cross-origin browser access，production 只接受 HTTPS。
- 新增 config、CORS integration 與 Terraform positive/negative tests。
- 更新 README、Terraform runbook、gap audit 與 worklog。

## 驗收條件

- [x] Local Web origin 的 valid preflight 回傳精確 allow-origin。
- [x] 未設定 origin 不取得 CORS allow headers，same-origin／non-browser request 不受影響。
- [x] 不回傳 `Access-Control-Allow-Credentials`，且不接受 `*`。
- [x] Unsafe config 在 application startup／Terraform plan 前 fail closed。
- [x] dev/stg/prod 可獨立設定 origins，production 拒絕 plain HTTP。
- [x] format、lint、strict typecheck、unit/integration、Terraform validation/security scan 與 build 通過。

## 非目標

- 不建立 custom domain、Load Balancer 或 CDN routing。
- 不實作 Web API client、LIFF SDK 或登入 UI。
- 不使用 cookie/session credential；現行 API 仍使用 bearer token。
- 不執行 Terraform apply 或外部部署。

## 驗證結果

- Config 12/12、API unit 13/13（含 CORS 3/3）、worker health 2/2；affected lint 與 strict typecheck 通過。
- Config、API、worker production TypeScript build 通過。
- Terraform 五個 configuration validate、7 個 mocked tests、release ownership/isolation checks 通過；Trivy HIGH/CRITICAL 0。
- 實際本機 API `/health` 回 200；允許 origin 的 preflight 回精確 `Access-Control-Allow-Origin`，未允許 origin 沒有該 header，兩者都沒有 credentials header。
- Full repository Prettier 與 `git diff --check` 通過。
