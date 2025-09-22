// app/api/kv/health/route.ts
import { NextResponse } from "next/server";
import { kv, hasKV } from "@/lib/kv";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (!hasKV) {
      return NextResponse.json({ ok: false, hasKV: false, reason: "missing env vars" }, { status: 200 });
    }
    const pongKey = "b2ai:health:pong";
    await kv.set(pongKey, Date.now(), { ex: 60 });
    const value = await kv.get<number>(pongKey);
    return NextResponse.json({ ok: true, hasKV: true, value }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, hasKV: true, error: String(e) }, { status: 500 });
  }
}
