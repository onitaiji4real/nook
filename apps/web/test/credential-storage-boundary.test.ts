import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), 'src/features/studio-session', relativePath), 'utf8');
const merchantSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), 'src/features/merchant-public', relativePath), 'utf8');

describe('browser credential storage boundary', () => {
  it.each(['firebase-session.ts', 'line-login.ts', 'studio-session-provider.tsx'])(
    'keeps direct Web Storage access out of credential-handling module %s',
    (file) => {
      const contents = source(file);
      expect(contents).not.toMatch(/localStorage|sessionStorage/);
      expect(contents).not.toMatch(/console\.|URLSearchParams|searchParams/);
    },
  );

  it('keeps consumer credentials out of storage, URLs, and console sinks', () => {
    const contents = merchantSource('consumer-session-provider.tsx');
    expect(contents).not.toMatch(
      /localStorage|sessionStorage|console\.|URLSearchParams|searchParams/,
    );
    expect(contents).not.toMatch(/idToken.*(?:storage|query)|customToken.*(?:storage|query)/i);
  });

  it('allowlists only non-credential preferences in the storage adapter', () => {
    const contents = source('browser-session-storage.ts');
    expect(contents.match(/nook\.[A-Za-z.]+/g)?.sort()).toEqual([
      'nook.auth.persistence',
      'nook.login.remember',
      'nook.selectedTenantId',
    ]);
    expect(contents).not.toMatch(
      /idToken|customToken|accessToken|refreshToken|profile|email|phone/i,
    );
  });
});
