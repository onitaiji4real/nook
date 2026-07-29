# LINE LIFF and Firebase browser setup

本runbook只描述外部控制台設定與安全驗收。credential不得貼入issue、worklog、PR、terminal輸出或repository。

## LINE Developers

1. 建立或選擇LINE Login channel，記錄channel ID供API驗證。
2. 每個環境分別建立consumer與merchant LIFF app。Consumer endpoint prefix為`https://<web-origin>/m/`，merchant endpoint固定為`https://<web-origin>/line/studio`；兩者不得共用同一LIFF ID，staging／production也不得共用channel或LIFF app。
3. 啟用`openid`與`profile` scope；目前產品不要求email。
4. Consumer LIFF ID注入`LINE_LIFF_ID`，merchant平台OA LIFF ID注入`LINE_MERCHANT_LIFF_ID`。Channel secret只屬server/provider設定，禁止放入Web環境。
5. 分別用LINE app內LIFF browser與Safari／Chrome external browser驗證redirect、返回URL與登出。

## Firebase / Identity Platform

1. 在與API簽發custom token相同的Google Cloud project啟用Identity Platform／Firebase Authentication。
2. 建立Firebase Web App，將公開的Web config欄位注入Web runtime。
3. 把各環境Web hostname加入authorized domains；不要加入萬用字元或未受控preview domain。
4. API runtime identity使用ADC與最小權限簽發custom token；不得建立或下載長效service-account key。
5. 確認Web config的project ID與API custom-token issuer屬同一project。

## Web runtime variables

```dotenv
WEB_AUTH_MODE=firebase-line
WEB_API_PUBLIC_BASE_URL=https://api.example.com
LINE_LIFF_ID=1234567890-AbCdEfGh
LINE_MERCHANT_LIFF_ID=1234567890-Merchant
FIREBASE_WEB_API_KEY=public-web-api-key
FIREBASE_WEB_AUTH_DOMAIN=example.firebaseapp.com
FIREBASE_WEB_PROJECT_ID=example
FIREBASE_WEB_APP_ID=1:1234567890:web:abcdef
FIREBASE_WEB_MESSAGING_SENDER_ID=1234567890
```

本機尚未設定provider時使用`WEB_AUTH_MODE=disabled`。`firebase-line`缺任一欄位必須回503，不得悄悄降級成未驗證的正式模式。

## Existing API variables

- `LINE_CHANNEL_ID`
- `FIREBASE_PROJECT_ID`
- API所需ADC/runtime identity
- `CORS_ALLOWED_ORIGINS`包含精確Web origin

## Release evidence

- runtime config response只有公開欄位，沒有channel secret、service account或token。
- external browser與LIFF browser都完成登入、重新整理、tab關閉、opt-in長期登入與登出。
- 每個API request使用Firebase當下取得的ID token；browser storage中沒有custom token或ID token。
- 401會回登入；merchant tenant 403會以`private, no-store`重讀`/v1/me`，只有selected tenant已不在ACTIVE memberships時才清除；503／網路中斷可重試且不清除表單。
- 多tenant切換後不殘留上一家店的資料。
- Merchant rich menu逐項依[設定手冊](merchant-line-rich-menu.md)完成staging真機矩陣。
