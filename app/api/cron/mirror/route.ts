// app/api/cron/mirror/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { kv, hasKV } from "@/lib/kv";
import { getSupabaseAdmin } from "@/lib/supabase";

const BATCH = Number(process.env.MIRROR_BATCH_SIZE || 200);
const DRY = process.env.MIRROR_DRY_RUN === "1";

type RecentRec = {
  ts: string;
  q: string;
  top: { id: string; page: string }[];
  answer_len: number;
};

function isAuthorized(req: NextRequest): boolean {
  const url = new URL(req.url);
  const qpToken = url.searchParams.get("token");
  const hdrToken = req.headers.get("x-cron-secret");
  const vercelCron = req.headers.get("x-vercel-cron");
  const envToken = process.env.CRON_SECRET;
  if (vercelCron) return true;
  if (envToken && (qpToken === envToken || hdrToken === envToken)) return true;
  return false;
}

function safeParseRec(val: unknown): RecentRec | null {
  if (typeof val === "string") {
    try {
      return JSON.parse(val) as RecentRec;
    } catch {
      return null;
    }
  }
  // If it's already an object, try to coerce minimally
  if (val && typeof val === "object") {
    const anyVal = val as any;
    if (anyVal.ts && anyVal.q && anyVal.top && typeof anyVal.answer_len !== "undefined") {
      return anyVal as RecentRec;
    }
    return null;
  }
  return null;
}

async function drainRecent(max: number): Promise<{ recs: RecentRec[]; seen: number }> {
  const out: RecentRec[] = [];
  let seen = 0;
  for (let i = 0; i < max; i++) {
    const raw = (await kv.lpop("b2ai:recent")) as unknown;
    if (!raw) break;
    seen++;
    const rec = safeParseRec(raw);
    if (rec) out.push(rec);
    // if unparsable, we just drop it (or could push to a dead-letter later)
  }
  return { recs: out, seen };
}

async function putBack(recs: RecentRec[]) {
  if (!recs.length) return;
  for (let i = recs.length - 1; i >= 0; i--) {
    await kv.lpush("b2ai:recent", JSON.stringify(recs[i]));
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ ok: false, route: "mirror", error: "unauthorized" }, { status: 401 });
    }
    if (!hasKV) {
      return NextResponse.json({ ok: false, route: "mirror", error: "no_kv" }, { status: 200 });
    }

    const before = await kv.llen("b2ai:recent");

    const url = new URL(req.url);
    const debug = url.searchParams.get("debug");
    if (debug === "ping") {
      return NextResponse.json({ ok: true, route: "mirror", mode: "ping", llen: before, batch: BATCH, dry: DRY });
    }

    const { recs, seen } = await drainRecent(BATCH);

    if (DRY) {
      await putBack(recs);
      const afterDry = await kv.llen("b2ai:recent");
      return NextResponse.json({
        ok: true,
        route: "mirror",
        mode: "dry",
        seen,
        drained: recs.length,
        before,
        after: afterDry,
      });
    }

    if (recs.length === 0) {
      const afterNone = await kv.llen("b2ai:recent");
      return NextResponse.json({
        ok: true,
        route: "mirror",
        drained: 0,
        seen,
        before,
        after: afterNone,
      });
    }

    const supabase = getSupabaseAdmin();

    // insert log rows
    const { error: logErr } = await supabase
      .from("b2ai_query_log")
      .insert(
        recs.map((r) => ({
          ts: r.ts,
          q: r.q,
          answer_len: r.answer_len,
          top: r.top,
        }))
      );

    if (logErr) {
      await putBack(recs);
      const afterErr = await kv.llen("b2ai:recent");
      return NextResponse.json(
        { ok: false, route: "mirror", error: `log_insert: ${logErr.message}`, before, after: afterErr, seen, drained: 0 },
        { status: 500 }
      );
    }

    // aggregate counters
    const qCounts = new Map<string, number>();
    const pageCounts = new Map<string, number>();
    const chunkCounts = new Map<string, number>();
    for (const r of recs) {
      qCounts.set(r.q, (qCounts.get(r.q) || 0) + 1);
      for (const t of r.top) {
        pageCounts.set(t.page, (pageCounts.get(t.page) || 0) + 1);
        chunkCounts.set(t.id, (chunkCounts.get(t.id) || 0) + 1);
      }
    }

    const incr = async (key: string, by: number) => {
      const { error } = await supabase.rpc("b2ai_incr_counter", { k: key, by });
      if (error) throw new Error(error.message);
    };
    const doMap = async (m: Map<string, number>, prefix: string) => {
      for (const [k, by] of m.entries()) await incr(`${prefix}:${k}`, by);
    };

    await incr("totals:queries", recs.length);
    await doMap(qCounts, "q");
    await doMap(pageCounts, "page");
    await doMap(chunkCounts, "chunk");

    const after = await kv.llen("b2ai:recent");
    return NextResponse.json({
      ok: true,
      route: "mirror",
      drained: recs.length,
      seen,
      before,
      after,
      wrote_logs: true,
      wrote_counters: true,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, route: "mirror", error: String(e) }, { status: 500 });
  }
}
