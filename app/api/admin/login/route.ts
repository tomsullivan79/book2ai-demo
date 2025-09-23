import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  const expected = process.env.ADMIN_TOKEN || '';

  if (!expected) {
    return NextResponse.json({ error: 'ADMIN_TOKEN not configured' }, { status: 500 });
  }
  if (!token || token !== expected) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  // Cookie value ties to current ADMIN_TOKEN; change token → existing cookies invalidate
  res.cookies.set('b2ai_admin', `ok:${expected}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    // Session cookie (clears on browser close); tweak maxAge if preferred.
  });
  return res;
}
