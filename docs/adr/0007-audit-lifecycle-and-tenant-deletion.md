# ADR 0007：Audit lifecycle and tenant deletion safety

狀態：Accepted
日期：2026-07-21

## 背景

Phase 1 的 audit data dictionary 要求每筆事件具 request ID，但早期 expand migration 為相容既有資料，將 `audit_logs.request_id` 建為 nullable。`AuditLog` 對 `Tenant` 的 foreign key 另使用 cascade delete；任何未受控 tenant hard delete 都會同步刪除安全稽核證據。

產品計畫要求帳號在法定或帳務保留期後刪除或匿名化，但尚未取得適用司法管轄、帳務需求與 owner 核准的保存年限。Repository 不應自行發明年限或排程 destructive purge。

## 決策

1. 所有新 audit row 的 `request_id` 必須為 non-null。Contract migration 將既有 null row 回填為 `legacy-<audit UUID>`；此值只表示 migration provenance，不冒充原始 HTTP request correlation，也不含 PII。
2. Phase 1 不允許 tenant hard delete。營運停用使用既有 `Tenant.status = CLOSED`；只要 tenant 尚有 audit row，database foreign key 以 `ON DELETE RESTRICT` 阻擋刪除。
3. User 被實體刪除時，audit actor 維持既有 `ON DELETE SET NULL`，避免保留已刪除 user 的直接 foreign key，同時保存事件、tenant 與安全操作內容。
4. Audit payload 仍不得保存 profile、聯絡資料、token、customer note 或 request body。`before_json`／`after_json` 僅能放 allowlisted、完成隱私審查的欄位。
5. 真實保存年限、legal hold、tenant/customer export、匿名化與 purge job 必須由後續 owner／法遵決策定案，並以獨立 ADR、可重入 worker job、dry-run/report 與 deletion integration tests交付。在該決策前不自動 purge。

## 後果

- Application 與資料庫的 request ID contract一致，新增漏傳會立即失敗。
- 誤用 Prisma 或 maintenance SQL 刪除有 audit 的 tenant 時會 fail closed，不再靜默 cascade。
- Tenant closure 目前只有資料模型語意，尚未提供公開 API；後續 lifecycle slice 必須做 authorization、audit 與相關資料匿名化設計。
- 本 ADR 提供安全的 Phase 1 下限，但不代表已完成台灣或其他市場的法定保存期判定。
