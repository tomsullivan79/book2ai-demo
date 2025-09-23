'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import IntegrityBadge from './components/IntegrityBadge';

/** ---- Types tolerant to small API shape changes ---- */
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

const LS_KEY_LAST_Q = 'b2ai:lastQ';

export default function HomePage() {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);

  // Toast + copy states
  const [toast, setToast] = useState<{ msg: string; sub?: string } | null>(null);
  const [copiedAnswer, setCopiedAnswer] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  // Refs
  const inputRef = useRef<HTMLInputElement>(null);
  const autoRanRef = useRef(false);

  /* ---------- Focus input on mount ---------- */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* ---------- Restore from localStorage (once) ---------- */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY_LAST_Q);
      if (saved && !q) setQ(saved);
    } catch {
      /* no-op */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Core ask (memoized). opts.preserveRun keeps &run=1 if true ---------- */
  const ask = useCallback(
    async (query: string, opts?: { preserveRun?: boolean }) => {
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

        // Update URL to ?q=... without reloading (shareable)
        try {
          const current = new URL(window.location.href);
          current.searchParams.set('q', query);
          if (!opts?.preserveRun) {
            current.searchParams.delete('run');
          }
          window.history.replaceState(null, '', current.toString());
        } catch {
          /* no-op */
        }

        // Keep last q persisted
        try {
          localStorage.setItem(LS_KEY_LAST_Q, query);
        } catch {
          /* no-op */
        }

        // Logged toast + mini-insights
        void showLoggedToast();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg || 'Failed to get answer');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /* ---------- Read ?q= from URL. Autorun only if: has q AND (no saved) OR ?run=1 ---------- */
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const urlQ = u.searchParams.get('q');
      const forceRun = u.searchParams.get('run') === '1';
      const saved = localStorage.getItem(LS_KEY_LAST_Q) || '';

      if (urlQ) {
        setQ(urlQ); // Always reflect URL text in the input
        if (!autoRanRef.current && (forceRun || !saved)) {
          autoRanRef.current = true;
          // preserve &run=1 on this autorun call
          void ask(urlQ, { preserveRun: true });
        }
      }
    } catch {
      /* no-op */
    }
  }, [ask]);

  /* ---------- Persist query on change ---------- */
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setQ(next);
    try {
      localStorage.setItem(LS_KEY_LAST_Q, next);
    } catch {
      /* no-op */
    }
  }

  /* ---------- Build share URL (no &run by default) ---------- */
  function getShareUrl(forQ: string): string {
    const current = new URL(window.location.href);
    current.searchParams.set('q', forQ);
    current.searchParams.delete('run');
    return current.toString();
  }

  /* ---------- Form submit ---------- */
  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    await ask(q, { preserveRun: false });
  }

  /* ---------- Logged toast with last-7d stat ---------- */
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

  /* ---------- Clipboard: Answer + Citations ---------- */
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
      setCopiedAnswer('Copied!');
    } catch {
      setCopiedAnswer('Copy failed');
    } finally {
      setTimeout(() => setCopiedAnswer(null), 1500);
    }
  }

  /* ---------- Clipboard: Share link ---------- */
  async function copyShareLink() {
    try {
      const link = getShareUrl(q);
      await navigator.clipboard.writeText(link);
      setCopiedLink('Link copied!');
    } catch {
      setCopiedLink('Copy failed');
    } finally {
      setTimeout(() => setCopiedLink(null), 1500);
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

      <form onSubmit={onAsk} className="mb-3 flex items-center gap-2">
        <input
          ref={inputRef}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-900"
          placeholder="e.g., What is Hopkins’ view on testing?"
          value={q}
          onChange={handleChange}
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          {loading ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {/* Share link row */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={copyShareLink}
          disabled={!q.trim()}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          Copy share link
        </button>
        {copiedLink && <span className="text-xs text-zinc-600 dark:text-zinc-300">{copiedLink}</span>}
        <span className="text-xs text-zinc-600 dark:text-zinc-400">
          Tip: shareable URL uses <span className="font-mono">?q=</span>
        </span>
      </div>

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
              {copiedAnswer && (
                <span className="text-xs text-zinc-600 dark:text-zinc-300">{copiedAnswer}</span>
              )}
            </div>
          </div>

          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{result.answer}</p>

          <div className="mt-4">
            <div className="text-sm font-medium mb-1">Top Sources</div>
            <ul className="text-sm">
              {result.sources.map((s) => {
                const href = `/source?chunk=${encodeURIComponent(s.id)}#${encodeURIComponent(s.id)}`;
                return (
                  <li key={`${s.id}-${s.page ?? ''}`} className="border-t border-zinc-200 py-1 dark:border-zinc-800">
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono underline underline-offset-2 hover:no-underline"
                      title="Open in Source Browser"
                    >
                      {s.id}
                    </a>
                    {typeof s.page === 'number' && (
                      <span className="text-zinc-600 dark:text-zinc-300"> (p.{s.page})</span>
                    )}
                    {typeof s.score === 'number' && (
                      <span className="ml-1 text-xs text-zinc-500">• score {s.score.toFixed(3)}</span>
                    )}
                    {s.text && (
                      <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 line-clamp-3">
                        {s.text}
                      </div>
                    )}
                  </li>
                );
              })}
              {result.sources.length === 0 && (
                <li className="border-t border-zinc-200 py-1 text-zinc-500 dark:border-zinc-800">
                  No sources returned
                </li>
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
