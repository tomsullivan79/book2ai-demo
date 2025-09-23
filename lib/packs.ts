import fs from 'node:fs';
import path from 'node:path';

export type PackFile = {
  path: string;
  purpose: 'chunks' | 'other';
  sha256?: string;
};

export type PackManifest = {
  id: string;
  title: string;
  author?: string;
  edition?: string;
  language?: string;
  source?: Record<string, unknown>;
  embedding?: {
    model?: string;
    dim?: number;
    chunk_count?: number;
  };
  files: PackFile[];
  created_at?: string;
  manifest_digest?: string;
};

export type PackMeta = {
  id: string;
  title: string;
  installed: boolean;
  manifestPath: string;
  baseDir: string;
  legacy?: boolean;
};

const ROOT = process.cwd();

function legacyManifestPath() {
  return path.join(ROOT, 'public', 'pack', 'manifest.json');
}

function multiPackDir() {
  return path.join(ROOT, 'public', 'packs');
}

export function listPacks(): PackMeta[] {
  const out: PackMeta[] = [];

  // Legacy single-pack (Scientific Advertising)
  const legacy = legacyManifestPath();
  if (fs.existsSync(legacy)) {
    try {
      const raw = JSON.parse(fs.readFileSync(legacy, 'utf8')) as PackManifest;
      out.push({
        id: raw.id || 'hopkins-scientific-advertising',
        title: raw.title || 'Scientific Advertising',
        installed: true,
        manifestPath: legacy,
        baseDir: path.dirname(legacy),
        legacy: true,
      });
    } catch {
      // ignore
    }
  }

  // Multi-pack directory
  const dir = multiPackDir();
  if (fs.existsSync(dir)) {
    for (const child of fs.readdirSync(dir)) {
      const mPath = path.join(dir, child, 'manifest.json');
      if (!fs.existsSync(mPath)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(mPath, 'utf8')) as PackManifest;
        out.push({
          id: raw.id || child,
          title: raw.title || child,
          installed: true,
          manifestPath: mPath,
          baseDir: path.dirname(mPath),
        });
      } catch {
        // ignore this child
      }
    }
  }

  return out;
}

export function getPackById(id?: string | null): PackMeta | null {
  const all = listPacks();
  if (!id) return all[0] || null;
  return all.find((p) => p.id === id) || null;
}

export function readManifest(meta: PackMeta): PackManifest | null {
  try {
    return JSON.parse(fs.readFileSync(meta.manifestPath, 'utf8')) as PackManifest;
  } catch {
    return null;
  }
}

export function resolvePublicPath(p: string): string {
  // Accepts paths like "/pack/chunks.jsonl" or "/packs/<id>/chunks.jsonl"
  const clean = p.replace(/^\/+/, '');
  return path.join(ROOT, 'public', clean);
}
