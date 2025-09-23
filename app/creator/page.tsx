'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import IntegrityBadge from '../components/IntegrityBadge';

/** ---- Types ---- */
type Source = {
  id: string;
  page?: number | null;
  score?: number | null;
  text?: string | null;
};
type AskResult = {
  answer: string;
  sources: Source[];
};

type TopItem = { key: string; count: number };
type SeriesPoint = { day: string; count: number };
type Insights = {
  totals: { all_time: number; last_7_days: number };
  series_7d: SeriesPoint[];
  top_queries: TopItem[];
  top_pages: TopItem[];
  top_chunks: TopItem[];
};

/** ---- Helpers (no any) ---- */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** Normalize /api/ask payload into AskResult */
function normalizeAsk(raw: unknown): AskResult {
  const root = isObj(raw) ? raw : {};
  const answer = typeof root['answer'] === 'string' ? (root['answer'] as string) : '';

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

/** Normalize /api/insights payload (accept snake_case & camelCase) */
function normalizeInsights(raw: unknown): Insights {
  const r = (raw ?? {}) as Record<string, unknown>;

  // totals
  const totalsObj = (isObj(r.totals) ? (r.totals as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  const all_time =
    (typeof totalsObj['all_time'] === 'number' ? (totalsObj['all_time'] as number) : undefined) ??
    (typeof totalsObj['all'] === 'number' ? (totalsObj['all'] as number) : undefined) ??
    (typeof r['all_time'] === 'number' ? (r['all_time'] as number) : undefined) ??
    0;
  const last_7_days =
    (typeof totalsObj['last_7_days'] === 'number'
      ? (totalsObj['last_7_days'] as number)
      : undefined) ??
    (typeof totalsObj['last7'] === 'number' ? (totalsObj['last7'] as number) : undefined) ??
    (typeof r['last_7_days'] === 'number' ? (r['last_7_days'] as number) : undefined) ??
    0;

  // series
  const seriesArr: unknown[] = Array.isArray((r as Record<string, unknown>)['series_7d'])
    ? ((r as Record<string, unknown>)['series_7d'] as unknown[])
    : Array.isArray((r as Record<string, unknown>)['series'])
    ? ((r as Record<string, unknown>)['series'] as unknown[])
    : [];
  const series_7d: SeriesPoint[] = seriesArr
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      const day =
        typeof o['day'] === 'string' ? (o['day'] as string) : typeof o['date'] === 'string' ? (o['date'] as string) : '';
      const count =
        typeof o['count'] === 'number'
          ? (o['count'] as number)
          : typeof o['value'] === 'number'
          ? (o['value'] as number)
          : 0;
      return day ? { day, count } : null;
    })
    .filter(Boolean) as SeriesPoint[];

  // tops (snake_case or camelCase)
  const tqArr: unknown[] =
    Array.isArray(r['top_queries'])
      ? (r['top_queries'] as unknown[])
      : Array.isArray(r['topQueries'])
      ? (r['topQueries'] as unknown[])
      : Array.isArray((r as Record<string, unknown>)['top']?.['queries'])
      ? (((r as Record<string, unknown>)['top'] as Record<string, unknown>)['queries'] as unknown[])
      : [];
  const tpArr: unknown[] =
    Array.isArray(r['top_pages'])
      ? (r['top_pages'] as unknown[])
      : Array.isArray(r['topPages'])
      ? (r['topPages'] as unknown[])
      : Array.isArray((r as Record<string, unknown>)['top']?.['pages'])
      ? (((r as Record<string, unknown>)['top'] as Record<string, unknown>)['pages'] as unknown[])
      : [];
  const tcArr: unknown[] =
    Array.isArray(r['top_chunks'])
      ? (r['top_chunks'] as unknown[])
      : Array.isArray(r['topChunks'])
      ? (r['topChunks'] as unknown[])
      : Array.isArray((r as Record<string, unknown>)['top']?.['chunks'])
      ? (((r as Record<string, unknown>)['top'] as Record<string, unknown>)['chunks'] as unknown[])
      : [];

  const mapTop = (arr: unknown[]) =>
    arr
      .map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        const key =
          typeof o['key'] === 'string'
            ? (o['key'] as string)
            : typeof o['id'] === 'string'
            ? (o['id'] as string)
            : typeof o['name'] === 'string'
            ? (o['name'] as string)
            : '';
        const count =
          typeof o['count'] === 'number'
            ? (o['count'] as number)
            : typeof o['value'] === 'number'
            ? (o['value'] as number)
            : 0;
        return key ? { key, count } : null;
      })
      .filter(Boolean) as TopItem[];

  return {
    totals: { all_time, last_7_days },
    series_7d,
    top_queries: mapTop(tqArr),
    top_pages: mapTop(tpArr),
    top_chunks: mapTop(tcArr),
  };
}

