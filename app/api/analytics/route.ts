import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

type Rec = { ts:string; q:string; k:number; top:{id:string; page:string}[]; answer_len:number };

const LOG_PATH = path.join(process.cwd(), "data", "log.jsonl");

export async function GET() {
  if (!fs.existsSync(LOG_PATH)) {
    return NextResponse.json({ totals: { queries:0 }, topQueries:[], topPages:[], topChunks:[] });
  }
  const lines = fs.readFileSync(LOG_PATH, "utf8").trim().split("\n").filter(Boolean);
  const recs: Rec[] = lines.map(l => JSON.parse(l));

  const queries: Record<string, number> = {};
  const pages: Record<string, number> = {};
  const chunks: Record<string, number> = {};

  for (const r of recs) {
    queries[r.q] = (queries[r.q] || 0) + 1;
    for (const t of r.top) {
      pages[t.page] = (pages[t.page] || 0) + 1;
      chunks[t.id] = (chunks[t.id] || 0) + 1;
    }
  }

  const sortTop = (m:Record<string,number>, n=10) =>
    Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([key,count])=>({ key, count }));

  return NextResponse.json({
    totals: { queries: recs.length },
    topQueries: sortTop(queries, 10),
    topPages: sortTop(pages, 10),
    topChunks: sortTop(chunks, 10),
  });
}
