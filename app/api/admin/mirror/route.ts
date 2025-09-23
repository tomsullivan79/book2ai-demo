import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

export async function POST() {
  const token = process.env.CRON_SECRET;
  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET not set on server' },
      { status: 500 }
    );
  }

  // Build absolute base from incoming request headers (reliable on Vercel)
  const h = headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  if (!host) {
    return NextResponse.json(
      { ok: false, error: 'Unable to resolve host from headers' },
      { status: 500 }
    );
  }
  const base = `${proto}://${host}`;
  const url = `${base}/api/cron/mirror?token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });

    // Read raw text first so we can return useful details even on non-JSON errors
    const raw = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }

    return NextResponse.json(
      { ok: res.ok, status: res.status, result: data },
      { status: res.ok ? 200 : res.status }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message || 'mirror fetch failed' },
      { status: 500 }
    );
  }
}
