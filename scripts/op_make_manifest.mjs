#!/usr/bin/env node
/**
 * Generate or update a pack manifest.json for /public/packs/<packId>
 * - Infers chunk_count from chunks.jsonl
 * - Lists known files with sha256 and proper /packs/<id>/ paths
 * - Sets id, title (best-effort), language, embedding model/dim
 * - Leaves manifest_digest "" (op_seal_pack.mjs will fill it)
 *
 * Usage:
 *   node scripts/op_make_manifest.mjs scientific-advertising
 *   node scripts/op_make_manifest.mjs optimal-poker
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const packId = process.argv[2];
if (!packId) {
  console.error('Usage: node scripts/op_make_manifest.mjs <packId>');
  process.exit(1);
}

const root = process.cwd();
const packDir = path.join(root, 'public', 'packs', packId);
const manifestPath = path.join(packDir, 'manifest.json');

function sha256File(abs) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(abs));
  return h.digest('hex');
}

function readJSONLCount(abs) {
  if (!fs.existsSync(abs)) return 0;
  const raw = fs.readFileSync(abs, 'utf8');
  return raw.trim() ? raw.trim().split(/\n+/).length : 0;
}

function titleFromId(id) {
  if (id === 'scientific-advertising') return 'Scientific Advertising';
  if (id === 'optimal-poker') return 'Optimal Poker';
  // fallback: Title Case by hyphen
  return id
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

const filesToConsider = [
  'chunks.jsonl',
  'qa.jsonl',
  'expectations.jsonl',
  'embeddings.json',
];

function main() {
  if (!fs.existsSync(packDir)) {
    console.error(`Pack folder not found: ${packDir}`);
    process.exit(1);
  }

  // Count chunks (if present)
  const chunksAbs = path.join(packDir, 'chunks.jsonl');
  const chunkCount = readJSONLCount(chunksAbs);

  // Build files[] with sha256 (only for files that actually exist)
  const files = [];
  for (const f of filesToConsider) {
    const abs = path.join(packDir, f);
    if (fs.existsSync(abs)) {
      const relForManifest = `/packs/${packId}/${f}`;
      files.push({
        path: relForManifest,
        purpose:
          f === 'chunks.jsonl'
            ? 'chunks'
            : f === 'qa.jsonl'
            ? 'qa'
            : f === 'expectations.jsonl'
            ? 'expectations'
            : 'embeddings',
        sha256: sha256File(abs),
      });
    }
  }

  // Start from existing manifest if present
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      // ignore
    }
  }

  const nowIso = new Date().toISOString();

  const next = {
    id: packId,
    title: manifest.title || titleFromId(packId),
    author: manifest.author || (packId === 'scientific-advertising' ? 'Claude C. Hopkins' : ''),
    edition: manifest.edition || (packId === 'scientific-advertising' ? 'Public Domain' : ''),
    language: manifest.language || 'en',
    source: manifest.source || {
      type: 'custom',
      provenance: 'User provided / normalized',
      notes: '',
    },
    embedding: {
      model: 'text-embedding-3-small',
      dim: 1536,
      chunk_count: chunkCount,
    },
    files,
    created_at: manifest.created_at || nowIso,
    manifest_digest: '', // will be set by op_seal_pack.mjs
  };

  fs.writeFileSync(manifestPath, JSON.stringify(next, null, 2));
  console.log(`Wrote manifest: ${path.relative(root, manifestPath)}`);
  console.log(`- id: ${next.id}`);
  console.log(`- files: ${files.length}`);
  console.log(`- chunk_count: ${chunkCount}`);
}

main();
