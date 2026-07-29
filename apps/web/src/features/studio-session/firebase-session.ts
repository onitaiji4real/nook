import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  getAuth,
  initializeAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithCustomToken,
  signOut,
  type Auth,
} from 'firebase/auth';

import {
  readPersistentAuthPreference,
  writePersistentAuthPreference,
} from './browser-session-storage';

const firebaseAppName = 'nook-browser';

export interface FirebaseSession {
  readonly hasCurrentUser: () => boolean;
  readonly subscribe: (listener: (signedIn: boolean) => void) => () => void;
  readonly signIn: (customToken: string, rememberDevice: boolean) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly getIdToken: () => Promise<string>;
}

export function createFirebaseSession(options: FirebaseOptions): FirebaseSession {
  const app = getApps().some((candidate) => candidate.name === firebaseAppName)
    ? getApp(firebaseAppName)
    : initializeApp(options, firebaseAppName);
  const initialPersistence = readPersistentAuthPreference()
    ? browserLocalPersistence
    : browserSessionPersistence;
  let auth: Auth;
  try {
    auth = initializeAuth(app, { persistence: initialPersistence });
  } catch (error) {
    if (!isAlreadyInitializedError(error)) {
      throw error;
    }
    auth = getAuth(app);
  }

  return {
    hasCurrentUser: () => auth.currentUser !== null,
    subscribe: (listener) => onAuthStateChanged(auth, (user) => listener(user !== null)),
    signIn: async (customToken, rememberDevice) => {
      await setPersistence(
        auth,
        rememberDevice ? browserLocalPersistence : browserSessionPersistence,
      );
      writePersistentAuthPreference(rememberDevice);
      await signInWithCustomToken(auth, customToken);
    },
    signOut: async () => {
      writePersistentAuthPreference(false);
      await signOut(auth);
    },
    getIdToken: async () => {
      if (auth.currentUser === null) {
        throw new Error('Firebase session is signed out.');
      }
      return auth.currentUser.getIdToken();
    },
  };
}

function isAlreadyInitializedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'auth/already-initialized'
  );
}
