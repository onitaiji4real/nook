export class StudioApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly recoverable: boolean,
  ) {
    super(toSafeMessage(status));
    this.name = 'StudioApiError';
  }
}

export function classifyStudioApiError(status: number, code: string): StudioApiError {
  return new StudioApiError(status, code, [409, 429, 503].includes(status));
}

function toSafeMessage(status: number): string {
  switch (status) {
    case 401:
      return '登入已失效，請重新登入。';
    case 403:
      return '目前帳號沒有這項操作權限。';
    case 409:
      return '資料已被更新，請重新整理後再試一次。';
    case 429:
      return '操作太頻繁，請稍後再試。';
    case 503:
      return '服務暫時無法使用，資料仍保留在畫面上，請稍後重試。';
    default:
      return '目前無法完成操作，請稍後再試。';
  }
}
