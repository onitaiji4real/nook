# Public availability design handoff

## Experience contract

公開店家頁在服務清單後加入候選時段區。延續米紙、深墨、朱紅 editorial storefront：朱紅區塊是唯一主要操作面，深墨投影讓它與作品內容分層；桌面為說明／查詢雙欄，tablet 收成上下區塊，mobile 的欄位與時段皆可單手操作。

流程為服務 → 選填設計師 → 店家當地日期 → 查看候選時段。設計師清單只顯示能做所選服務的人員；「任何可服務的設計師」保留 aggregation contract。

## Truthful states

- Idle：說明需先選條件，不預先捏造 live 空檔。
- Loading：使用「正在整理最新空檔」，不宣稱鎖定。
- Empty：建議換一天，不暗示系統錯誤。
- Error：404 與暫時失敗使用安全、可行動文案，不顯示上游 payload。
- Available：顯示店家時區、日期與候選按鈕；選取後固定顯示「尚未保留」。沒有完成／成功 CTA。
- LOCAL PREVIEW：明示模擬時段，不能當作正式 availability evidence。

## Accessibility and responsive QA

Form controls都有可見 label；結果容器使用 `aria-live=polite`，錯誤使用 alert，時段按鈕使用 `aria-pressed`。鍵盤 focus 與 selected 共用高對比深墨狀態。驗收 desktop 1280×800 與 mobile 390×844，確認沒有水平溢位、fixed bar不遮住操作，console 無產品 warning/error。
