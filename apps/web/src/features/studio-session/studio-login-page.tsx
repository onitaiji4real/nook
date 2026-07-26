'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useStudioSession } from './studio-session-provider';

export function StudioLoginPage() {
  const { status, message, startLineLogin } = useStudioSession();
  const [rememberDevice, setRememberDevice] = useState(false);

  if (status === 'local-preview') {
    return (
      <main className="studio-gate">
        <p className="studio-eyebrow">LOCAL PREVIEW</p>
        <h1>畫面可以操作，資料還不會離開這台瀏覽器。</h1>
        <p>目前未啟用LINE／Firebase正式登入。你仍可驗收所有工作台的互動與手機版面。</p>
        <Link className="studio-dark-action" href="/studio">
          進入預覽工作台
        </Link>
      </main>
    );
  }

  if (status === 'ready' || status === 'tenant-required') {
    return (
      <main className="studio-gate">
        <p className="studio-eyebrow">SIGNED IN</p>
        <h1>登入完成。</h1>
        <Link className="studio-dark-action" href="/studio">
          前往工作台
        </Link>
      </main>
    );
  }

  const busy = ['config-loading', 'signing-in', 'account-loading'].includes(status);
  return (
    <main className="studio-gate">
      <p className="studio-eyebrow">SECURE STUDIO ACCESS</p>
      <h1>讓店務留在同一個地方。</h1>
      <p>
        使用LINE確認帳號後，由Firebase維持安全session。Nook不會把登入token放進網址、表單或自行保存到Web
        Storage。
      </p>
      <label className="studio-trust-device">
        <input
          checked={rememberDevice}
          disabled={busy}
          onChange={(event) => setRememberDevice(event.target.checked)}
          type="checkbox"
        />
        <span>
          <strong>信任這台裝置</strong>
          <small>共用電腦請勿勾選；預設在關閉分頁後結束登入。</small>
        </span>
      </label>
      <button
        className="studio-line-action"
        disabled={busy || status === 'not-configured'}
        onClick={() => void startLineLogin(rememberDevice)}
        type="button"
      >
        {busy ? '正在安全連線…' : '使用 LINE 登入'}
      </button>
      {message === null ? null : (
        <p className="studio-gate-message" role="alert">
          {message}
        </p>
      )}
      <p className="studio-privacy-note">繼續即表示你同意只將帳號識別用於店務存取與權限驗證。</p>
    </main>
  );
}
