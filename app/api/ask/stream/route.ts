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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const q = isObj(body) ? s(body.q) : '';
    if (!q.trim()) {
      return NextResponse.json({ error: 'Missing q' }, { status: 400 });
    }

    // Build absolute base URL from the current request
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    const proto = req.headers.get('x-forwarded-proto') ?? 'https';
    if (!host) return NextResponse.json({ error: 'No host' }, { status: 500 });
    const base = `${proto}://${host}`;

    // Call your existing /api/ask (non-streaming)
    const upstream = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q }),
      cache: 'no-store',
    });
    if (!upstream.ok) {
      const raw = await upstream.text();
      return new Response(
        JSON.stringify({ error: 'upstream_failed', status: upstream.status, raw }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }
    const data: unknown = await upstream.json();
    const root = isObj(data) ? data : {};
    const answer = s(root.answer);
    const sources = Array.isArray(root['sources'])
      ? (root['sources'] as unknown[])
      : Array.isArray(root['top'])
      ? (root['top'] as unknown[])
      : [];

    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (obj: unknown) => {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };

        // meta
        send({ type: 'meta', q });

        // stream the answer in short chunks; 0ms timers encourage flush on Edge
        const chunks = chunkWords(answer, 5, 10);
        let i = 0;
        const pump = () => {
          if (i < chunks.length) {
            send({ type: 'chunk', delta: chunks[i++] });
            setTimeout(pump, 0);
          } else {
            // done + sources
            send({ type: 'done', sources, totalChunks: chunks.length });
            controller.close();
          }
        };
        pump();
      },
    });

    return new Response(stream, {
      headers: {
        // SSE is least likely to be buffered by intermediaries
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive',
        // hint to proxies/CDNs that this should flow as chunks
        'x-accel-buffering': 'no',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'internal error' },
      { status: 500 }
    );
  }
}
