const selectedTenantKey = 'nook.selectedTenantId';
const rememberLoginKey = 'nook.login.remember';
const persistencePreferenceKey = 'nook.auth.persistence';
const studioEntryNoticeKey = 'nook.studio.entryNotice';

export function readSelectedTenantId(): string | null {
  return window.sessionStorage.getItem(selectedTenantKey);
}

export function writeSelectedTenantId(tenantId: string): void {
  window.sessionStorage.setItem(selectedTenantKey, tenantId);
}

export function clearSelectedTenantId(): void {
  window.sessionStorage.removeItem(selectedTenantKey);
}

export function readRememberLogin(): boolean {
  return window.sessionStorage.getItem(rememberLoginKey) === 'true';
}

export function writeRememberLogin(rememberDevice: boolean): void {
  window.sessionStorage.setItem(rememberLoginKey, rememberDevice ? 'true' : 'false');
}

export function clearRememberLogin(): void {
  window.sessionStorage.removeItem(rememberLoginKey);
}

export function writeStudioEntryNotice(code: 'role_fallback'): void {
  window.sessionStorage.setItem(studioEntryNoticeKey, code);
}

export function consumeStudioEntryNotice(): 'role_fallback' | null {
  const value = window.sessionStorage.getItem(studioEntryNoticeKey);
  window.sessionStorage.removeItem(studioEntryNoticeKey);
  return value === 'role_fallback' ? value : null;
}

export function readPersistentAuthPreference(): boolean {
  return window.localStorage.getItem(persistencePreferenceKey) === 'local';
}

export function writePersistentAuthPreference(rememberDevice: boolean): void {
  if (rememberDevice) {
    window.localStorage.setItem(persistencePreferenceKey, 'local');
  } else {
    window.localStorage.removeItem(persistencePreferenceKey);
  }
}
