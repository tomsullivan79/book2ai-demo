import { NextResponse } from 'next/server';

/** Small helpers (no `any`) */
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function toString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function chunkWords(text: string, minWords = 10, maxWords = 18): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let i = 0;
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  while (i < words.length) {
    const span = clamp(Math.floor((minWords + maxWords) / 2), minWords, maxWords);
    const take = Math.min(span, words.length - i);
    chunks.push(words.slice(i, i + take).join(' '));
    i += take;
  }
  return chunks;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const q = isObj(body) ? toString(body['q']) : '';
    if (!q.trim()) {
      return NextResponse.json({ error: 'Missing q' }, { status: 400 });
    }

    // Build absolute base URL from this request (works reliably on Vercel)
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    const proto = req.headers.get('x-forwarded-proto') ?? 'https';
    if (!host) {
      return NextResponse.json({ error: 'Unable to resolve host' }, { status: 500 });
    }
    const base = `${proto}://${host}`;

    // Call your existing non-streaming RAG endpoint
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

    const json: unknown = await upstream.json();
    const root = isObj(json) ? json : {};
    const answer = toString(root['answer']);
    const sources = Array.isArray(root['sources'])
      ? (root['sources'] as unknown[])
      : Array.isArray(root['top'])
      ? (root['top'] as unknown[])
      : [];

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        try {
          // 1) Send a tiny “meta” event so the client can prep state immediately
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'meta', q }) + '\n'));

          // 2) Stream the answer in word-chunks
          const chunks = chunkWords(answer, 10, 18);
          for (const delta of chunks) {
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'chunk', delta }) + '\n'));
          }

          // 3) Finish with sources + done flag
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ type: 'done', sources, totalChunks: chunks.length }) + '\n'
            )
          );

          controller.close();
        } catch (e) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ type: 'error', message: (e as Error).message || 'stream error' }) +
                '\n'
            )
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'internal error' },
      { status: 500 }
    );
  }
}
