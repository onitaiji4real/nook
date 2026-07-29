# Appointment confirmation security contract

## Identity and ownership

- `POST /v1/appointments`只接受verified bearer consumer；inactive user由共用authentication guard拒絕。
- Body strict allowlist只有`holdId`、`policiesAccepted: true`與`policyVersion`。Consumer、tenant、staff、time、price、source、address及payment狀態皆由server決定。
- Hold row以`holdId + consumerUserId`鎖定；未知、malformed UUID或其他consumer一律使用privacy-safe 404。完整地址只存在successful owner response。

## Sensitive data boundaries

- Raw idempotency key只在application memory雜湊，不寫database、log、audit或outbox。
- Policy文字、完整地址、consumer profile與request body不進HTTP/application log。
- Audit只保存safe IDs、from/to status與source；outbox只保存tenant/appointment ID。
- Hold response可回policy snapshot/version，但不得提前回private address；public merchant response仍維持既有address disclosure allowlist。

## Transaction and replay

- Serializable transaction內建立appointment、item、history、audit、outbox與key mapping，轉移occupancy owner並consume hold。
- 所有writer使用hold→occupancy lock order；serialization/deadlock最多重試三次，耗盡503且無partial state。
- ACTIVE hold已到期時，以maintenance outcome同時把hold/occupancy轉EXPIRED後commit，再由application回409。
- Same-key fingerprint conflict回409，不以response透露原hold或appointment內容。

## Rollout

Staging/production預設`APPOINTMENT_CONFIRMATION_ENABLED=false`。先套expand migrations並部署可寫完整hold snapshot的revision；舊revision drain且既有10分鐘hold過期後，才在新revision開啟confirmation。
