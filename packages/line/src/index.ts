export interface VerifiedLineIdentity {
  readonly subject: string;
  readonly displayName?: string;
  readonly avatarUrl?: string;
}

export interface LineIdentityVerifier {
  verify(rawToken: string, expectedNonce: string): Promise<VerifiedLineIdentity>;
}

export type LineVerificationErrorCode =
  | 'invalid_token'
  | 'invalid_nonce'
  | 'provider_timeout'
  | 'provider_unavailable';

export class LineVerificationError extends Error {
  constructor(readonly code: LineVerificationErrorCode) {
    super(code);
    this.name = 'LineVerificationError';
  }
}

interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type LineFetch = (
  input: string,
  init: {
    readonly method: 'POST';
    readonly headers: Record<string, string>;
    readonly body: URLSearchParams;
    readonly signal: AbortSignal;
  },
) => Promise<FetchResponse>;

export interface LineIdTokenVerifierOptions {
  readonly channelId: string;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly fetch?: LineFetch;
}

export class LineIdTokenVerifier implements LineIdentityVerifier {
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly fetcher: LineFetch;

  constructor(private readonly options: LineIdTokenVerifierOptions) {
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.now = options.now ?? Date.now;
    this.fetcher = options.fetch ?? (fetch as LineFetch);
  }

  async verify(rawToken: string, expectedNonce: string): Promise<VerifiedLineIdentity> {
    try {
      const response = await this.fetcher('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          id_token: rawToken,
          client_id: this.options.channelId,
          nonce: expectedNonce,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        throw new LineVerificationError(
          response.status >= 500 ? 'provider_unavailable' : 'invalid_token',
        );
      }
      return this.parse(await response.json(), expectedNonce);
    } catch (error) {
      if (error instanceof LineVerificationError) throw error;
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new LineVerificationError('provider_timeout');
      }
      throw new LineVerificationError('provider_unavailable');
    }
  }

  private parse(payload: unknown, expectedNonce: string): VerifiedLineIdentity {
    if (payload === null || typeof payload !== 'object')
      throw new LineVerificationError('invalid_token');
    const value = payload as Record<string, unknown>;
    const nowSeconds = Math.floor(this.now() / 1_000);
    if (
      value.iss !== 'https://access.line.me' ||
      value.aud !== this.options.channelId ||
      typeof value.sub !== 'string' ||
      value.sub.length === 0 ||
      typeof value.exp !== 'number' ||
      value.exp <= nowSeconds
    ) {
      throw new LineVerificationError('invalid_token');
    }
    if (value.nonce !== expectedNonce) throw new LineVerificationError('invalid_nonce');
    return {
      subject: value.sub,
      ...(typeof value.name === 'string' ? { displayName: value.name.slice(0, 120) } : {}),
      ...(typeof value.picture === 'string' ? { avatarUrl: value.picture } : {}),
    };
  }
}
