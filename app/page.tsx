'use client';

import React, { useMemo, useState } from 'react';

/** ---- Types that are tolerant to small API shape changes ---- */
type Source = {
  id: string;           // normalized id (chunk id or path)
  page?: number | null; // page number if present
  score?: number | null;
  text?: string | null;
};

type AskResult = {
  answer: string;
  sources: Source[];
};

/** ---- Small helpers (no `any`) ---- */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** Normalize whatever /api/ask returns into AskResult */
function normalizeAsk(raw: unknown): AskResult {
  const root = isObj(raw) ? raw : {};
  const answer = typeof root['answer'] === 'string' ? (root['answer'] as string) : '';

  // handle root.top (array) OR root.sources
  const arr =
    (Array.isArray(root['sources']) ? (root['sources'] as unknown[]) : null) ??
    (Array.isArray(root['top']) ? (root['top'] as unknown[]) : []);

  const sources: Source[] = [];
  for (const item of arr) {
    if (!isObj(item)) continue;
    const id =
      typeof item['id'] === 'string'
        ? (item['id'] as string)
        : typeof item['chunk_id'] === 'string'
        ? (item['chunk_id'] as string)
        : typeof item['path'] === 'string'
        ? (item['path'] as string)
        : 'unknown';
    const page = toNumber(item['page']);
    const score = toNumber(item['score']);
    const text =
      typeof item['text'] === 'string'
        ? (item['text'] as string)
        : typeof item['snippet'] === 'string'
        ? (item['snippet'] as string)
        : null;

    sources.push({ id, page, score, text });
  }

  return { answer, sources };
}

export default function HomePage() {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q }),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setResult(normalizeAsk(json));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to get answer');
    } finally {
      setLoading(false);
    }
  }

  const clipboardText = useMemo(() => {
    if (!result) return '';
    const lines: string[] = [];
    lines.push(result.answer.trim());
    if (result.sources.length > 0) {
      lines.push('');
      lines.push('— Sources:');
      for (const s of result.sources) {
        const pagePart = typeof s.page === 'number' ? ` (p.${s.page})` : '';
        lines.push(`• ${s.id}${pagePart}`);
      }
    }
    return lines.join('\n');
  }, [result]);

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(clipboardText);
      setCopied('Copied!');
    } catch {
      setCopied('Copy failed');
    } finally {
      setTimeout(() => setCopied(null), 1500);
    }
  }

  const [copied, setCopied] = useState<string | null>(null);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-zinc-900 dark:text-zinc-100">
      <h1 className="text-2xl font-semibold mb-2">Ask the Pack</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6">
        Query the <span className="font-medium">Scientific Advertising</span> pack and cite sources.
      </p>

      <form onSubmit={onAsk} className="mb-4 flex items-center gap-2">
        <input
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-900"
          placeholder="e.g., What is Hopkins’ view on testing?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          {loading ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-100 text-red-900 p-3 dark:border-red-700 dark:bg-red-900/40 dark:text-red-100">
          {error}
        </div>
      )}

      {result && (
        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">Answer</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={copyAnswer}
                disabled={!clipboardText}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-800"
              >
                Copy Answer + Citations
              </button>
              {copied && <span className="text-xs text-zinc-600 dark:text-zinc-300">{copied}</span>}
            </div>
          </div>

          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{result.answer}</p>

          <div className="mt-4">
            <div className="text-sm font-medium mb-1">Top Sources</div>
            <ul className="text-sm">
              {result.sources.map((s) => (
                <li
                  key={`${s.id}-${s.page ?? ''}`}
                  className="border-t border-zinc-200 py-1 dark:border-zinc-800"
                >
                  <span className="font-mono">{s.id}</span>
                  {typeof s.page === 'number' && <span className="text-zinc-600 dark:text-zinc-300"> (p.{s.page})</span>}
                  {typeof s.score === 'number' && (
                    <span className="ml-1 text-xs text-zinc-500">• score {s.score.toFixed(3)}</span>
                  )}
                  {s.text && <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 line-clamp-3">{s.text}</div>}
                </li>
              ))}
              {result.sources.length === 0 && (
                <li className="border-t border-zinc-200 py-1 text-zinc-500 dark:border-zinc-800">
                  No sources returned
                </li>
              )}
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}
