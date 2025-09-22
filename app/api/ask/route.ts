// app/api/ask/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { kv, hasKV } from "@/lib/kv";

export const runtime = "nodejs";

// ---- Types ----
type Pack = { ids: string[]; embeddings: number[][] };
type PageSpan = { start: number; end: number };
type Chunk = { id: string; page?: PageSpan; text: string };

// ---- Load pack files once ----
const packPath = path.join(process.cwd(), "public", "pack");

const EMB: Pack = JSON.parse(
  fs.readFileSync(path.join(packPath, "embeddings.json"), "utf8")
);

const CHUNKS: Chunk[] = fs
  .readFileSync(path.join(packPath, "chunks.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as Chunk);

const POLICY = fs.readFileSync(path.join(packPath, "policy.txt"), "utf8");

// Local log (dev only)
const LOG_PATH = path.join(process.cwd(), "data", "log.jsonl");
const IS_PROD = process.env.NODE_ENV === "production" || !!process.env.VERCEL;

// ---- Utils ----
function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

function formatPageSpan(c: Chunk): string {
  if (!c.page) return "p.?";
  const s = c.page.start, e = c.page.end;
  return s === e ? `p.${s}` : `p.${s}–${e}`;
}

// ---- Route ----
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { q?: unknown; k?: unknown };
    const q = typeof body.q === "string" ? body.q : "";
    const kRaw = typeof body.k === "number" ? body.k : 5;
    const k = Number.isFinite(kRaw) ? kRaw : 5;

    if (!q) {
      return NextResponse.json({ error: "missing q" }, { status: 400 });
    }

    const client = new OpenAI();

    // 1) Embed the query
    const emb = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: q,
    });
    const qvec = emb.data[0].embedding as number[];

    // 2) Rank
    const sims = EMB.embeddings.map((v) => cosine(v, qvec));
    const idx = sims
      .map((s, i) => [s, i] as const)
      .sort((a, b) => b[0] - a[0])
      .slice(0, k)
      .map(([, i]) => i);

    // 3) Top chunks
    const top = idx.map((i) => {
      const id = EMB.ids[i];
      const c = CHUNKS.find((x) => x.id === id)!;
      const page = formatPageSpan(c);
      return { id, page, text: c.text };
    });

    // 4) Prompt
    const sourcesList = Array.from(new Set(top.map((t) => `[${t.page}]`))).join(", ");
    const system = `${POLICY}

Always answer in bullets; end EVERY bullet with a page span like [p.X–Y].
After bullets, add exactly this line (with the spans you used): 
Sources: ${sourcesList}
`;
    const user =
      `Question: ${q}\n\nHere are the most relevant excerpts (use only these):\n` +
      top.map((t, i) => `[${i + 1}] [${t.page}] ${t.text}`).join("\n\n");

    // 5) Answer
    const chat = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    });
    const answer = chat.choices[0]?.message?.content ?? "";

    // 6) Logging
    let loggingMode = "none";
    if (!IS_PROD) {
      try {
        fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
        const rec = {
          ts: new Date().toISOString(),
          q,
          k,
          top: top.map((t) => ({ id: t.id, page: t.page })),
          answer_len: answer.length,
        };
        fs.appendFileSync(LOG_PATH, JSON.stringify(rec) + "\n", "utf8");
        loggingMode = "file";
      } catch (e) {
        console.warn("log append failed:", e);
      }
    } else if (hasKV) {
      try {
        loggingMode = "kv";
        await kv.incr("b2ai:totals:queries");
        await kv.zincrby("b2ai:topQueries", 1, q);
        for (const t of top) {
          await kv.zincrby("b2ai:topPages", 1, t.page);
          await kv.zincrby("b2ai:topChunks", 1, t.id);
        }
        const recentRec = JSON.stringify({
          ts: new Date().toISOString(),
          q,
          top,
          answer_len: answer.length,
        });
        await kv.lpush("b2ai:recent", recentRec);
        await kv.ltrim("b2ai:recent", 0, 999);
      } catch (e) {
        loggingMode = "kv-error";
        console.warn("KV logging failed:", e);
      }
    }

    const res = NextResponse.json({ answer, top });
    res.headers.set("x-book2ai-logging", loggingMode);
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("ask route error:", msg);
    return NextResponse.json(
      { error: "server_error", detail: msg },
      { status: 500 }
    );
  }
}
