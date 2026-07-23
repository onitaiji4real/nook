import { describe, expect, it } from 'vitest';

import {
  classifyStudioApiError,
  StudioApiError,
} from '../src/features/studio-session/studio-api-error';

describe('Studio API error recovery', () => {
  it.each([
    [401, '登入已失效', false],
    [403, '沒有這項操作權限', false],
    [409, '資料已被更新', true],
    [429, '操作太頻繁', true],
    [503, '服務暫時無法使用', true],
  ] as const)('maps HTTP %s to safe Traditional Chinese UI', (status, message, recoverable) => {
    const error = classifyStudioApiError(status, 'provider_internal_detail');
    expect(error.message).toContain(message);
    expect(error.recoverable).toBe(recoverable);
    expect(error.message).not.toContain('provider_internal_detail');
  });

  it('treats a network failure as recoverable without inventing a provider response', () => {
    const error = new StudioApiError(0, 'network_failure', true);
    expect(error.recoverable).toBe(true);
    expect(error.message).toContain('目前無法完成操作');
  });
});
