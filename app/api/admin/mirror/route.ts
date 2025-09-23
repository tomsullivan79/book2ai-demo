import { NextResponse } from 'next/server';

function getBaseUrl() {
  // Prefer explicit base, then Vercel URL, then local dev
  const explicit = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, '');
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}

export async function POST() {
  const token = process.env.CRON_SECRET;
  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET not set on server' },
      { status: 500 }
    );
  }

  const base = getBaseUrl();
  const url = `${base}/api/cron/mirror?token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    return NextResponse.json(
      { ok: res.ok, status: res.status, result: json },
      { status: res.ok ? 200 : res.status }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message || 'mirror fetch failed' },
      { status: 500 }
    );
  }
}
