# Appointment lifecycle RWD flow

## Consumer

- `/appointments` detail由server `lifecycle.allowedActions`決定是否顯示取消／改期，browser clock只顯示倒數，不放寬資格。
- 取消確認畫面顯示成立時接受的取消政策、deadline inclusive語意與controlled reason。
- 改期用server提供的`rescheduleContext`進入既有availability→hold flow；確認畫面並列新舊時間、staff、price、policy，checkbox不得預勾。
- Success後清除detail/mutation state並重新抓取；409顯示資料已變更並refresh，不宣稱LINE已通知或已退款。

## Merchant

- `/studio/appointments` detail只依server allowed actions顯示取消、報到、完成、未到店；VIEWER與other STAFF不出現write CTA。
- 每個destructive action先確認，送出時鎖定按鈕；timeout/503沿用同key重試，2xx/4xx清key。
- `/studio/policies`以完整representation與revision CAS管理slot、預約提前時間及取消／改期self-service期限。自由文字政策另留商家資料頁並標示不會被系統解析。

## Responsive and state requirements

- 390×844與desktop都需涵蓋loading、empty、confirm、success、business conflict、unavailable與retry，不可水平溢位或由fixed CTA遮內容。
- Capability disabled時server actions為空且runtime config提前隱藏入口；UI不得先顯示可操作再以假成功取代503。
- 所有文案為繁體中文；CONFIRMED仍為「已確認・未付款」，COMPLETED不等於已結算，取消／改期不等於已送LINE。
