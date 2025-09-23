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
function chunkWords(text: string, min = 5, max = 10): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let i = 0;
  const mid = (min + max) >> 1;
  while (i < words.length) {
    const take = Math.min(mid, words.length - i);
    chunks.push(words.slice(i, i + take).join(' '));
    i += take;
  }
  return chunks;
}

async function getUpstreamAnswer(req: Request, q: string) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  if (!host) throw new Error('No host');
  const base = `${proto}://${host}`;

  const upstream = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q }),
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const raw = await upstream.text();
    throw new Error(`upstream_failed:${upstream.status}:${raw.slice(0, 200)}`);
  }

  const data: unknown = await upstream.json();
  const root = isObj(data) ? data : {};
  const answer = s(root.answer);
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

      // meta
      send({ type: 'meta', q });

      // short chunks encourage visible typing
      const chunks = chunkWords(answer, 4, 8);
      let i = 0;

      const pump = () => {
        if (i < chunks.length) {
          send({ type: 'chunk', delta: chunks[i++] });
          // Tiny delay lets proxies flush; 15–30ms looks smooth
          setTimeout(pump, 20);
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
      // common anti-buffering hint:
      'x-accel-buffering': 'no',
      // some stacks honor this:
      'x-no-compression': '1',
    },
  });
}

/** GET /api/ask/stream?q=... (SSE) */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') || '';
  if (!q.trim()) return NextResponse.json({ error: 'Missing q' }, { status: 400 });

  try {
    const { answer, sources } = await getUpstreamAnswer(req, q);
    return sseResponse(q, answer, sources);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** POST still supported (for programmatic callers) */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const q = isObj(body) ? s(body.q) : '';
    if (!q.trim()) return NextResponse.json({ error: 'Missing q' }, { status: 400 });

    const { answer, sources } = await getUpstreamAnswer(req, q);
    return sseResponse(q, answer, sources);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || 'internal error' }, { status: 500 });
  }
}
