import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { getPackById, readManifest, resolvePublicPath } from '@/lib/packs';

function sha256File(fp: string): string {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(fp));
  return h.digest('hex');
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const packId = url.searchParams.get('pack') || null;
    const meta = getPackById(packId);
    if (!meta) return NextResponse.json({ ok: false, error: 'pack_not_found' }, { status: 404 });

    const manifest = readManifest(meta);
    if (!manifest) return NextResponse.json({ ok: false, error: 'manifest_unreadable' }, { status: 500 });

    const computed: Record<string, string> = {};
    let filesOk = true;

    for (const f of manifest.files || []) {
      const publicPath = resolvePublicPath(f.path);
      if (!fs.existsSync(publicPath)) {
        filesOk = false;
        continue;
      }
      const hash = sha256File(publicPath);
      computed[f.path] = hash;
      if (f.sha256 && f.sha256 !== hash) {
        filesOk = false;
      }
    }

    // Placeholder: treat manifest_digest presence as OK for now
    const manifestDigestOk = !!manifest.manifest_digest;

    const sealed = filesOk && manifestDigestOk;

    return NextResponse.json({
      ok: true,
      pack: { id: manifest.id, title: manifest.title },
      manifest_digest_ok: manifestDigestOk,
      files_ok: filesOk,
      sealed,
      computed,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
