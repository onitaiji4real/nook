export const productSteps = [
  {
    number: '01',
    title: '把店家搬上線',
    description: '設定服務、價格、作品與可預約時段。設計目標是讓一人工作室在 10 分鐘內開始接單。',
  },
  {
    number: '02',
    title: '分享同一個入口',
    description: '把專屬連結放進 LINE 官方帳號、Instagram 或 Google，不再來回問「哪天有空」。',
  },
  {
    number: '03',
    title: '讓顧客自己完成',
    description: '顧客不用下載 App，從 LINE 或一般瀏覽器看價格、選時段、確認預約。',
  },
  {
    number: '04',
    title: '把回訪留在手上',
    description: '店家在行動後台掌握預約、顧客與提醒；回訪是自己的，不被平台反覆抽成。',
  },
] as const;

export const productCapabilities = [
  {
    index: 'A',
    title: '店務後台',
    description: '服務、班表、休假、顧客與每日預約集中管理，手機也能完成日常操作。',
    note: '為一人工作室減少行政往返',
  },
  {
    index: 'B',
    title: 'LINE-first 預約',
    description: '顧客從熟悉的 LINE 入口開始，也能在外部瀏覽器繼續，不把流程綁死在單一 App。',
    note: '不要求顧客再下載一個工具',
  },
  {
    index: 'C',
    title: '公開店家頁',
    description: '作品、服務價格、政策與可預約時段放在同一頁，讓分享出去的流量能直接行動。',
    note: '先讓店家自帶流量也有價值',
  },
  {
    index: 'D',
    title: '可追溯的媒合',
    description: '只有平台真正帶來的首次新客才計媒合費；店家自己的客人與後續回訪不抽成。',
    note: '來源透明，避免帳務爭議',
  },
] as const;

export const plans = [
  {
    name: '免費曝光版',
    audience: '剛開始數位化',
    monthlyPrice: '0',
    annualNote: '不需綁約',
    features: ['1 位服務人員', '最多 5 項服務', '每月最多 20 筆預約', '最多 20 張作品'],
    featured: false,
  },
  {
    name: '個人版',
    audience: '一人工作室',
    monthlyPrice: '399',
    annualNote: '年繳 NT$3,588，月均 NT$299',
    features: ['服務與預約不限量', '300 張作品', '顧客紀錄與基本標籤', '2 次 LINE 預約提醒'],
    featured: true,
  },
  {
    name: '專業版',
    audience: '2–3 人小店',
    monthlyPrice: '899',
    annualNote: '年繳 NT$8,988，月均 NT$749',
    features: ['最多 3 位服務人員', '1,000 張作品', '進階顧客分群與報表', '定金功能包含於方案'],
    featured: false,
  },
  {
    name: '工作室版',
    audience: '4–8 人團隊',
    monthlyPrice: '1,699',
    annualNote: '年繳 NT$16,990',
    features: ['最多 8 位服務人員', '3,000 張作品', '完整員工權限', '員工別營運報表'],
    featured: false,
  },
] as const;

export const questions = [
  {
    question: '顧客一定要下載 App 嗎？',
    answer:
      '不用。Nook 的核心原則是從 LINE 自然開始，也能在一般瀏覽器完成；不要求顧客安裝另一個 App。',
  },
  {
    question: '我從 Instagram 或 LINE OA 帶來的客人會被抽成嗎？',
    answer:
      '不會。店家自行分享連結帶入的顧客不抽成；只有從 Nook 公開搜尋或推薦首次找到你的新客，完成服務後才規劃收取 8%，單筆上限 NT$250。',
  },
  {
    question: '月費有包含不限量 LINE 推播嗎？',
    answer:
      '沒有。預約服務訊息與店家 LINE OA 的行銷訊息會分開計算，避免少數大量發送者把成本轉嫁給所有店家。',
  },
  {
    question: '現在可以正式申請了嗎？',
    answer:
      '目前仍在封閉 Beta 籌備階段，尚未收集申請資料或收費。正式開放時會先公布服務條款、隱私政策與確認後的方案內容。',
  },
] as const;
