export type LineLoginResult =
  | { readonly status: 'signed-out' }
  | { readonly status: 'redirecting' }
  | { readonly status: 'token'; readonly idToken: string; readonly nonce: string };

export async function obtainLineIdentity(input: {
  readonly liffId: string;
  readonly startLogin: boolean;
  readonly redirectUri?: string;
}): Promise<LineLoginResult> {
  const { default: liff } = await import('@line/liff');
  await liff.init({ liffId: input.liffId });

  if (!liff.isLoggedIn()) {
    if (!input.startLogin) {
      return { status: 'signed-out' };
    }
    liff.login({ redirectUri: input.redirectUri ?? `${window.location.origin}/studio/login` });
    return { status: 'redirecting' };
  }

  const idToken = liff.getIDToken();
  const nonce = liff.getDecodedIDToken()?.nonce;
  if (idToken === null || typeof nonce !== 'string' || nonce.length < 16) {
    throw new Error('LINE did not return a verifiable identity token.');
  }
  return { status: 'token', idToken, nonce };
}

export async function signOutLine(): Promise<void> {
  const { default: liff } = await import('@line/liff');
  if (liff.isLoggedIn()) {
    liff.logout();
  }
}
