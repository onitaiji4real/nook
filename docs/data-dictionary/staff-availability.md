# Staff and availability data dictionary

## Staff ownership and lifecycle

`StaffProfile`是tenant-owned的可服務人員設定，不等同於登入membership。所有查詢與更新都必須同時帶`tenantId`與resource ID；`userId`目前可為null，邀請與帳號綁定留給後續task。

| Entity.field          | 語意                       | 規則                                                                   |
| --------------------- | -------------------------- | ---------------------------------------------------------------------- |
| `StaffProfile.userId` | 可選的本機使用者連結       | nullable；P2-003不建立邀請或登入綁定                                   |
| `locationId`          | 主要服務據點               | 必須是同tenant的ACTIVE location；database使用tenant-composite relation |
| `displayName`／`bio`  | 對內外顯示資料             | API security log與audit不得保存內容                                    |
| `bookingEnabled`      | 是否可進入後續availability | INACTIVE時必為false；重新啟用不自動打開，避免未確認班表就接受預約      |
| `sortOrder`           | tenant內顯示順序           | 重排必須提交該tenant全部ACTIVE與INACTIVE staff ID                      |
| `status`              | `ACTIVE`／`INACTIVE`       | ACTIVE計入`MAX_STAFF`；最後一位ACTIVE不可停用                          |

`StaffService`連結staff與其可提供的service。每位staff至少要有一個同tenant ACTIVE service；三方tenant ownership由composite foreign keys保護。資格不等同於公開或有空檔，availability engine仍需同時檢查service、staff、班表、例外與預約占用。

## Weekly rules

| Entity.field           | 語意         | 規則                                                        |
| ---------------------- | ------------ | ----------------------------------------------------------- |
| `weekday`              | ISO weekday  | 1為週一、7為週日                                            |
| `startTime`／`endTime` | 當地牆鐘時間 | PostgreSQL `time(0)`；API使用`HH:mm`；15分鐘格且start < end |
| `validFrom`            | 生效日       | PostgreSQL `date`；以`Asia/Taipei`解讀                      |
| `validUntil`           | 最後有效日   | nullable；不得早於`validFrom`                               |

同一staff允許同日分段。只有日期有效區間與每日時間同時相交才算重疊；HTTP contract與repository都拒絕重疊。更新採整份原子取代：舊rules刪除與新rules建立在同一transaction，任何失敗不留下半份班表。

## Availability exceptions

| Entity.field       | 語意                               | 規則                                                                          |
| ------------------ | ---------------------------------- | ----------------------------------------------------------------------------- |
| `type`             | `TIME_OFF`／`EXTRA_HOURS`／`BLOCK` | 休假、額外開放、人工保留                                                      |
| `startAt`／`endAt` | 絕對時間點                         | request必須帶ISO 8601 offset；PostgreSQL `timestamptz(6)`保存UTC；start < end |
| `reason`           | 營運備註                           | nullable；不得寫入security log或audit payload                                 |
| `status`           | `ACTIVE`／`CANCELLED`              | 相同staff的ACTIVE interval不可重疊；取消保留資料與audit                       |

重新啟用CANCELLED exception時重新做重疊檢查。區間使用半開語意`[startAt, endAt)`，相鄰但不重疊的例外可以存在。

## Entitlement and concurrency

- `MAX_STAFF`是通用integer entitlement；migration為預設方案設定1，不以plan code/name分支。
- 新增與重新啟用使用PostgreSQL Serializable transaction，在相同交易讀limit、計算ACTIVE用量與更新；serialization conflict最多重試三次。
- entitlement遺失、非整數或小於1時fail closed，API回`staff_entitlement_unavailable`。
- INACTIVE staff不占額度但保留service、weekly rules、exceptions與歷史識別。

## Migration and backfill

- Migration建立staff profiles、service assignments、weekly rules、exceptions與tenant-composite constraints，再加入`MAX_STAFF` entitlement/mapping。
- 對migration當下已存在且完成merchant profile的tenant，以primary location建立中性名稱「主要服務人員」，並指派既有ACTIVE services。
- 不猜營業時間，因此不回填weekly rules；新tenant可透過P2-003 API建立staff。
- Application startup不執行migration。已套用migration不可回改；後續調整使用forward migration。

## Audit and privacy

所有write保存actor、tenant、requestId、safe resource ID與action：`staff.created`、`staff.updated`、`staff.status_changed`、`staff.reordered`、`staff.weekly_schedule_replaced`、`staff.exception_created`、`staff.exception_updated`、`staff.exception_status_changed`。不得保存display name、bio、reason、service content或完整request body。
