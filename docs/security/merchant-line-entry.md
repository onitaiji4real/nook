# Merchant LINE entry security contract

## Trust boundaries

- `route`是公開可猜的navigation hint，不是credential、tenant selector或authorization evidence。
- LINE ID token只在完成`liff.init()`後取得，立即交換Firebase session；不得進URL、Web Storage、DOM、log或analytics。
- `selectedTenantId`與client顯示role都不可信。API每次依current database membership授權。
- `membershipId`只用於stable UI key與membership識別，不取代tenant-scoped server check。

## Threats and controls

| Threat                               | Control                                                                                           | Evidence                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Open redirect／callback manipulation | redirect由current HTTP(S) origin、固定`/line/studio`與validated route重建；不接受absolute input。 | shared contract negative tests            |
| Primary redirect credential洩漏      | `liff.init()` resolve前不讀／改URL、不啟動analytics；不修改`liff.*`。                             | sequence unit tests                       |
| Route切換actor或tenant               | route schema只有六值；`/v1/me`重新取得current memberships，tenant選擇仍由API驗證。                | contract + HTTP integration               |
| Client偽造role／outcome              | Event endpoint不接受role或outcome；server由current membership推導並回傳bounded decision。         | strict request + 24 route/role HTTP cases |
| Revoked membership殘留               | 403後以`private, no-store`重讀ACTIVE-only`/v1/me`；selected tenant不在結果時才清除。              | API integration + session recovery        |
| STAFF看到全店預約                    | appointments repository依current STAFF profile固定scope；route只導向既有surface。                 | appointment view integration              |
| VIEWER誤寫資料                       | write application services仍拒絕VIEWER；沒有安全read-only UI的route直接fallback。                 | existing per-surface authorization tests  |
| PII／token analytics                 | event body只有tenant UUID與route enum；denied log不記未授權tenant ID。                            | captured-log integration                  |
| Parallel tab route混淆               | route只在各tab完成init後從當下URL解析，不寫共用storage。                                          | parallel-tab unit test                    |

## Exact logging contract

成功授權後可記：

```text
requestId, operation=line.merchant_entry, outcome, routeKey, httpStatus, tenantId
```

拒絕時省略tenant ID。禁止LINE subject、raw URL／return URL、membership ID、role、token、nonce、name、email、phone、customer／appointment資料與error stack。

## Failure policy

- Invalid route安全降級`home`；invalid analytics body回400。
- Missing／invalid Firebase bearer回401。
- Inactive user、foreign／revoked membership統一403，不揭露tenant是否存在。
- `/v1/me`固定`Cache-Control: private, no-store`；role-denied 403重讀後若membership仍ACTIVE，不誤清tenant。
- Entry成功回傳server current role推導的bounded decision，避免`/v1/me`與entry event之間角色變更造成錯誤導向。
- Database／identity provider unavailable回503；event analytics非授權失敗時不得阻塞已授權的Studio navigation。
- LIFF browser內未登入視為授權取消／缺失，不呼叫`liff.login()`；external browser才使用官方login redirect。
