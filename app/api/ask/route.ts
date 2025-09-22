import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";

type Pack = { ids: string[]; embeddings: number[][] };
const packPath = path.join(process.cwd(), "public", "pack");
const EMB: Pack = JSON.parse(fs.readFileSync(path.join(packPath, "embeddings.json"), "utf8"));
const CHUNKS = fs.readFileSync(path.join(packPath, "chunks.jsonl"), "utf8").trim().split("\n").map(l=>JSON.parse(l));
const POLICY = fs.readFileSync(path.join(packPath, "policy.txt"), "utf8");

function cosine(a:number[], b:number[]) {
  let dot=0, na=0, nb=0;
  for (let i=0;i<a.length;i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; }
  return dot / (Math.sqrt(na)*Math.sqrt(nb) + 1e-9);
}

export async function POST(req: NextRequest) {
  const { q, k=5 } = await req.json();
  if (!q || typeof q !== "string") return NextResponse.json({ error:"missing q" }, { status:400 });

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const emb = await client.embeddings.create({ model: "text-embedding-3-small", input: q });
  const qvec = emb.data[0].embedding as number[];

  // rank
  const sims = EMB.embeddings.map(v => cosine(v, qvec));
  const idx = sims.map((s,i)=>[s,i]).sort((a,b)=>b[0]-a[0]).slice(0,k).map(([,i])=>i);

  // gather top-k chunks + page spans
  const top = idx.map(i => {
    const id = EMB.ids[i];
    const c = CHUNKS.find(x=>x.id===id)!;
    const pg = c.page ? (c.page.start===c.page.end ? `[p.${c.page.start}]` : `[p.${c.page.start}–${c.page.end}]`) : "[p.?]";
    return { id, text: c.text, page: pg };
  });

  const sourcesList = Array.from(new Set(top.map(t=>t.page))).join(", ");

  const sys = `${POLICY}\n\nAlways answer in bullets; end EVERY bullet with a page span like [p.X–Y]. After bullets, add: Sources: ${sourcesList}.`
  const user = `Question: ${q}\n\nHere are the most relevant excerpts:\n` +
    top.map((t,i)=>`[${i+1}] ${t.page} ${t.text}`).join("\n\n") +
    `\n\nUse only these excerpts. Cite the page spans exactly as shown.`;

  const chat = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role:"system", content: sys }, { role:"user", content: user }],
    temperature: 0.2
  });

  return NextResponse.json({ answer: chat.choices[0].message.content, top });
}