/** ---- Page state ---- */
const LS_KEY_LAST_Q = 'b2ai:lastQ';

export default function CreatorPage() {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);

  const [toast, setToast] = useState<{ msg: string; sub?: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Persisted query
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY_LAST_Q);
      if (saved) setQ(saved);
    } catch {
      /* no-op */
    }
  }, []);

  // ask
  async function ask(query: string) {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: query }),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: unknown = await res.json();
      const normalized = normalizeAsk(json);
      setResult(normalized);

      try {
        localStorage.setItem(LS_KEY_LAST_Q, query);
      } catch {
        /* no-op */
      }

      void showLoggedToast();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to get answer');
    } finally {
      setLoading(false);
    }
  }

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    await ask(q);
  }

  async function showLoggedToast() {
    try {
      const r = await fetch('/api/insights', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      const j: unknown = await r.json();
      let last7: number | null = null;
      if (isObj(j)) {
        const totals = j['totals'];
        if (isObj(totals)) {
          if (typeof totals['last_7_days'] === 'number') last7 = totals['last_7_days'] as number;
          else if (typeof totals['last7'] === 'number') last7 = totals['last7'] as number;
        } else {
          if (typeof j['last_7_days'] === 'number') last7 = j['last_7_days'] as number;
          else if (typeof j['last7'] === 'number') last7 = j['last7'] as number;
        }
      }
      setToast({ msg: 'Query logged', sub: last7 !== null ? `Last 7 days: ${last7}` : undefined });
    } catch {
      setToast({ msg: 'Query logged', sub: undefined });
    } finally {
      setTimeout(() => setToast(null), 4000);
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

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-zinc-900 dark:text-zinc-100">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Ask the Pack</h1>
        <IntegrityBadge />
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6">
        Query the <span className="font-medium">Scientific Advertising</span> pack and cite sources.
      </p>

      <form onSubmit={onAsk} className="mb-4 flex items-center gap-2">
        <input
          ref={inputRef}
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
                <li key={`${s.id}-${s.page ?? ''}`} className="border-t border-zinc-200 py-1 dark:border-zinc-800">
                  <span className="font-mono">{s.id}</span>
                  {typeof s.page === 'number' && (
                    <span className="text-zinc-600 dark:text-zinc-300"> (p.{s.page})</span>
                  )}
                  {typeof s.score === 'number' && (
                    <span className="ml-1 text-xs text-zinc-500">• score {s.score.toFixed(3)}</span>
                  )}
                  {s.text && (
                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 line-clamp-3">{s.text}</div>
                  )}
                </li>
              ))}
              {result.sources.length === 0 && (
                <li className="border-t border-zinc-200 py-1 text-zinc-500 dark:border-zinc-800">No sources returned</li>
              )}
            </ul>
          </div>
        </section>
      )}

      {/* Toast */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
      >
        {toast && (
          <div className="pointer-events-auto max-w-md rounded-xl border border-zinc-300 bg-white/95 px-4 py-3 text-sm shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/90">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">✅ {toast.msg}</div>
                {toast.sub && <div className="text-xs text-zinc-600 dark:text-zinc-300">{toast.sub}</div>}
              </div>
              <a
                href="/creator"
                className="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
              >
                Open Creator
              </a>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
