#!/usr/bin/env node
// Embed chunks.jsonl with OpenAI and write embeddings.json (aligned with chunk order)
// Usage:
//   OPENAI_API_KEY=... node scripts/embed_pack.mjs public/packs/optimal-poker/chunks.jsonl

import fs from 'node:fs';
import path from 'node:path';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY');
  process.exit(1);
}

if (process.argv.length < 3) {
  console.error('Usage: node scripts/embed_pack.mjs <path/to/chunks.jsonl>');
  process.exit(1);
}

const chunksPath = process.argv[2];
const outPath = path.join(path.dirname(chunksPath), 'embeddings.json');

function readChunks(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
  return lines.map((l) => JSON.parse(l));
}

async function embedBatch(texts) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: texts,
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`embed failed: ${r.status} ${err}`);
  }
  const j = await r.json();
  return j.data.map((d) => d.embedding);
}

(async () => {
  const chunks = readChunks(chunksPath);
  const BATCH = 64;
  const vectors = [];

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const embs = await embedBatch(batch.map((c) => c.text));
    vectors.push(...embs);
    process.stdout.write(`\rEmbedded ${Math.min(i + BATCH, chunks.length)}/${chunks.length}`);
  }
  console.log('\nDone.');

  const dim = vectors[0]?.length || 1536;
  const out = { model: 'text-embedding-3-small', dim, ids: chunks.map((c) => c.id), vectors };
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`Wrote ${outPath}`);
})();
