// app/api/insights/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getInsightsData } from '@/lib/insights';

export async function GET() {
  try {
    const data = await getInsightsData();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: 'insights_error', detail: String(e) },
      { status: 500 }
    );
  }
}
