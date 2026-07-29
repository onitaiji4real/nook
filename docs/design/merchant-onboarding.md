# Merchant onboarding design contract

## 目的與介面語氣

`/studio/onboarding`是店家營運介面的第一個slice，不是marketing landing page。視覺採「工作日誌／預約簿」：暖紙底、墨色線條、朱紅狀態與acid accent預覽區；資訊密度比首頁高，但維持清楚的三段建檔節奏。

## Responsive behavior

- Desktop：左側進度、中央表單、右側sticky live preview。
- Tablet：左側進度與表單並列，preview移到下方完整寬度。
- Mobile：進度、表單、preview單欄排列；所有輸入與button維持完整觸控寬度。
- 不依靠hover傳達必要狀態；focus-visible必須清楚；尊重全站reduced-motion。

## Product truthfulness

- Browser auth尚未完成前，submit只更新React memory中的預覽。
- UI必須顯示「資料尚未送出」與「重新整理即清除」，不得使用「儲存成功」。
- 不要求使用者貼入bearer token，不將token、電話或地址放進localStorage。
- 公開預覽預設只顯示縣市／行政區；完整地址toggle預設關閉。
- 預約按鈕保持disabled，直到schedule、publish readiness與真實consumer flow完成。
