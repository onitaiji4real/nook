# P1-003：Tenant onboarding and RBAC

狀態：`blocked`（等待 P1-001）  
目標：登入使用者可建立 tenant，成為 OWNER，並安全查詢自己的 membership。

## Vertical slice

- Schema/migration：User、Tenant、Membership、AuditLog 的約束與索引。
- Domain/application：建立 tenant + OWNER membership 的單一 transaction；角色為 OWNER/MANAGER/STAFF/VIEWER。
- API：`POST /v1/tenants`、`GET /v1/tenants/:tenantId`、`GET /v1/me`，使用 RFC 9457 error 與 requestId。
- Authorization：authenticated user；讀取需要 active membership；tenantId 不從未驗證 header 推導。
- Observability：記錄 tenant.created 與 authorization.denied，不記錄名稱、email、LINE subject。
- Documentation：OpenAPI、資料字典與 threat notes。

## Tests

- transaction rollback 不留下 orphan tenant/membership。
- 重複 slug 與重複 membership 回傳穩定 conflict。
- Tenant A 的 OWNER 不能讀 Tenant B；停用 membership 立即失效。
- audit log 寫入 actor/action/resource，敏感欄位不落 log。

## Acceptance criteria

- 三個 endpoint contract、authorization、integration tests 全數通過。
- controller 無 Prisma import；repository method 顯式要求 tenantId。
- migration backward compatible，工作報告記錄驗證與剩餘 RBAC 決策。
