// app/api/analytics/route.ts
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { kv, hasKV } from "@/lib/kv";

type StatItem = { key: string; count: number };
type AnalyticsPayload = {
  totals: { queries: number };
  topQueries: StatItem[];
  topPages: StatItem[];
  topChunks: StatItem[];
  mode?: "kv" | "file";
};

const LOG_PATH = path.join(process.cwd(), "data", "log.jsonl");

async function getFromKV(): Promise<AnalyticsPayload> {
  const totals = Number((await kv.get("b2ai:totals:queries")) ?? 0);

  const parseZRange = (entries: (string | number)[]): StatItem[] => {
    const out: StatItem[] = [];
    for (let i = 0; i < entries.length; i += 2) {
      out.push({ key: String(entries[i]), count: Number(entries[i + 1]) });
    }
    return out;
  };

  const topQueriesRaw = (await kv.zrange("b2ai:topQueries", 0, 9, {
    rev: true,
    withScores: true,
  })) as (string | number)[];
  const topPagesRaw = (await kv.zrange("b2ai:topPages", 0, 9, {
    rev: true,
    withScores: true,
  })) as (string | number)[];
  const topChunksRaw = (await kv.zrange("b2ai:topChunks", 0, 9, {
    rev: true,
    withScores: true,
  })) as (string | number)[];

  return {
    totals: { queries: totals },
    topQueries: parseZRange(topQueriesRaw),
    topPages: parseZRange(topPagesRaw),
    topChunks: parseZRange(topChunksRaw),
    mode: "kv",
  };
}

function getFromFile(): AnalyticsPayload {
  if (!fs.existsSync(LOG_PATH)) {
    return {
      totals: { queries: 0 },
      topQueries: [],
      topPages: [],
      topChunks: [],
      mode: "file",
    };
  }
  const lines = fs.readFileSync(LOG_PATH, "utf8").trim().split("\n").filter(Boolean);
  type Rec = { q: string; top: { id: string; page: string }[] };
  const recs: Rec[] = lines.map((l) => JSON.parse(l));

  const qMap: Record<string, number> = {};
  const pMap: Record<string, number> = {};
  const cMap: Record<string, number> = {};

  for (const r of recs) {
    qMap[r.q] = (qMap[r.q] || 0) + 1;
    for (const t of r.top) {
      pMap[t.page] = (pMap[t.page] || 0) + 1;
      cMap[t.id] = (cMap[t.id] || 0) + 1;
    }
  }

  const sortTop = (m: Record<string, number>): StatItem[] =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => ({ key, count }));

  return {
    totals: { queries: recs.length },
    topQueries: sortTop(qMap),
    topPages: sortTop(pMap),
    topChunks: sortTop(cMap),
    mode: "file",
  };
}

export async function GET() {
  try {
    if (hasKV) {
      const data = await getFromKV();
      return NextResponse.json(data);
    }
    const data = getFromFile();
    return NextResponse.json(data);
  } catch (e) {
    console.error("analytics error:", e);
    return NextResponse.json(
      {
        totals: { queries: 0 },
        topQueries: [],
        topPages: [],
        topChunks: [],
        mode: hasKV ? "kv" : "file",
      },
      { status: 500 }
    );
  }
}
