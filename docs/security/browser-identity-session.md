# Browser identity session security contract

## Token handling

- Browser不得提供token輸入框，也不得把LINE ID token、Firebase custom token或Firebase ID token寫入URL、localStorage、sessionStorage、cookie、log、analytics、DOM、error message或business state。
- LIFF raw ID token只存在login function local scope，立即POST至`/v1/auth/line/exchange`；decoded token只能用來取得provider nonce，decoded profile不送server。
- Custom token只傳給`signInWithCustomToken`；受保護API呼叫前才從Firebase current user取得ID token。Firebase SDK負責refresh與其內部persistence。
- Sign-out依序清除Firebase Auth、selected tenant session key與LIFF login；即使provider logout失敗，也不能保留Nook authenticated UI。

## Browser and API behavior

- Merchant登入統一在canonical `/line/studio`執行`liff.init()`；一般`/studio/login`先導向該入口。External browser由入口呼叫`liff.login()`，redirect URI必須是同origin固定path與bounded route。Consumer與merchant使用不同LIFF app ID，避免Endpoint URL prefix衝突。
- `openid`是必要scope；不要求email。Server只信任LINE verify endpoint回應。
- API exact CORS allowlist必須包含Web origin；不能使用wildcard。
- 401表示Firebase token無效／撤銷，UI清除本機session並要求重新登入；403保留session但禁止操作；429顯示Retry-After；503/network failure保留session並允許重試。
- selected tenant ID不是credential，可保存於sessionStorage；每個API仍由server以membership重新授權。

## Runtime public config

允許公開：`apiBaseUrl`、consumer／merchant LIFF ID、Firebase Web API key/authDomain/projectId/appId/messagingSenderId及auth mode。

禁止公開：LINE channel secret、service account email/private key、ADC、database URL、media bucket signer credential、custom token或任何使用者資料。

Production若auth enabled但缺值、origin非HTTPS或Firebase project mismatch，runtime config route回安全503，不回缺少欄位的原始值。
