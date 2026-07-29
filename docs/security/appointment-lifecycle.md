# Appointment lifecycle security contract

## Authorization and privacy

- 所有route要求ACTIVE User。Consumer owner只由principal user ID推導；malformed/unknown/foreign appointment一律404。
- Merchant要求ACTIVE membership；OWNER/MANAGER全店、STAFF只限同tenant唯一ACTIVE profile、VIEWER禁止write。STAFF other appointment與unknown同樣404。
- Current authorization在transaction內重驗且先於idempotency replay；replay不能繞過停權或角色撤銷。
- Consumer可取消inactive tenant的既有承諾；merchant lifecycle不因tenant suspension阻斷履約紀錄。Reschedule target只重驗Tenant ACTIVE，不重查hold成立後的publication/catalog狀態。

## Input and replay

- 六個transition endpoint使用strict body與ASCII 16..128 byte `Idempotency-Key`；只保存SHA-256 hash與canonical fingerprint。
- Reschedule要求target hold、v2 policy version、literal acceptance與controlled reason。Target malformed/foreign採privacy-safe 404；business conflict採固定409 code。
- Same-key及natural replay回原representation，不新增history/audit/outbox。不同business input不得被old+target link誤判成replay。

## Sensitive data

- Reason只用全域controlled enum，不接受自由文字或customer notes。
- Audit metadata只含safe IDs、action/reason code、replacement ID與requestId；outbox只含appointment IDs。
- Structured logs不含raw/hash key、fingerprint、body、hold/consumer ID、姓名、地址、政策或error stack。
- Transition與policy response皆`Cache-Control: private, no-store`；Web mutation key與response只留memory，登出／切tenant清除。

## Transaction and rollout

- 固定lock order為actor-key advisory lock、source appointment、target hold、occupancies ID ASC。Serializable conflict/deadlock有限重試三次，耗盡503。
- Occupancy owner/status/range、self-link與transition result任何不一致都rollback 503，不能用部分成功修補。
- Expand migration用NOT NULL DEFAULT兼容v1 writer。Production先完成v2 writer exclusive，才開policy v2 writes；最後一筆v1 hold到期後才開lifecycle。
