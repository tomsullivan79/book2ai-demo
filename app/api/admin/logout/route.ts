import { NextResponse } from 'next/server';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('b2ai_admin', '', { path: '/', maxAge: 0 });
  return res;
}
