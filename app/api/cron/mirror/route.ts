// app/api/cron/mirror/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv, hasKV } from "@/lib/kv";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// How many records to drain per run (tune as needed)
const BATCH = Number(process.env.MIRROR_BATCH_SIZE || 200);
// Set to "1" to keep items in KV (dry run)
const DRY = process.env.MIRROR_DRY_RUN === "1";

type RecentRec = {
  ts: string;
  q: string;
  top: { id: string; page: string }[];
  answer_len: number;
};

async function drainRecent(max: number): Promise<RecentRec[]> {
  const out: RecentRec[] = [];
  for (let i = 0; i < max; i++) {
    const raw = await kv.lpop<string>("b2ai:recent");
    if (!raw) break;
    try {
      const rec = JSON.parse(raw) as RecentRec;
      out.push(rec);
    } catch {
      // malformed entry; skip
    }
  }
  return out;
}

async function putBack(recs: RecentRec[]) {
  if (!recs.length) return;
  const vals = recs.map((r) => JSON.stringify(r));
  // push back in reverse order to preserve original order
  for (let i = vals.length - 1; i >= 0; i--) {
    await kv.lpush("b2ai:recent", vals[i]);
  }
}

function isAuthorized(req: NextRequest): boolean {
  // Option A: query param token (manual runs)
  const url = new URL(req.url);
  const qpToken = url.searchParams.get("token");

  // Option B: custom header you can set (manual runs / other schedulers)
  const hdrToken = req.headers.get("x-cron-secret");

  // Option C: Vercel Cron header (first-party scheduler)
  // Vercel sets 'x-vercel-cron' for cron invocations
  const vercelCron = req.headers.get("x-vercel-cron");

  const envToken = process.env.CRON_SECRET;

  if (vercelCron) return true; // invoked by Vercel Cron
  if (envToken && (qpToken === envToken || hdrToken === envToken)) return true;

  return false;
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    if (!hasKV) {
      return NextResponse.json({ ok: false, error: "no_kv" }, { status: 200 });
    }

    const drained = await drainRecent(BATCH);

    if (DRY) {
      await putBack(drained);
      return NextResponse.json({ ok: true, mode: "dry", drained: drained.length });
    }

    if (drained.length === 0) {
      return NextResponse.json({ ok: true, drained: 0 });
    }

    const supabase = getSupabaseAdmin();

    // Batch insert logs
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
      return NextResponse.json(
        { ok: false, error: `log_insert: ${logErr.message}` },
        { status: 500 }
      );
    }

    // Build counters aggregation
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
      for (const [k, by] of m.entries()) {
        await incr(`${prefix}:${k}`, by);
      }
    };

    await incr("totals:queries", drained.length);
    await doMap(qCounts, "q");
    await doMap(pageCounts, "page");
    await doMap(chunkCounts, "chunk");

    return NextResponse.json({
      ok: true,
      drained: drained.length,
      wrote_logs: true,
      wrote_counters: true,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
