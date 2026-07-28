# Phase 4：留存、評論與探索

狀態：`in_progress`
最後更新：2026-07-28
來源：`docs/product/business-technical-plan.md` §6.6、§6.8、§11、Phase 4；`docs/product/product-delivery-roadmap.md`

## 目標

在不把預約關係誤當行銷同意、不接受假評論、也不讓browser自報媒合來源的前提下，建立可稽核的顧客關係、已驗證評論與公開探索能力。Phase 4只建立留存與導流證據；不收訂閱、定金或媒合費。

## 交付順序

1. `P4-001` Consumer CRM consent boundary：先固定purpose、consent、停止利用、tenant isolation與匯出audit。
2. `P4-002` Verified completed-appointment reviews：只有合格COMPLETED appointment可建立一次評論。
3. `P4-003` Public search and acquisition attribution：PostgreSQL有界搜尋與server-signed attribution evidence。
4. `P4-004` Favorites and discovery return path：consumer私有收藏與cursor pagination。
5. `P4-005` Platform moderation console：最小admin RBAC、理由與不可變audit。

一次只把一個task設為`in_progress`。P4-001規格阻塞已完成fresh-reader回歸，進入expand migration/application implementation；其餘依賴前一條資料與權限contract，維持blocked。

## 不可跨越的邊界

- 成立預約只證明履約所需的服務關係，不等於行銷同意；marketing consent必須versioned、purpose-specific、可撤回。
- Tenant只能看自己因真實appointment形成的customer關係；搜尋、評論、收藏或attribution不可反向洩漏其他tenant的CRM資料。
- 顧客備註與聯絡資料屬PII；不得進log、analytics、URL、搜尋索引、公開評論或一般audit payload。
- Sensitive note/tag taxonomy在owner與legal核准前不得實作。自由字串tag不可用來記健康、醫療或其他敏感推論。
- 評論只有server驗證COMPLETED、consumer owner與唯一appointment後才能建立；公開狀態由moderation state machine控制。
- 搜尋只讀PUBLISHED merchant與公開READY資料。付費方案不得直接改organic ranking；贊助結果日後須明確標示。
- Attribution token由server簽發、bounded TTL、一次性或明確replay contract，browser source永遠不可信。Phase 4只建立evidence，Phase 5 settlement前不得產生媒合應收。
- 不新增外部搜尋引擎、CRM SaaS或行銷provider；PostgreSQL仍是第一版唯一搜尋資料來源。新增PostGIS／KMS等GCP能力前須ADR。

## 完成定義

- CRM的operational purpose與marketing consent分離，停止利用、撤回、匯出與audit均有tenant/authorization evidence。
- 已完成服務的一筆appointment最多一筆評論；非本人、未完成、跨tenant、重放與moderation transitions均fail closed。
- 公開搜尋具bounded query、cursor、地理／文字索引、公開資料過濾與可解釋ranking；沒有browser自報attribution。
- 收藏是consumer私有資料；moderation action是admin專用且不可隱性impersonate。
- OpenAPI、ADR、data dictionary、security/design、runbook、tasks與worklog足以由新session接手。

## External activation gates

- Legal/product owner核准Privacy／Terms、CRM purpose與retention、marketing consent文案、評論政策、申訴／moderation與敏感tag禁用規則。
- Owner提供地理資料品質標準、搜尋半徑／城市launch範圍、ranking權重與贊助揭露政策。
- Operations配置具名moderator、support／appeal SLA與production emergency removal owner。

Repository/local evidence不得冒充以上核准。未核准前功能只能在non-production或feature-disabled狀態驗證。
