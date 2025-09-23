import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

/** ---------- Types ---------- */

export type ManifestFile = {
  path: string;
  purpose?: string | null;
  /** Legacy key (supported): */
  expected?: string | null;
  /** Your new key (supported): */
  sha256?: string | null;
};

export type PackManifest = {
  id: string;
  title?: string;
  author?: string;
  edition?: string;
  created_at?: string;
  /** Optional metadata you added */
  language?: string;
  source?: {
    type?: string;
    provenance?: string;
    notes?: string;
  };
  embedding?: {
    model?: string;
    dim?: number;
    chunk_count?: number;
  };
  /** Self-hash of this manifest (sha256 of canonicalized json with this field blank) */
  manifest_digest?: string;
  files: ManifestFile[];
};

export type IntegrityFile = {
  path: string;
  purpose?: string | null;
  expected?: string | null;  // normalized: will contain either manifest.expected or manifest.sha256
  computed?: string | null;
  exists: boolean;
  ok: boolean;
  size: number | null;
};

export type IntegrityReport = {
  manifest: {
    id: string;
    title?: string;
    author?: string;
    edition?: string;
    created_at?: string;
    manifest_digest?: string;
    language?: string;
    source?: PackManifest['source'];
    embedding?: PackManifest['embedding'];
  };
  manifest_digest_ok: boolean;
  files: IntegrityFile[];
  sealed: boolean;
};

/** ---------- Helpers ---------- */

function sha256Hex(buf: Buffer): string {
  const h = crypto.createHash('sha256');
  h.update(buf);
  return h.digest('hex');
}

async function sha256FileHex(absFile: string): Promise<{ hex: string; size: number }> {
  const buf = await fs.readFile(absFile);
  return { hex: sha256Hex(buf), size: buf.byteLength };
}

/** stringify with keys sorted stable, removing undefineds */
function stableStringify(value: unknown): string {
  const seen = new WeakSet();

  const sorter = (v: unknown): unknown => {
    if (v === null) return null;
    if (typeof v !== 'object') return v;
    if (seen.has(v as object)) throw new Error('circular structure not supported for stableStringify');
    seen.add(v as object);

    if (Array.isArray(v)) return v.map(sorter);

    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const val = obj[k];
      if (typeof val === 'undefined') continue;
      out[k] = sorter(val);
    }
    return out;
  };

  return JSON.stringify(sorter(value));
}

/** load manifest json */
export async function loadManifest(): Promise<PackManifest> {
  const abs = path.join(process.cwd(), 'public', 'pack', 'manifest.json');
  const txt = await fs.readFile(abs, 'utf8');
  const json = JSON.parse(txt) as PackManifest;
  return json;
}

/** compute the canonical digest of the manifest:
 *  - clone manifest
 *  - set manifest_digest to empty string
 *  - stable stringify (sorted keys)
 *  - sha256 of the resulting text
 */
export function computeManifestSelfDigest(manifest: PackManifest): string {
  const clone: PackManifest = {
    ...manifest,
    manifest_digest: '',
    files: manifest.files.map(f => ({ ...f })),
  };
  const s = stableStringify(clone);
  return sha256Hex(Buffer.from(s, 'utf8'));
}

/** build full integrity report for UI/API */
export async function buildIntegrityReport(): Promise<IntegrityReport> {
  const manifest = await loadManifest();

  // Verify each file listed in manifest
  const files: IntegrityFile[] = [];
  for (const f of manifest.files) {
    // normalize expected hash from either `expected` or `sha256`
    const expected = (f.expected ?? f.sha256 ?? null) || null;

    const rel = f.path.startsWith('/') ? f.path : `/${f.path}`;
    const abs = path.join(process.cwd(), 'public', rel);
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        files.push({
          path: f.path,
          purpose: f.purpose ?? null,
          expected,
          computed: null,
          exists: false,
          ok: false,
          size: null,
        });
        continue;
      }
      const { hex, size } = await sha256FileHex(abs);
      const ok = typeof expected === 'string' && expected.length > 0 ? hex === expected : false;
      files.push({
        path: f.path,
        purpose: f.purpose ?? null,
        expected,
        computed: hex,
        exists: true,
        ok,
        size,
      });
    } catch {
      files.push({
        path: f.path,
        purpose: f.purpose ?? null,
        expected,
        computed: null,
        exists: false,
        ok: false,
        size: null,
      });
    }
  }

  // Compute and check manifest self-digest
  const computedDigest = computeManifestSelfDigest(manifest);
  const manifest_digest_ok =
    typeof manifest.manifest_digest === 'string' &&
    manifest.manifest_digest.length > 0 &&
    manifest.manifest_digest === computedDigest;

  // Sealed only if all files are OK (and have expected/sha256) AND manifest digest is OK
  const sealed =
    files.length > 0 &&
    files.every(f => f.ok && typeof f.expected === 'string' && f.expected.length > 0) &&
    manifest_digest_ok;

  return {
    manifest: {
      id: manifest.id,
      title: manifest.title,
      author: manifest.author,
      edition: manifest.edition,
      created_at: manifest.created_at,
      manifest_digest: manifest.manifest_digest,
      language: manifest.language,
      source: manifest.source,
      embedding: manifest.embedding,
    },
    manifest_digest_ok,
    files,
    sealed,
  };
}
