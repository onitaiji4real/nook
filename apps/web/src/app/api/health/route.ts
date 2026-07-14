import { createHealthResponse } from '@nook/contracts';
import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json(
    createHealthResponse({
      status: 'ok',
      service: 'web',
      version: process.env.APP_VERSION ?? 'dev',
    }),
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
