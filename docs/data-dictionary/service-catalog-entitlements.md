# Service catalog and entitlements data dictionary

## Ownership and ordering

`Service`是tenant-owned的服務目錄項目。所有讀寫必須同時使用`tenantId`與資源ID；API以`sortOrder`、`id`穩定排序，重排時必須提交該tenant所有ACTIVE與INACTIVE服務，避免部分清單造成隱含順序。

| Entity.field                                | 語意                              | 規則                                                 |
| ------------------------------------------- | --------------------------------- | ---------------------------------------------------- |
| `Service.status`                            | 服務生命週期                      | `ACTIVE`計入額度；`INACTIVE`保留歷史且不計入         |
| `sortOrder`                                 | tenant內顯示順序                  | migration依既有`createdAt`、`id`回填；新服務接在尾端 |
| `bookingEnabled`                            | 是否可進入預約計算                | 停用服務時一併設為`false`；不代表已公開              |
| `durationMinutes`                           | 服務時間                          | 5–720分鐘整數                                        |
| `bufferBeforeMinutes`／`bufferAfterMinutes` | 前後緩衝                          | 0–180分鐘整數                                        |
| `priceType`                                 | `FIXED`／`FROM`／`RANGE`／`QUOTE` | 由database constraint保護欄位組合                    |
| `priceAmount`                               | 固定價或起價                      | TWD整數；FIXED／FROM必填                             |
| `priceMin`／`priceMax`                      | 區間價格                          | TWD整數；RANGE必填且min ≤ max                        |

最後一個ACTIVE服務不得停用。若停用`MerchantProfile.starterServiceId`指向的服務，repository必須在同一transaction內改指向下一個ACTIVE服務。

## Plan and entitlement model

| Entity.field                | 語意               | 規則                                                 |
| --------------------------- | ------------------ | ---------------------------------------------------- |
| `Plan.code`                 | 穩定方案識別       | database seed／營運識別用途；application不得依此分支 |
| `Plan.isDefault`            | 新tenant預設方案   | 建立tenant時必須取得唯一啟用中的default plan         |
| `Plan.billingPeriod`        | 計費週期           | `NONE`／`MONTHLY`／`YEARLY`；P2-002只使用NONE        |
| `Entitlement.code`          | 通用能力識別       | P2-002使用`MAX_SERVICES`                             |
| `Entitlement.valueType`     | entitlement值型別  | `INTEGER`／`BOOLEAN`                                 |
| `PlanEntitlement.valueJson` | 方案對能力的值     | `MAX_SERVICES`必須是非負整數JSON number              |
| `Tenant.planId`             | tenant目前套用方案 | migration回填預設方案；新tenant建立時寫入            |

API只取`MAX_SERVICES`的值，不讀plan code或name決定行為。若tenant未綁方案、mapping不存在或值無效，寫入fail closed並回`service_entitlement_unavailable`。

## Concurrency and errors

- 新增與重新啟用使用PostgreSQL Serializable transaction，在同一交易讀額度、計算ACTIVE數量並寫入；serialization conflict最多重試三次。
- 第六個ACTIVE服務或超額重新啟用回`service_limit_reached`，不部分寫入。
- 完整排序集合缺漏、重複或混入其他tenant ID回`service_order_mismatch`，transaction整體回滾。
- status與reorder audit只保存safe identifiers、actor、requestId與結果，不保存名稱、描述或價格。

## Migration compatibility

- P2-002 migration先建立plan／entitlement資料與mapping，再回填tenant的`plan_id`。
- tenant對plan的foreign key以`NOT VALID`加入，使既有資料可以expand；新寫入仍立即受constraint保護，後續維運可在確認資料後validate。
- application startup不得自動執行migration。
