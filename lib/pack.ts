// lib/pack.ts
import 'server-only';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export type PackFile = {
  path: string;          // web path under /public (e.g. "/pack/chunks.jsonl")
  purpose: string;       // "chunks" | "vectors" | ...
  sha256: string | null; // expected (null = unsealed)
};

export type PackManifest = {
  id: string;
  title: string;
  author: string;
  edition: string;
  language?: string;
  source?: Record<string, unknown>;
  embedding?: {
    model: string;
    dim: number;
    chunk_count?: number;
  };
  files: PackFile[];
  created_at: string;
};

export type FileIntegrity = {
  path: string;
  purpose: string;
  expected: string | null;
  computed: string | null;
  exists: boolean;
  ok: boolean | null; // null if no expected
  size: number | null;
};

export type IntegrityReport = {
  manifest: {
    id: string;
    title: string;
    author: string;
    edition: string;
    created_at: string;
  };
  files: FileIntegrity[];
  sealed: boolean; // true if all files have expected && ok === true
};

function publicRoot() {
  return path.join(process.cwd(), 'public');
}

async function sha256OfFile(absPath: string): Promise<{ hash: string; size: number }> {
  const buf = await fs.readFile(absPath);
  const h = createHash('sha256').update(buf).digest('hex');
  return { hash: h, size: buf.length };
}

export async function loadManifest(): Promise<PackManifest> {
  const p = path.join(publicRoot(), 'pack', 'manifest.json');
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw) as PackManifest;
}

export async function verifyPack(): Promise<IntegrityReport> {
  const manifest = await loadManifest();

  const files: FileIntegrity[] = [];
  for (const f of manifest.files) {
    const webPath = f.path.startsWith('/') ? f.path : `/${f.path}`;
    const abs = path.join(publicRoot(), webPath);
    let exists = true;
    let computed: string | null = null;
    let ok: boolean | null = null;
    let size: number | null = null;

    try {
      const st = await fs.stat(abs);
      if (!st.isFile()) throw new Error('not a file');
      const s = await sha256OfFile(abs);
      computed = s.hash;
      size = s.size;
      if (f.sha256) ok = f.sha256.toLowerCase() === s.hash.toLowerCase();
    } catch {
      exists = false;
    }

    files.push({
      path: webPath,
      purpose: f.purpose,
      expected: f.sha256,
      computed,
      exists,
      ok,
      size
    });
  }

  const sealed = files.length > 0 && files.every(fi => fi.expected && fi.ok === true);
  return {
    manifest: {
      id: manifest.id,
      title: manifest.title,
      author: manifest.author,
      edition: manifest.edition,
      created_at: manifest.created_at
    },
    files,
    sealed
  };
}
