# Service catalog design contract

## Purpose and visual language

`/studio/services`是商家後台第二個可操作slice，延續onboarding的「工作日誌／預約簿」語言。桌面版以服務清單與編輯器並列，暖紙底承載營運資訊，墨色編輯面板、朱紅選取狀態與acid entitlement卡用來建立清楚層級。

這不是billing頁。畫面顯示穩定能力代碼`MAX_SERVICES`、目前ACTIVE用量與上限，不用方案名稱暗示尚未完成的付費功能。

## Interaction contract

- 初始提供兩筆ACTIVE與一筆INACTIVE預覽資料。
- 使用者可選取並修改名稱、服務時間、後置緩衝與固定價格。
- 可新增、停用、重新啟用、上移與下移服務；預覽遵守五筆ACTIVE上限與至少一筆ACTIVE規則。
- `顯示停用`只控制可見清單，不刪除資料或改變排序。
- 每次操作以`role=status`說明結果。文案必須指出資料只在React memory，重新整理會還原。
- 不提供bearer token輸入、不寫localStorage，也不宣稱遠端儲存成功。

## Responsive behavior

- Desktop：服務ledger與sticky深色編輯器並列，排序與價格在同列可掃讀。
- Tablet：清單在上、編輯器在下，保留完整欄位與狀態控制。
- Mobile：固定底部工作區導覽，服務列改為兩行；隱藏裝飾性拖曳符號與重複價格欄，保留狀態、排序按鈕與完整編輯表單。
- 不依賴hover傳遞必要資訊；focus狀態有高對比outline；控制項使用原生button、input與label語意。

## API handoff boundary

後端已提供具RBAC、tenant isolation、audit與Serializable entitlement enforcement的正式contract。Web只有在完成Identity Platform browser session後才可接線：由session取得ID token，呼叫相同tenant-scoped API，並處理Problem Details。不得為了展示而加入dev auth bypass。
