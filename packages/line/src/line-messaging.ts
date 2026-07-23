export type LinePushOutcome =
  | { readonly kind: 'accepted'; readonly httpStatus: 200; readonly requestId?: string }
  | { readonly kind: 'replayed'; readonly httpStatus: 409; readonly requestId?: string }
  | {
      readonly kind: 'retryable';
      readonly httpStatus?: number;
      readonly code: 'line_retryable_response' | 'line_timeout' | 'line_network_error';
      readonly requestId?: string;
    }
  | {
      readonly kind: 'terminal';
      readonly httpStatus: number;
      readonly code: 'line_terminal_response' | 'line_protocol_response';
      readonly requestId?: string;
    };

interface LinePushResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
}

export type LinePushFetch = (
  input: string,
  init: {
    readonly method: 'POST';
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly redirect: 'error';
    readonly signal: AbortSignal;
  },
) => Promise<LinePushResponse>;

export interface LinePushClientOptions {
  readonly accessToken: string;
  readonly timeoutMs?: number;
  readonly fetch?: LinePushFetch;
}

export class LinePushClient {
  private readonly timeoutMs: number;
  private readonly fetcher: LinePushFetch;

  constructor(private readonly options: LinePushClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetcher = options.fetch ?? (fetch as LinePushFetch);
  }

  async send(input: {
    readonly recipient: string;
    readonly retryKey: string;
    readonly text: string;
  }): Promise<LinePushOutcome> {
    try {
      const response = await this.fetcher('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.accessToken}`,
          'content-type': 'application/json',
          'x-line-retry-key': input.retryKey,
        },
        body: JSON.stringify({
          to: input.recipient,
          messages: [{ type: 'text', text: input.text }],
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const requestId = safeRequestId(response.headers.get('x-line-request-id'));
      if (response.status === 200) return withRequestId({ kind: 'accepted', httpStatus: 200 }, requestId);
      if (response.status === 409) return withRequestId({ kind: 'replayed', httpStatus: 409 }, requestId);
      if ([408, 425, 429].includes(response.status) || response.status >= 500) {
        return withRequestId(
          { kind: 'retryable', httpStatus: response.status, code: 'line_retryable_response' },
          requestId,
        );
      }
      return withRequestId(
        {
          kind: 'terminal',
          httpStatus: response.status,
          code:
            response.status >= 400 && response.status < 500
              ? 'line_terminal_response'
              : 'line_protocol_response',
        },
        requestId,
      );
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        return { kind: 'retryable', code: 'line_timeout' };
      }
      return { kind: 'retryable', code: 'line_network_error' };
    }
  }
}

function safeRequestId(value: string | null): string | undefined {
  return value !== null && /^[A-Za-z0-9._:-]{1,128}$/u.test(value) ? value : undefined;
}

function withRequestId<T extends LinePushOutcome>(value: T, requestId: string | undefined): T {
  return requestId === undefined ? value : { ...value, requestId };
}
