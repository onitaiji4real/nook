import {
  buildMerchantLineRedirectUrl,
  parseStudioRouteKey,
  type StudioRouteKey,
} from '@nook/contracts';

interface MerchantLiffClient {
  init(input: { readonly liffId: string }): Promise<unknown>;
  isInClient(): boolean;
  isLoggedIn(): boolean;
  login(input: { readonly redirectUri: string }): void;
  getIDToken(): string | null;
  getDecodedIDToken(): { readonly nonce?: unknown } | null;
}

export type MerchantLineEntryResult =
  | {
      readonly status: 'identity';
      readonly routeKey: StudioRouteKey;
      readonly idToken: string;
      readonly nonce: string;
      readonly environment: 'liff' | 'external';
    }
  | { readonly status: 'redirecting'; readonly routeKey: StudioRouteKey }
  | { readonly status: 'authorization-missing'; readonly routeKey: StudioRouteKey };

export async function initializeMerchantLineEntry(input: {
  readonly liffId: string;
  readonly currentUrl: () => string;
  readonly replaceUrl: (url: string) => void;
  readonly client?: MerchantLiffClient;
}): Promise<MerchantLineEntryResult> {
  const client = input.client ?? (await loadLiffClient());
  await client.init({ liffId: input.liffId });

  // Reading or changing the URL before init resolves can break LIFF's primary redirect.
  const currentUrl = input.currentUrl();
  const routeKey = parseRouteAfterInit(currentUrl);
  const redirectUri = buildMerchantLineRedirectUrl({ currentUrl, routeKey });
  const inLiffBrowser = client.isInClient();

  if (!client.isLoggedIn()) {
    if (inLiffBrowser) {
      return { status: 'authorization-missing', routeKey };
    }
    client.login({ redirectUri });
    return { status: 'redirecting', routeKey };
  }

  const idToken = client.getIDToken();
  const nonce = client.getDecodedIDToken()?.nonce;
  if (idToken === null || typeof nonce !== 'string' || nonce.length < 16) {
    throw new Error('LINE did not return a verifiable identity token.');
  }

  input.replaceUrl(removeOrdinaryRouteParameter(currentUrl));
  return {
    status: 'identity',
    routeKey,
    idToken,
    nonce,
    environment: inLiffBrowser ? 'liff' : 'external',
  };
}

export function parseRouteAfterInit(currentUrl: string): StudioRouteKey {
  return parseStudioRouteKey(new URL(currentUrl).searchParams.get('route'));
}

export function removeOrdinaryRouteParameter(currentUrl: string): string {
  const url = new URL(currentUrl);
  url.searchParams.delete('route');
  return url.toString();
}

async function loadLiffClient(): Promise<MerchantLiffClient> {
  const { default: liff } = await import('@line/liff');
  return liff;
}
