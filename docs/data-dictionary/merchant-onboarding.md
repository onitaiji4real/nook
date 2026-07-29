# Merchant onboarding data dictionary

## Aggregate ownership

`MerchantProfile`、`Location`與`Service`都是tenant-owned。每個query與write都必須帶`tenantId`；client-facing resource ID不能單獨作為授權邊界。`MerchantProfile`以`tenantId`一對一，並指向同tenant的primary location與starter service。

| Entity.field                                | 語意                              | 敏感度／規則                                   |
| ------------------------------------------- | --------------------------------- | ---------------------------------------------- |
| `MerchantProfile.category`                  | 店家主要美業分類                  | 公開候選資料；enum                             |
| `description`                               | 店家自述                          | 公開候選資料；publish前仍須內容規則            |
| `phone`                                     | 商家聯絡電話                      | 個資；admin response可見，不得寫log            |
| `lineOaUrl`                                 | LINE OA連結                       | 只允許HTTPS與核准LINE host                     |
| `instagramUrl`                              | Instagram連結                     | 只允許HTTPS `instagram.com`                    |
| `bookingPolicy`／`cancellationPolicy`       | 預約與取消政策                    | 商業內容；不得寫log                            |
| `visibilityStatus`                          | `DRAFT`／`PUBLISHED`／`SUSPENDED` | P2-001固定從DRAFT開始                          |
| `verificationStatus`                        | 審核狀態                          | P2-001固定UNVERIFIED                           |
| `primaryLocationId`                         | 主要據點                          | 必須與profile同tenant                          |
| `starterServiceId`                          | 第一項服務                        | 必須與profile同tenant                          |
| `Location.addressText`                      | 完整地址                          | 高敏感商家資料；不得寫log或無條件公開          |
| `city`／`district`                          | 縣市／行政區                      | 可作公開區域與未來搜尋條件                     |
| `timezone`                                  | 據點時區                          | P2-001固定`Asia/Taipei`                        |
| `isPublicAddress`                           | 是否可在公開頁顯示完整地址        | 預設`false`；公開頁仍須publish gate            |
| `geo`                                       | PostGIS point                     | nullable；P2-001不寫入，後續geocoding task處理 |
| `Service.durationMinutes`                   | 服務時間                          | 5–720分鐘整數                                  |
| `bufferBeforeMinutes`／`bufferAfterMinutes` | 前後緩衝                          | 0–180分鐘整數                                  |
| `priceType`                                 | `FIXED`／`FROM`／`RANGE`／`QUOTE` | 由database constraint保護欄位組合              |
| `priceAmount`                               | 固定價或起價                      | TWD整數；FIXED/FROM必填                        |
| `priceMin`／`priceMax`                      | 區間價格                          | TWD整數；RANGE必填且min ≤ max                  |
| `bookingEnabled`                            | 是否納入可預約計算                | 不等於店家已publish                            |

## Lifecycle and deletion

- P2-001只做upsert，不提供hard delete。
- location/service停用應使用status；刪除與歷史appointment關聯留待相應task定義。
- `merchant.onboarding.saved` audit只保存safe identifiers，不保存request payload。
- Web preview目前只用React memory，重新整理清除；不寫localStorage、analytics或第三方服務。

## Database invariants

- `(tenant_id, id)`為location/service scoped unique key；全域primary key同時阻止不同tenant挪用既有UUID。
- profile對primary location/starter service使用同tenant composite foreign key。
- service price check明確使用`IS NOT NULL`，避免PostgreSQL `CHECK`的unknown/null語意放行缺值。
- repository在一個transaction依序upsert profile、location、service、references與audit；任一步失敗全部回滾。
