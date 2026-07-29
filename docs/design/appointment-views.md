# Appointment views experience contract

## Experience goals

P3-004提供兩個read-only工作面：顧客在`/appointments`確認自己的赴約資訊；店家在`/studio/appointments`用手機優先agenda查看一週節奏。此slice不提供取消、改期、付款、CRM、拖拉日曆或通知delivery tracking。

## Consumer desk

- 預設顯示「即將到來」，可切「過去紀錄」、載入下一頁並開啟owner-only detail drawer。
- Card顯示正確繁體中文status、service、店家、snapshot staff、location timezone時間與truthful price。`CONFIRMED`固定表達「已確認・尚未付款」。
- Detail才呈現完整地址、接受的policy snapshot與history；畫面明示「預約已建立」不等於LINE通知已送達。
- Signed-out顯示LINE登入CTA；configured/local preview、loading、empty、error/retry與pagination各有獨立狀態。

## Merchant calendar

- 使用selected membership的`tenantTimezone`計算local今日00:00至第7天00:00，再轉成canonical UTC query；DST仍是七個local calendar days。
- Response以`calendarTimezone`分組日期，每筆服務時間則以其location timezone snapshot格式化。
- 可切上一週、今天、下一週、服務人員及status。正式模式每次filter都重新呼叫server，不在browser載入全店資料後自行假裝授權。
- Agenda card只顯示營運必要的current consumer display name、service、snapshot staff、status、time、price與source。Detail可看safe history，不顯示contact、address、policy或notes。

## Responsive and visual system

- 延續Nook的paper grid、serif display type、ink border、signal orange與acid status標籤；consumer desk偏私密清單，merchant desk偏營運資料表，但共用狀態與detail語言。
- Desktop使用日期側欄與三欄appointment card；820px以下改為agenda堆疊，560px以下縮成雙欄card。390×844不得水平溢位，detail drawer佔滿寬度且不以fixed CTA遮住內容。
- Button最小高度約44px，tab使用`aria-selected`，filters有label，loading/list使用`aria-live`，error使用`role=alert`，drawer有可讀label與關閉按鈕。

## Truthfulness gates

- LOCAL PREVIEW始終顯示合成資料標記，不宣稱已連接LINE、Firebase、資料庫或真實顧客。
- Source只供未來對帳參考，不在UI宣稱已認列8%媒合費。
- 真實notification、取消/改期write、付款狀態及CRM contact要等各自後續slice，不用disabled假功能暗示已可用。
