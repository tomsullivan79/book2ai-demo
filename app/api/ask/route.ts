// app/api/ask/route.ts
import { NextRequest } from "next/server";
import {
  loadPack,
  ensureQaEmbeddings,
  getChunkById,
  topKByEmbedding,
  bestQaMatch,
} from "@/lib/pack-runtime";

export const runtime = "nodejs"; // streaming via Node fetch

type AskBody = {
  q?: string;
  pack?: string;
  k?: number;
};

async function embedQuery(q: string): Promise<number[]> {
  const key = process.env.OPENAI_API_KEY!;
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: q,
    }),
  });
  if (!r.ok) throw new Error(`embed query failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.data[0].embedding as number[];
}

function buildPrompt(userQ: string, sources: { id: string; text: string }[]) {
  const src = sources
    .map(
      (s, i) =>
        `[#${i + 1} id=${s.id}]\n${s.text.replace(/\n{3,}/g, "\n\n").slice(0, 2000)}`
    )
    .join("\n\n");
  return `You are a careful assistant. Answer the user's question using ONLY the sources below. Quote or paraphrase and cite by [#n id=...] when relevant.

Question:
${userQ}

Sources:
${src}

Answer (with brief citations like [#1], [#2] where used):`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as AskBody;
    const url = new URL(req.url);
    const userQ = (body.q ?? url.searchParams.get("q") ?? "").trim();
    const packId =
      (body.pack ?? url.searchParams.get("pack") ?? "hopkins-scientific-advertising").trim();
    const k = Math.max(3, Math.min(8, Number(body.k ?? url.searchParams.get("k") ?? 5)));

    if (!userQ) {
      return new Response("Missing q", { status: 400 });
    }

    // Load pack
    const pack = await loadPack(packId);
    if (!pack.embeddings?.ids?.length || !pack.embeddings?.vectors?.length) {
      return new Response("Pack has no embeddings.json", { status: 500 });
    }

    // 1) Embed the query
    const qVec = await embedQuery(userQ);

    // 2) Author Q&A boost
    await ensureQaEmbeddings(pack);
    const qaHit = bestQaMatch(qVec, pack.qaEmbeds || []);
    if (qaHit && qaHit.score >= 0.88) {
      const qa = pack.qa[qaHit.index];
      const citedId = qa.source_chunk || qa.id;
      // Stream the author's answer directly
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const intro = `Matched author Q&A (score ${qaHit.score.toFixed(2)}). `;
          const answer = `${intro}${qa.a}\n\nSources: [id=${citedId}]`;
          controller.enqueue(encoder.encode(answer));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    // 3) RAG over pack chunks
    const top = topKByEmbedding(qVec, pack.embeddings.ids, pack.embeddings.vectors, k);
    const topChunks = top
      .map((t) => getChunkById(pack, t.id))
      .filter(Boolean)
      .slice(0, k) as { id: string; text: string }[];

    const prompt = buildPrompt(userQ, topChunks);

    // 4) Stream completion
    const key = process.env.OPENAI_API_KEY!;
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        stream: true,
        temperature: 0.2,
        messages: [
          { role: "system", content: "You answer strictly from provided sources and cite." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!r.ok || !r.body) {
      return new Response(`LLM error: ${r.status} ${await r.text()}`, { status: 500 });
    }

    // Simple event-stream parser (OpenAI SSE)
    const encoder = new TextEncoder();
    const reader = r.body.getReader();

    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        const chunk = new TextDecoder().decode(value);
        // Parse "data: ..." lines
        for (const line of chunk.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            controller.close();
            return;
          }
          try {
            const j = JSON.parse(payload);
            const delta = j.choices?.[0]?.delta?.content ?? "";
            if (delta) controller.enqueue(encoder.encode(delta));
          } catch {
            // ignore parse slips
          }
        }
      },
      cancel() {
        reader.cancel();
      },
    });

    return new Response(stream, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  } catch (err: any) {
    return new Response(`Error: ${err?.message || String(err)}`, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // convenience: allow GET ?q=...&pack=...
  return POST(req);
}
