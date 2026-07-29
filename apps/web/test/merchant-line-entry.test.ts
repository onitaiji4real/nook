import { describe, expect, it, vi } from 'vitest';

import {
  initializeMerchantLineEntry,
  removeOrdinaryRouteParameter,
} from '../src/features/studio-session/merchant-line-entry';

function createClient(input?: {
  readonly inClient?: boolean;
  readonly loggedIn?: boolean;
  readonly events?: string[];
}) {
  const events = input?.events ?? [];
  return {
    init: vi.fn(() => {
      events.push('init');
      return Promise.resolve();
    }),
    isInClient: vi.fn(() => input?.inClient ?? false),
    isLoggedIn: vi.fn(() => input?.loggedIn ?? true),
    login: vi.fn(() => {
      events.push('login');
    }),
    getIDToken: vi.fn(() => 'synthetic-id-token'),
    getDecodedIDToken: vi.fn(() => ({ nonce: '1234567890abcdef' })),
  };
}

describe('merchant LINE entry sequence', () => {
  it('initializes before reading or cleaning the URL in a LIFF browser', async () => {
    const events: string[] = [];
    const client = createClient({ inClient: true, loggedIn: true, events });
    const result = await initializeMerchantLineEntry({
      liffId: 'synthetic-liff-id',
      client,
      currentUrl: () => {
        events.push('read-url');
        return 'https://studio.example/line/studio?route=appointments&liff.state=preserve';
      },
      replaceUrl: (url) => {
        events.push(`replace:${url}`);
      },
    });

    expect(result).toMatchObject({
      status: 'identity',
      routeKey: 'appointments',
      environment: 'liff',
    });
    expect(events).toEqual([
      'init',
      'read-url',
      'replace:https://studio.example/line/studio?liff.state=preserve',
    ]);
    expect(client.login).not.toHaveBeenCalled();
  });

  it('starts official external login with a canonical same-origin redirect', async () => {
    const events: string[] = [];
    const client = createClient({ loggedIn: false, events });
    const result = await initializeMerchantLineEntry({
      liffId: 'synthetic-liff-id',
      client,
      currentUrl: () => {
        events.push('read-url');
        return 'https://studio.example/line/studio?route=services&tenantId=other&returnUrl=https://evil.example';
      },
      replaceUrl: () => {
        events.push('replace');
      },
    });

    expect(result).toEqual({ status: 'redirecting', routeKey: 'services' });
    expect(events).toEqual(['init', 'read-url', 'login']);
    expect(client.login).toHaveBeenCalledWith({
      redirectUri: 'https://studio.example/line/studio?route=services',
    });
  });

  it('initializes again after the external login redirect before reading the restored route', async () => {
    const events: string[] = [];
    let loggedIn = false;
    const client = createClient({ events });
    client.isLoggedIn.mockImplementation(() => loggedIn);
    const currentUrl = vi
      .fn<() => string>()
      .mockReturnValue('https://studio.example/line/studio?route=availability');

    const first = await initializeMerchantLineEntry({
      liffId: 'synthetic-liff-id',
      client,
      currentUrl,
      replaceUrl: () => undefined,
    });
    loggedIn = true;
    const second = await initializeMerchantLineEntry({
      liffId: 'synthetic-liff-id',
      client,
      currentUrl,
      replaceUrl: () => undefined,
    });

    expect(first).toEqual({ status: 'redirecting', routeKey: 'availability' });
    expect(second).toMatchObject({ status: 'identity', routeKey: 'availability' });
    expect(client.init).toHaveBeenCalledTimes(2);
    expect(currentUrl).toHaveBeenCalledTimes(2);
  });

  it('does not call liff.login inside the LIFF browser after authorization is cancelled', async () => {
    const client = createClient({ inClient: true, loggedIn: false });
    const result = await initializeMerchantLineEntry({
      liffId: 'synthetic-liff-id',
      client,
      currentUrl: () => 'https://studio.example/line/studio?route=portfolio',
      replaceUrl: () => undefined,
    });

    expect(result).toEqual({ status: 'authorization-missing', routeKey: 'portfolio' });
    expect(client.login).not.toHaveBeenCalled();
  });

  it('falls manipulated routes back to home without carrying attacker input', async () => {
    const client = createClient({ loggedIn: false });
    const result = await initializeMerchantLineEntry({
      liffId: 'synthetic-liff-id',
      client,
      currentUrl: () =>
        'https://studio.example/line/studio?route=https%3A%2F%2Fevil.example%2Fsteal',
      replaceUrl: () => undefined,
    });

    expect(result).toEqual({ status: 'redirecting', routeKey: 'home' });
    expect(client.login).toHaveBeenCalledWith({
      redirectUri: 'https://studio.example/line/studio?route=home',
    });
  });

  it('preserves LIFF-reserved parameters while removing only ordinary route', () => {
    const cleaned = removeOrdinaryRouteParameter(
      'https://studio.example/line/studio?route=policies&liff.state=abc&liff.referrer=def&lineAppVersion=15',
    );
    const url = new URL(cleaned);

    expect(url.searchParams.get('route')).toBeNull();
    expect(url.searchParams.get('liff.state')).toBe('abc');
    expect(url.searchParams.get('liff.referrer')).toBe('def');
    expect(url.searchParams.get('lineAppVersion')).toBe('15');
  });

  it('keeps parallel tab routes isolated to each initialized URL', async () => {
    const [appointments, policies] = await Promise.all([
      initializeMerchantLineEntry({
        liffId: 'synthetic-liff-id',
        client: createClient(),
        currentUrl: () => 'https://studio.example/line/studio?route=appointments',
        replaceUrl: () => undefined,
      }),
      initializeMerchantLineEntry({
        liffId: 'synthetic-liff-id',
        client: createClient(),
        currentUrl: () => 'https://studio.example/line/studio?route=policies',
        replaceUrl: () => undefined,
      }),
    ]);

    expect(appointments).toMatchObject({ routeKey: 'appointments' });
    expect(policies).toMatchObject({ routeKey: 'policies' });
  });
});
