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

  if (vercelCron) return true; // invoked by Vercel cron
  if (envToken && (qpToken === envToken || hdrToken === envToken)) return true;
  return false;
}

async function drainRecent(max: number): Promise<RecentRec[]> {
  const out: RecentRec[] = [];
  for (let i = 0; i < max; i++) {
    const raw = await kv.lpop<string>("b2ai:recent");
    if (!raw) break;
    try {
      out.push(JSON.parse(raw) as RecentRec);
    } catch {
      // skip malformed
    }
  }
  return out;
}

async function putBack(recs: RecentRec[]) {
  if (!recs.length) return;
  for (let i = recs.length - 1; i >= 0; i--) {
    await kv.lpush("b2ai:recent", JSON.stringify(recs[i]));
  }
}

export async function GET(req: NextRequest) {
  // Quick “route exists” stamp for debugging
  const debug = req.nextUrl.searchParams.get("debug");

  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, route: "mirror", error: "unauthorized" }, { status: 401 });
  }

  if (!hasKV) {
    return NextResponse.json({ ok: false, route: "mirror", error: "no_kv" }, { status: 200 });
  }

  if (debug === "ping") {
    const llen = await kv.llen("b2ai:recent");
    return NextResponse.json({ ok: true, route: "mirror", mode: "ping", llen, batch: BATCH, dry: DRY });
  }

  const drained = await drainRecent(BATCH);

  if (DRY) {
    await putBack(drained);
    return NextResponse.json({ ok: true, route: "mirror", mode: "dry", drained: drained.length });
  }

  if (drained.length === 0) {
    return NextResponse.json({ ok: true, route: "mirror", drained: 0 });
  }

  try {
    const supabase = getSupabaseAdmin();

    // insert log rows
    const { error: logErr } = await supabase
      .from("b2ai_query_log")
      .insert(
        drained.map((r) => ({
          ts: r.ts,
          q: r.q,
          answer_len: r.answer_len,
          top: r.top,
        }))
      );

    if (logErr) {
      await putBack(drained);
      return NextResponse.json({ ok: false, route: "mirror", error: `log_insert: ${logErr.message}` }, { status: 500 });
    }

    // aggregate counters
    const qCounts = new Map<string, number>();
    const pageCounts = new Map<string, number>();
    const chunkCounts = new Map<string, number>();
    for (const r of drained) {
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

    await incr("totals:queries", drained.length);
    await doMap(qCounts, "q");
    await doMap(pageCounts, "page");
    await doMap(chunkCounts, "chunk");

    return NextResponse.json({
      ok: true,
      route: "mirror",
      drained: drained.length,
      wrote_logs: true,
      wrote_counters: true,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, route: "mirror", error: String(e) }, { status: 500 });
  }
}
