// app/api/pack/integrity/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { verifyPack } from '@/lib/pack';

export async function GET() {
  try {
    const report = await verifyPack();
    return NextResponse.json(report, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: 'integrity_error', detail: String(e) }, { status: 500 });
  }
}
