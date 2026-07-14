# Tenant and RBAC threat notes

## Trust boundaries

- Authorization bearer token 在 P1-004 的 Identity Platform adapter 驗證前一律不可信。
- Route `tenantId` 是資源選擇器，不是 authorization 證明。
- Controller、application service、repository 分層；只有 repository 可接觸 Prisma。

## Threats and controls

| Threat                    | Control                                                                   | Evidence                            |
| ------------------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| 偽造 tenant header        | API 不接受 tenant header；tenant ID 來自 path 並由 membership 查詢授權。  | cross-tenant e2e test。             |
| IDOR / tenant enumeration | 無 active membership 統一回 403；回應不揭露 tenant 是否存在。             | Problem Details contract test。     |
| 停權後權限殘留            | 每次 tenant read 查詢 ACTIVE membership，不快取角色。                     | suspended membership e2e test。     |
| Onboarding partial write  | Tenant、OWNER membership、audit 使用單一 PostgreSQL transaction。         | foreign-key failure rollback test。 |
| Audit/log 洩漏 PII        | 只記 safe IDs、operation、outcome、requestId；captured log 測試排除名稱。 | denial log e2e test。               |
| Controller 繞過 service   | Static architecture test 禁止 controller import Prisma。                  | `architecture.test.ts`。            |

## Deferred decisions

- OWNER/MANAGER/STAFF/VIEWER 的逐操作 permission matrix 會隨 Phase 2 業務資源定義；不得提前以 plan name 硬編碼。
- Platform Admin 與 impersonation 不在 P1-003；未有 audit/banner/session controls 前不得加入 bypass。
- P1-004 必須以真實 Identity Platform ID token verifier 取代預設 fail-closed verifier。
