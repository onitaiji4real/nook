'use client';

import {
  browserRuntimeConfigResponseSchema,
  type BrowserRuntimeConfigResponse,
  type CreateTenantRequest,
  type MeResponse,
  type TenantResponse,
} from '@nook/contracts';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { createFirebaseSession, type FirebaseSession } from './firebase-session';
import {
  clearRememberLogin,
  clearSelectedTenantId,
  readRememberLogin,
  readSelectedTenantId,
  writeRememberLogin,
  writeSelectedTenantId,
} from './browser-session-storage';
import { obtainLineIdentity, signOutLine } from './line-login';
import { classifyStudioApiError, StudioApiError } from './studio-api-error';

export type StudioSessionStatus =
  | 'config-loading'
  | 'local-preview'
  | 'signed-out'
  | 'signing-in'
  | 'account-loading'
  | 'tenant-required'
  | 'ready'
  | 'degraded'
  | 'not-configured';

export type StudioMembership = MeResponse['memberships'][number];

interface StudioSessionContextValue {
  readonly status: StudioSessionStatus;
  readonly capabilities: BrowserRuntimeConfigResponse['capabilities'];
  readonly memberships: MeResponse['memberships'];
  readonly selectedMembership: StudioMembership | null;
  readonly message: string | null;
  readonly startLineLogin: (rememberDevice: boolean) => Promise<void>;
  readonly resumeLineLogin: () => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly selectTenant: (tenantId: string) => void;
  readonly createTenant: (input: CreateTenantRequest) => Promise<TenantResponse>;
  readonly request: <T>(path: string, init?: RequestInit) => Promise<T>;
  readonly retryAccount: () => Promise<void>;
}

const StudioSessionContext = createContext<StudioSessionContextValue | undefined>(undefined);

const previewSessionValue: StudioSessionContextValue = {
  status: 'local-preview',
  capabilities: { bookingPolicyV2Writes: true, appointmentLifecycle: true },
  memberships: [],
  selectedMembership: null,
  message: null,
  startLineLogin: () => Promise.resolve(),
  resumeLineLogin: () => Promise.resolve(),
  signOut: () => Promise.resolve(),
  selectTenant: () => undefined,
  createTenant: () => Promise.reject(new StudioApiError(503, 'local_preview_only', true)),
  request: <T,>() => Promise.reject<T>(new StudioApiError(503, 'local_preview_only', true)),
  retryAccount: () => Promise.resolve(),
};

export function StudioPreviewSessionProvider({ children }: { readonly children: ReactNode }) {
  return (
    <StudioSessionContext.Provider value={previewSessionValue}>
      {children}
    </StudioSessionContext.Provider>
  );
}

