// app/api/ask/stream/route.ts
import { NextRequest } from "next/server";
import {
  loadPack,
  ensureQaEmbeddings,
  bestQaMatch,
  topKByEmbedding,
  getChunkById,
  EmbeddingsFile,
} from "@/lib/pack-runtime";

export const runtime = "nodejs";

type OpenAIEmbeddingResponse = {
  data: Array<{ embedding: number[] }>;
};

type OpenAIChatDeltaChunk = {
  choices?: Array<{ delta?: { content?: string } }>;
};

function sseJson(obj: unknown) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

async function embedQuery(q: string): Promise<number[]> {
  const key = process.env.OPENAI_API_KEY!;
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: q }),
  });
  if (!r.ok) throw new Error(`embed query failed: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as OpenAIEmbeddingResponse;
  return j.data[0].embedding;
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

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const userQ = (url.searchParams.get("q") ?? "").trim();
  const packId = (body.pack ?? url.searchParams.get("pack") ?? "scientific-advertising").trim();

  const k = Math.max(3, Math.min(8, Number(url.searchParams.get("k") ?? 5)));

  if (!userQ) {
    return new Response(sseJson({ type: "error", message: "Missing q" }), {
      headers: { "content-type": "text/event-stream" },
      status: 400,
    });
  }

  try {
    const pack = await loadPack(packId);
    const emb: EmbeddingsFile | undefined = pack.embeddings;
    if (!emb?.ids?.length || !emb?.vectors?.length) {
      return new Response(sseJson({ type: "error", message: "Pack has no embeddings.json" }), {
        headers: { "content-type": "text/event-stream" },
        status: 500,
      });
    }

    // 1) Embed the query
    const qVec = await embedQuery(userQ);

    // 2) QA boost (author Q&A)
    await ensureQaEmbeddings(pack);
    const qaHit = bestQaMatch(qVec, pack.qaEmbeds || []);
    if (qaHit && qaHit.score >= 0.88) {
      const qa = pack.qa[qaHit.index];
      const citedId = qa.source_chunk || qa.id;

      const stream = new ReadableStream({
        start(controller) {
          const intro = `Matched author Q&A (score ${qaHit.score.toFixed(2)}). `;
          const answer = `${intro}${qa.a}\n\nSources: [id=${citedId}]`;
          controller.enqueue(new TextEncoder().encode(sseJson({ type: "chunk", delta: answer })));
          controller.enqueue(
            new TextEncoder().encode(
              sseJson({
                type: "done",
                sources: [{ id: citedId, score: qaHit.score, text: null }],
              })
            )
          );
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        },
      });
    }

    // 3) RAG: retrieve top-k chunks
    const top = topKByEmbedding(qVec, emb.ids, emb.vectors, k);
    const topChunks = top
      .map((t) => getChunkById(pack, t.id))
      .filter((c): c is { id: string; text: string } => !!c)
      .slice(0, k);

    const prompt = buildPrompt(userQ, topChunks);

    // 4) Call OpenAI (SSE) and re-wrap as JSON SSE frames
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
      const errText = await r.text().catch(() => "");
      return new Response(sseJson({ type: "error", message: `LLM error: ${r.status} ${errText}` }), {
        headers: { "content-type": "text/event-stream" },
        status: 500,
      });
    }

    const encoder = new TextEncoder();
    const reader = r.body.getReader();

    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          // Send final 'done' with sources
          controller.enqueue(
            encoder.encode(
              sseJson({
                type: "done",
                sources: top.map((t, i) => ({
                  id: top[i].id,
                  score: top[i].score,
                })),
              })
            )
          );
          controller.close();
          return;
        }
        const chunk = new TextDecoder().decode(value);
        for (const line of chunk.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            // We'll emit our own 'done' above on close.
            continue;
          }
          try {
            const j = JSON.parse(payload) as OpenAIChatDeltaChunk;
            const delta = j.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              controller.enqueue(encoder.encode(sseJson({ type: "chunk", delta })));
            }
          } catch {
            // ignore JSON parse blips
          }
        }
      },
      cancel() {
        reader.cancel();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(sseJson({ type: "error", message: msg }), {
      headers: { "content-type": "text/event-stream" },
      status: 500,
    });
  }
}

// Optional POST passthrough: allow POST /api/ask/stream with JSON {q,pack}
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  try {
    const body = (await req.json().catch(() => ({}))) as { q?: string; pack?: string; k?: number };
    if (body.q) url.searchParams.set("q", body.q);
    if (body.pack) url.searchParams.set("pack", body.pack);
    if (typeof body.k === "number") url.searchParams.set("k", String(body.k));
  } catch {
    // ignore
  }
  return GET(new NextRequest(url.toString(), { headers: req.headers }));
}
