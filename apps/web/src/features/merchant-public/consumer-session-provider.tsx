'use client';

import {
  browserRuntimeConfigResponseSchema,
  type BrowserRuntimeConfigResponse,
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

import { createFirebaseSession, type FirebaseSession } from '../studio-session/firebase-session';
import { obtainLineIdentity, signOutLine } from '../studio-session/line-login';
import { classifyStudioApiError, StudioApiError } from '../studio-session/studio-api-error';

export type ConsumerSessionStatus =
  | 'config-loading'
  | 'local-preview'
  | 'signed-out'
  | 'signing-in'
  | 'ready'
  | 'degraded'
  | 'not-configured';

interface ConsumerSessionValue {
  readonly status: ConsumerSessionStatus;
  readonly message: string | null;
  readonly startLineLogin: () => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly request: <T>(path: string, init?: RequestInit) => Promise<T>;
}

const ConsumerSessionContext = createContext<ConsumerSessionValue | undefined>(undefined);

export function ConsumerSessionProvider({
  children,
  preview,
}: {
  readonly children: ReactNode;
  readonly preview: boolean;
}) {
  const [runtimeConfig, setRuntimeConfig] = useState<BrowserRuntimeConfigResponse | null>(null);
  const [status, setStatus] = useState<ConsumerSessionStatus>(
    preview ? 'local-preview' : 'config-loading',
  );
  const [message, setMessage] = useState<string | null>(null);
  const session = useRef<FirebaseSession | null>(null);

  useEffect(() => {
    if (preview) return;
    let active = true;
    void fetch('/api/runtime-config', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Runtime configuration is unavailable.');
        return browserRuntimeConfigResponseSchema.parse(await response.json());
      })
      .then((config) => {
        if (!active) return;
        setRuntimeConfig(config);
        if (config.mode === 'disabled') {
          setStatus('local-preview');
          return;
        }
        const firebase = createFirebaseSession(config.firebase);
        session.current = firebase;
        firebase.subscribe((signedIn) => {
          if (!active) return;
          setStatus(signedIn ? 'ready' : 'signed-out');
          setMessage(null);
        });
      })
      .catch(() => {
        if (!active) return;
        setStatus('not-configured');
        setMessage('正式LINE登入尚未設定完成，目前不能保留時段。');
      });
    return () => {
      active = false;
    };
  }, [preview]);

  const startLineLogin = useCallback(async () => {
    if (runtimeConfig?.mode !== 'firebase-line' || session.current === null) return;
    setStatus('signing-in');
    setMessage(null);
    try {
      const identity = await obtainLineIdentity({
        liffId: runtimeConfig.liffId,
        startLogin: true,
        redirectUri: `${window.location.origin}${window.location.pathname}`,
      });
      if (identity.status === 'redirecting') return;
      if (identity.status === 'signed-out') {
        setStatus('signed-out');
        return;
      }
      const response = await fetch(`${runtimeConfig.apiBaseUrl}/v1/auth/line/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: identity.idToken, nonce: identity.nonce }),
      });
      if (!response.ok)
        throw classifyStudioApiError(response.status, await readProblemCode(response));
      const payload: unknown = await response.json();
      if (!isCustomTokenResponse(payload)) throw new Error('Invalid identity exchange response.');
      await session.current.signIn(payload.customToken, false);
      setStatus('ready');
    } catch (error) {
      setStatus('signed-out');
      setMessage(toSafeMessage(error));
    }
  }, [runtimeConfig]);

  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (runtimeConfig?.mode !== 'firebase-line' || session.current === null) {
        throw new StudioApiError(503, 'browser_auth_unavailable', true);
      }
      try {
        const idToken = await session.current.getIdToken();
        const response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, {
          ...init,
          headers: { ...init?.headers, Authorization: `Bearer ${idToken}` },
        });
        if (!response.ok) {
          throw classifyStudioApiError(response.status, await readProblemCode(response));
        }
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      } catch (error) {
        if (error instanceof StudioApiError) {
          if (error.status === 401) setStatus('signed-out');
          if (error.status === 503) setStatus('degraded');
          setMessage(toSafeMessage(error));
          throw error;
        }
        throw new StudioApiError(0, 'network_failure', true);
      }
    },
    [runtimeConfig],
  );

  const signOut = useCallback(async () => {
    if (session.current !== null) await session.current.signOut();
    await signOutLine();
    setStatus(runtimeConfig?.mode === 'disabled' ? 'local-preview' : 'signed-out');
  }, [runtimeConfig]);

  const value = useMemo(
    () => ({ status, message, startLineLogin, signOut, request }),
    [message, request, signOut, startLineLogin, status],
  );
  return (
    <ConsumerSessionContext.Provider value={value}>{children}</ConsumerSessionContext.Provider>
  );
}

export function useConsumerSession(): ConsumerSessionValue {
  const value = useContext(ConsumerSessionContext);
  if (value === undefined) throw new Error('ConsumerSessionProvider is required.');
  return value;
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
    // Client messages are selected from status and safe problem codes only.
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

function toSafeMessage(error: unknown): string {
  return error instanceof StudioApiError ? error.message : '目前無法完成LINE登入，請稍後再試。';
}
