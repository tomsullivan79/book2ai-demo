// lib/pack-runtime.ts
// Server-only helper to load a pack's data (chunks, embeddings, qa) from /public/packs/<id>/
// Caches everything in-memory. Also embeds QA questions once (cached) for the QA boost.

import fs from "node:fs";
import path from "node:path";

export type EmbeddingsFile = {
  model: string;
  dim: number;
  ids: string[];
  vectors: number[][];
};

export type Chunk = {
  id: string;
  text: string;
  type?: "text" | "qa" | "expectations";
  q?: string;
  a?: string;
  page?: number | null;
};

export type QAPair = { id: string; q: string; a: string; source_chunk?: string };

type PackData = {
  id: string;
  chunks: Chunk[];
  embeddings: EmbeddingsFile;
  qa: QAPair[];
  // cached QA embeddings (for author-Q&A boost)
  qaEmbeds?: number[][];
  qaEmbedModel?: string;
};

type Cache = {
  packs: Map<string, PackData>;
};

const g = globalThis as unknown as { __PACK_CACHE__?: Cache };

function getCache(): Cache {
  if (!g.__PACK_CACHE__) g.__PACK_CACHE__ = { packs: new Map() };
  return g.__PACK_CACHE__;
}

function readJSONL<T>(abs: string): T[] {
  if (!fs.existsSync(abs)) return [];
  const raw = fs.readFileSync(abs, "utf8");
  return raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

function readJSON<T>(abs: string): T | null {
  if (!fs.existsSync(abs)) return null;
  return JSON.parse(fs.readFileSync(abs, "utf8")) as T;
}

export async function loadPack(packId: string): Promise<PackData> {
  const cache = getCache();
  const hit = cache.packs.get(packId);
  if (hit) return hit;

  const base = path.join(process.cwd(), "public", "packs", packId);

  const chunks = readJSONL<Chunk>(path.join(base, "chunks.jsonl"));
  const embeddings =
    readJSON<EmbeddingsFile>(path.join(base, "embeddings.json")) ??
    ({ model: "text-embedding-3-small", dim: 1536, ids: [], vectors: [] } as EmbeddingsFile);

  // Q&A: from file if present, else derive from chunks
  const qaFromFile = readJSONL<QAPair>(path.join(base, "qa.jsonl"));
  let qa = qaFromFile;
  if (qa.length === 0) {
    const qaChunks = chunks.filter((c) => c.type === "qa" && c.q && c.a);
    qa = qaChunks.map((c) => ({ id: c.id, q: c.q!, a: c.a!, source_chunk: c.id }));
  }

  const data: PackData = { id: packId, chunks, embeddings: embeddings!, qa };
  cache.packs.set(packId, data);
  return data;
}

// --------- math / embedding helpers ----------

export function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i],
      y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

type OpenAIEmbeddingResponse = {
  data: Array<{ embedding: number[] }>;
};

async function embedTexts(model: string, inputs: string[]): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, input: inputs }),
  });
  if (!r.ok) throw new Error(`Embeddings failed: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as OpenAIEmbeddingResponse;
  return j.data.map((d) => d.embedding);
}

// Prepare and cache QA embeddings (questions only)
export async function ensureQaEmbeddings(pack: PackData): Promise<void> {
  if (pack.qaEmbeds && pack.qaEmbedModel === "text-embedding-3-small") return;
  const qs = pack.qa.map((q) => q.q);
  if (qs.length === 0) {
    pack.qaEmbeds = [];
    pack.qaEmbedModel = "text-embedding-3-small";
    return;
  }
  const out: number[][] = [];
  for (let i = 0; i < qs.length; i += 64) {
    const batch = qs.slice(i, i + 64);
    const embs = await embedTexts("text-embedding-3-small", batch);
    out.push(...embs);
  }
  pack.qaEmbeds = out;
  pack.qaEmbedModel = "text-embedding-3-small";
}

// Retrieve top-k chunk ids by similarity
export function topKByEmbedding(
  userVec: number[],
  ids: string[],
  vectors: number[][],
  k: number
): { id: string; score: number; index: number }[] {
  const scores: { id: string; score: number; index: number }[] = [];
  const n = Math.min(ids.length, vectors.length);
  for (let i = 0; i < n; i++) {
    const score = cosine(userVec, vectors[i]);
    scores.push({ id: ids[i], score, index: i });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, k);
}

// Find best QA match (returns index into pack.qa, score)
export function bestQaMatch(
  userVec: number[],
  qaVecs: number[][]
): { index: number; score: number } | null {
  if (!qaVecs || qaVecs.length === 0) return null;
  let best = -1;
  let bi = -1;
  for (let i = 0; i < qaVecs.length; i++) {
    const s = cosine(userVec, qaVecs[i]);
    if (s > best) {
      best = s;
      bi = i;
    }
  }
  return bi >= 0 ? { index: bi, score: best } : null;
}

// Find chunk by id
export function getChunkById(pack: PackData, id: string): Chunk | undefined {
  return pack.chunks.find((c) => c.id === id);
}
