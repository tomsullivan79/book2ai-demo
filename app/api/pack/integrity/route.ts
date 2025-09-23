import { NextResponse } from 'next/server';
import { buildIntegrityReport } from '@/lib/pack';

export async function GET() {
  try {
    const report = await buildIntegrityReport();
    return NextResponse.json(report, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
