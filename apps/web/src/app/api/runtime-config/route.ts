import { NextResponse } from 'next/server';

import { buildBrowserRuntimeConfig } from '../../../lib/browser-runtime-config';

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  try {
    return NextResponse.json(buildBrowserRuntimeConfig(process.env), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Service Unavailable',
        status: 503,
        code: 'browser_auth_unavailable',
        detail: 'Browser authentication is not configured for this environment.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