export function StudioSessionProvider({ children }: { readonly children: ReactNode }) {
  const [runtimeConfig, setRuntimeConfig] = useState<BrowserRuntimeConfigResponse | null>(null);
  const [status, setStatus] = useState<StudioSessionStatus>('config-loading');
  const [memberships, setMemberships] = useState<MeResponse['memberships']>([]);
  const [selectedMembership, setSelectedMembership] = useState<StudioMembership | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const firebaseSession = useRef<FirebaseSession | null>(null);

  useEffect(() => {
    let active = true;
    void fetch('/api/runtime-config', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Runtime configuration is unavailable.');
        }
        return browserRuntimeConfigResponseSchema.parse(await response.json());
      })
      .then((config) => {
        if (!active) return;
        setRuntimeConfig(config);
        if (config.mode === 'disabled') {
          setStatus('local-preview');
          return;
        }

        const session = createFirebaseSession(config.firebase);
        firebaseSession.current = session;
        session.subscribe((signedIn) => {
          if (!active) return;
          if (!signedIn) {
            setMemberships([]);
            setSelectedMembership(null);
            setStatus('signed-out');
            return;
          }
          void loadAccount(session, config);
        });
      })
      .catch(() => {
        if (!active) return;
        setStatus('not-configured');
        setMessage('正式登入設定尚未完成。請依設定手冊補齊後再重試。');
      });

    return () => {
      active = false;
    };
  }, []);

  const applyMe = useCallback((me: MeResponse) => {
    const activeMemberships = me.memberships.filter(
      (membership) => membership.status === 'ACTIVE' && membership.tenantStatus === 'ACTIVE',
    );
    setMemberships(activeMemberships);
    const savedTenantId = readSelectedTenantId();
    const selected =
      activeMemberships.find((membership) => membership.tenantId === savedTenantId) ??
      (activeMemberships.length === 1 ? activeMemberships[0] : undefined);
    setSelectedMembership(selected ?? null);
    if (selected !== undefined) {
      writeSelectedTenantId(selected.tenantId);
      setStatus('ready');
    } else {
      setStatus('tenant-required');
    }
    setMessage(null);
  }, []);

  const loadAccount = useCallback(
    async (session: FirebaseSession, config: BrowserRuntimeConfigResponse) => {
      if (config.mode !== 'firebase-line') return;
      setStatus('account-loading');
      try {
        const me = await authorizedRequest<MeResponse>(session, config, '/v1/me');
        applyMe(me);
      } catch (error) {
        if (error instanceof StudioApiError && error.status === 401) {
          await session.signOut();
          setStatus('signed-out');
          setMessage(error.message);
          return;
        }
        setStatus('degraded');
        setMessage(toSafeClientMessage(error));
      }
    },
    [applyMe],
  );

  const exchangeLineIdentity = useCallback(
    async (startLogin: boolean, rememberDevice: boolean) => {
      if (runtimeConfig?.mode !== 'firebase-line' || firebaseSession.current === null) return;
      setStatus('signing-in');
      setMessage(null);
      try {
        const identity = await obtainLineIdentity({ liffId: runtimeConfig.liffId, startLogin });
        if (identity.status === 'signed-out') {
          setStatus('signed-out');
          return;
        }
        if (identity.status === 'redirecting') return;

        const response = await fetch(`${runtimeConfig.apiBaseUrl}/v1/auth/line/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: identity.idToken, nonce: identity.nonce }),
        });
        if (!response.ok) {
          throw classifyStudioApiError(response.status, await readProblemCode(response));
        }
        const payload: unknown = await response.json();
        if (!isCustomTokenResponse(payload)) {
          throw new Error('Identity exchange returned an invalid response.');
        }
        await firebaseSession.current.signIn(payload.customToken, rememberDevice);
        clearRememberLogin();
      } catch (error) {
        setStatus('signed-out');
        setMessage(toSafeClientMessage(error));
      }
    },
    [runtimeConfig],
  );

  const startLineLogin = useCallback(
    async (rememberDevice: boolean) => {
      writeRememberLogin(rememberDevice);
      await exchangeLineIdentity(true, rememberDevice);
    },
    [exchangeLineIdentity],
  );

  const resumeLineLogin = useCallback(async () => {
    if (status !== 'signed-out') return;
    const rememberDevice = readRememberLogin();
    await exchangeLineIdentity(false, rememberDevice);
  }, [exchangeLineIdentity, status]);

  const signOut = useCallback(async () => {
    clearSelectedTenantId();
    clearRememberLogin();
    setMemberships([]);
    setSelectedMembership(null);
    if (firebaseSession.current !== null) await firebaseSession.current.signOut();
    await signOutLine();
    setStatus(runtimeConfig?.mode === 'disabled' ? 'local-preview' : 'signed-out');
  }, [runtimeConfig]);

  const selectTenant = useCallback(
    (tenantId: string) => {
      const selected = memberships.find((membership) => membership.tenantId === tenantId);
      if (selected === undefined) return;
      writeSelectedTenantId(selected.tenantId);
      setSelectedMembership(selected);
      setStatus('ready');
      setMessage(null);
    },
    [memberships],
  );

  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (runtimeConfig?.mode !== 'firebase-line' || firebaseSession.current === null) {
        throw new StudioApiError(503, 'browser_auth_unavailable', true);
      }
      try {
        return await authorizedRequest<T>(firebaseSession.current, runtimeConfig, path, init);
      } catch (error) {
        if (error instanceof StudioApiError && error.status === 401) {
          await firebaseSession.current.signOut();
          setStatus('signed-out');
        } else if (error instanceof StudioApiError && error.status === 503) {
          setStatus('degraded');
        }
        setMessage(toSafeClientMessage(error));
        throw error;
      }
    },
    [runtimeConfig],
  );

  const createTenant = useCallback(
    async (input: CreateTenantRequest): Promise<TenantResponse> => {
      const tenant = await request<TenantResponse>('/v1/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const session = firebaseSession.current;
      if (runtimeConfig?.mode === 'firebase-line' && session !== null) {
        await loadAccount(session, runtimeConfig);
      }
      return tenant;
    },
    [loadAccount, request, runtimeConfig],
  );

  const retryAccount = useCallback(async () => {
    if (runtimeConfig?.mode === 'firebase-line' && firebaseSession.current !== null) {
      await loadAccount(firebaseSession.current, runtimeConfig);
    }
  }, [loadAccount, runtimeConfig]);

  const value = useMemo<StudioSessionContextValue>(
    () => ({
      status,
      capabilities: runtimeConfig?.capabilities ?? {
        bookingPolicyV2Writes: false,
        appointmentLifecycle: false,
      },
      memberships,
      selectedMembership,
      message,
      startLineLogin,
      resumeLineLogin,
      signOut,
      selectTenant,
      createTenant,
      request,
      retryAccount,
    }),
    [
      createTenant,
      memberships,
      message,
      request,
      runtimeConfig?.capabilities,
      resumeLineLogin,
      retryAccount,
      selectTenant,
      selectedMembership,
      signOut,
      startLineLogin,
      status,
    ],
  );

  return <StudioSessionContext.Provider value={value}>{children}</StudioSessionContext.Provider>;
}

export function useStudioSession(): StudioSessionContextValue {
  const context = useContext(StudioSessionContext);
  if (context === undefined) {
    throw new Error('useStudioSession must be used inside StudioSessionProvider.');
  }
  return context;
}

async function authorizedRequest<T>(
  session: FirebaseSession,
  config: Extract<BrowserRuntimeConfigResponse, { mode: 'firebase-line' }>,
  path: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    const idToken = await session.getIdToken();
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${idToken}` },
    });
  } catch (error) {
    if (error instanceof StudioApiError) throw error;
    throw new StudioApiError(0, 'network_failure', true);
  }
  if (!response.ok) {
    throw classifyStudioApiError(response.status, await readProblemCode(response));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function readProblemCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      typeof body.code === 'string'
    ) {
      return body.code;
    }
  } catch {
    // The safe UI is based on status; malformed provider details are intentionally ignored.
  }
  return 'request_failed';
}

function isCustomTokenResponse(value: unknown): value is { readonly customToken: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'customToken' in value &&
    typeof value.customToken === 'string' &&
    value.customToken.length > 0
  );
}

function toSafeClientMessage(error: unknown): string {
  if (error instanceof StudioApiError) return error.message;
  return '目前無法完成登入或讀取資料，請稍後再試。';
}
