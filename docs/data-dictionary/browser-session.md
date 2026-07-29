# Browser session data dictionary

Browser session不新增business database table。權威身分仍是`User`、`UserIdentity`、`Membership`與Firebase Identity Platform。

| Value                       | Owner             | Lifetime                      | Storage rule                       |
| --------------------------- | ----------------- | ----------------------------- | ---------------------------------- |
| LINE ID token               | LIFF SDK          | 約1小時／exchange local scope | 不手動持久化、不記錄               |
| LINE provider nonce         | ID token claim    | 單次exchange local scope      | 不持久化、不記錄                   |
| Firebase custom token       | API/Firebase Auth | 單次sign-in                   | 不手動持久化、不記錄               |
| Firebase ID token           | Firebase Auth     | 約1小時並自動refresh          | 每次request即時取得；不手動持久化  |
| Firebase refresh/auth state | Firebase SDK      | session或店主opt-in local     | 只能由Firebase SDK管理             |
| selected tenant ID          | Nook Web          | tab session                   | `sessionStorage`，不是授權依據     |
| Studio entry notice         | Nook Web          | 單次navigation                | 固定`role_fallback` code；讀後刪除 |
| runtime public config       | Nook Web server   | request/runtime               | memory；只含公開identifier         |

`GET /v1/me`只回ACTIVE user的ACTIVE membership／ACTIVE tenant，依`createdAt, id`穩定排序。Display資料可包含membership ID、tenant ID、name、slug、固定ACTIVE status、timezone與role；不得包含其他member、phone、email、provider subject或permission token。
