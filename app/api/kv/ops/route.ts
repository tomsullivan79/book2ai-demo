// app/api/kv/ops/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { kv, hasKV } from "@/lib/kv";

function auth(req: NextRequest) {
  const url = new URL(req.url);
  const qp = url.searchParams.get("token");
  const hdr = req.headers.get("x-cron-secret");
  const env = process.env.CRON_SECRET;
  return !!env && (qp === env || hdr === env);
}

function safeParse<T = unknown>(val: unknown): { value: T | null; parsed: boolean } {
  if (typeof val === "string") {
    try {
      return { value: JSON.parse(val) as T, parsed: true };
    } catch {
      return { value: null, parsed: false };
    }
  }
  // already an object (or null)
  return { value: (val as T) ?? null, parsed: false };
}

export async function GET(req: NextRequest) {
  try {
    if (!hasKV) return NextResponse.json({ ok: false, error: "no_kv" }, { status: 200 });
    if (!auth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const op = (url.searchParams.get("op") || "llen").toLowerCase();
    const n = Math.min(10, Math.max(1, Number(url.searchParams.get("n") || 5)));

    if (op === "llen") {
      const llen = await kv.llen("b2ai:recent");
      return NextResponse.json({ ok: true, op, llen });
    }

    if (op === "lrange") {
      const raws = await kv.lrange("b2ai:recent", 0, n - 1);
      const items = (raws as unknown[]).map((raw) => {
        const { value, parsed } = safeParse(raw);
        return {
          rawType: typeof raw,
          parsed,
          preview:
            typeof value === "object" && value
              ? Object.assign({}, value as Record<string, unknown>, { _trunc: true })
              : (value ?? String(raw)).toString().slice(0, 200),
        };
      });
      return NextResponse.json({ ok: true, op, count: items.length, items });
    }

    if (op === "lpop") {
      const raw = (await kv.lpop("b2ai:recent")) as unknown;
      const { value, parsed } = safeParse(raw);
      const llen = await kv.llen("b2ai:recent");
      return NextResponse.json({
        ok: true,
        op,
        popped: !!raw,
        rawType: typeof raw,
        parsed,
        item: value, // may be object or null if unparsable string
        llen,
      });
    }

    if (op === "lpush-debug") {
      const val = {
        ts: new Date().toISOString(),
        q: "ops:lpush-debug",
        top: [{ id: "debug", page: "p.debug" }],
        answer_len: 0,
      };
      await kv.lpush("b2ai:recent", JSON.stringify(val));
      const llen = await kv.llen("b2ai:recent");
      return NextResponse.json({ ok: true, op, llen });
    }

    return NextResponse.json({ ok: false, error: `unknown op: ${op}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
