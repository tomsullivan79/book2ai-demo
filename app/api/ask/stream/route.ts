export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

/** ---- tiny helpers ---- */
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function s(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// Preserve all original whitespace (newlines, spacing)
function chunkByChars(text: string, size = 48): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

async function fetchUpstream(req: Request, q: string, pack: string) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  if (!host) throw new Error('No host');
  const base = `${proto}://${host}`;

  const upstream = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q, pack }),
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const raw = await upstream.text();
    throw new Error(`upstream_failed:${upstream.status}:${raw.slice(0, 200)}`);
  }

  const json: unknown = await upstream.json();
  const root = isObj(json) ? json : {};
  const answer = s(root['answer']);
  const sources = Array.isArray(root['sources'])
    ? (root['sources'] as unknown[])
    : Array.isArray(root['top'])
    ? (root['top'] as unknown[])
    : [];
  return { answer, sources };
}

function sseResponse(q: string, answer: string, sources: unknown[]) {
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      send({ type: 'meta', q });

      const chunks = chunkByChars(answer, 48); // ~50 chars feels “typey” and preserves \n
      let i = 0;

      const pump = () => {
        if (i < chunks.length) {
          send({ type: 'chunk', delta: chunks[i++] });
          setTimeout(pump, 15); // small nudge for smooth flush
        } else {
          send({ type: 'done', sources, totalChunks: chunks.length });
          controller.close();
        }
      };
      pump();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-no-compression': '1',
    },
  });
}

/** GET /api/ask/stream?q=...&pack=...  (preferred path for EventSource) */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') || '';
  const pack = url.searchParams.get('pack') || '';
  if (!q.trim()) return NextResponse.json({ error: 'Missing q' }, { status: 400 });

  try {
    const { answer, sources } = await fetchUpstream(req, q, pack);
    return sseResponse(q, answer, sources);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** POST still supported for programmatic callers; forwards `pack` as well */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const q = isObj(body) ? s(body['q']) : '';
    const pack = isObj(body) ? s(body['pack']) : '';
    if (!q.trim()) return NextResponse.json({ error: 'Missing q' }, { status: 400 });

    const { answer, sources } = await fetchUpstream(req, q, pack);
    return sseResponse(q, answer, sources);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || 'internal error' }, { status: 500 });
  }
}
