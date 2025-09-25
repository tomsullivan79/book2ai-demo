'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import IntegrityBadge from './components/IntegrityBadge';
import PackPicker from './components/PackPicker';

/** ---- Types ---- */
type Source = { id: string; page?: number | null; score?: number | null; text?: string | null };
type AskResult = { answer: string; sources: Source[] };

/** ---- Helpers ---- */
function normalizePackId(id: string | null | undefined): string {
  const raw = (id ?? '').trim().toLowerCase();
  if (!raw) return 'scientific-advertising';
  if (
    raw === 'hopkins-scientific-advertising' ||
    raw === 'hopkins' ||
    raw === 'scientific' ||
    raw === 'scientific_advertising'
  ) {
    return 'scientific-advertising';
  }
  if (raw === 'scientific-advertising') return 'scientific-advertising';
  if (raw === 'optimal-poker') return 'optimal-poker';
  return raw;
}

// Client shim for SA (server middleware also normalizes)
function apiPackId(id: string): string {
  return id === 'scientific-advertising' ? 'hopkins-scientific-advertising' : id;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
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

/** Strip inline ref tokens like [#4 id=poker.c0031] (do NOT touch line breaks) */
function stripInlineRefs(s: string): string {
  // Remove bracketed tokens only; preserve all whitespace/newlines
  return s.replace(/\[\s*#\d+\s+id\s*=\s*[^|\]\s]+(?:\s*[^|\]]*)?\]/gi, '');
}

const LS_KEY_LAST_Q = 'b2ai:lastQ';
const LS_KEY_PACK = 'b2ai:pack';

// Friendly label
function packLabel(id: string | null | undefined): string {
  if (!id) return 'Selected Pack';
  if (id === 'scientific-advertising') return 'Scientific Advertising';
  if (id === 'optimal-poker') return 'Optimal Poker';
  return id;
}

export default function HomePage() {
  const [q, setQ] = useState('');
  const [pack, setPack] = useState<string>('scientific-advertising');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);

  const [toast, setToast] = useState<{ msg: string; sub?: string } | null>(null);
  const [copiedAnswer, setCopiedAnswer] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const autoRanRef = useRef(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const urlQ = u.searchParams.get('q');
      const urlPackRaw = u.searchParams.get('pack');
      const savedPack = localStorage.getItem(LS_KEY_PACK);
      const initPack = normalizePackId(urlPackRaw ?? savedPack ?? 'scientific-advertising');
      setPack(initPack);
      if (initPack !== (urlPackRaw ?? '')) {
        u.searchParams.set('pack', initPack);
        window.history.replaceState(null, '', u.toString());
      } else if (!urlPackRaw) {
        u.searchParams.set('pack', initPack);
        window.history.replaceState(null, '', u.toString());
      }
      if (urlQ && !q) setQ(urlQ);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pack) return;
    try {
      localStorage.setItem(LS_KEY_PACK, pack);
      const u = new URL(window.location.href);
      u.searchParams.set('pack', pack);
      window.history.replaceState(null, '', u.toString());
    } catch {}
  }, [pack]);

  const cancelStream = useCallback(() => {
    if (esRef.current) {
      try { esRef.current.close(); } catch {}
      esRef.current = null;
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && esRef.current) {
        e.preventDefault();
        cancelStream();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelStream]);

  const clearAll = useCallback(() => {
    cancelStream();
    setQ('');
    setError(null);
    setResult(null);
    setCopiedAnswer(null);
    setCopiedLink(null);
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('q');
      u.searchParams.delete('run');
      if (pack) u.searchParams.set('pack', pack);
      window.history.replaceState(null, '', u.toString());
    } catch {}
    try { localStorage.removeItem(LS_KEY_LAST_Q); } catch {}
  }, [cancelStream, pack]);

  const ask = useCallback(
    async (query: string, opts?: { preserveRun?: boolean }) => {
      if (!query.trim()) return;

      if (esRef.current) {
        try { esRef.current.close(); } catch {}
        esRef.current = null;
      }

      setLoading(true);
      setError(null);
      setResult({ answer: '', sources: [] });

      try {
        const u = new URL(window.location.href);
        u.searchParams.set('q', query);
        if (pack) u.searchParams.set('pack', pack);
        if (!opts?.preserveRun) u.searchParams.delete('run');
        window.history.replaceState(null, '', u.toString());
      } catch {}
      try { localStorage.setItem(LS_KEY_LAST_Q, query); } catch {}

      try {
        const url = `/api/ask/stream?q=${encodeURIComponent(query)}${
          pack ? `&pack=${encodeURIComponent(apiPackId(pack))}` : ''
        }`;
        const es = new EventSource(url);
        esRef.current = es;

        es.onmessage = (ev) => {
          const payload = ev.data;
          if (!payload) return;
          let evt: unknown;
          try { evt = JSON.parse(payload); } catch { return; }
          if (!isObj(evt)) return;
          const type = typeof evt['type'] === 'string' ? (evt['type'] as string) : '';

          if (type === 'chunk') {
            const delta = typeof evt['delta'] === 'string' ? (evt['delta'] as string) : '';
            setResult((prev) => {
              const cur = prev ?? { answer: '', sources: [] };
              return { ...cur, answer: cur.answer + delta };
            });
          } else if (type === 'done') {
            const srcArr = Array.isArray(evt['sources']) ? (evt['sources'] as unknown[]) : [];
            const normalizedSources = normalizeAsk({ answer: '', sources: srcArr }).sources;

            // Use the latest streamed text, preserve newlines, just remove inline tokens
            setResult((prev) => {
              const finalAnswer = stripInlineRefs(prev?.answer ?? '');
              return { answer: finalAnswer, sources: normalizedSources };
            });

            void showLoggedToast();
            try { es.close(); } catch {}
            esRef.current = null;
            setLoading(false);
          } else if (type === 'error') {
            const msg = typeof evt['message'] === 'string' ? (evt['message'] as string) : 'stream error';
            setError(msg);
          }
        };

        es.onerror = () => {
          try { es.close(); } catch {}
          esRef.current = null;
          setLoading(false);
          setError((prev) => prev || 'Stream error');
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg || 'Failed to get answer');
        setLoading(false);
      }
    },
    [pack]
  );

  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const urlQ = u.searchParams.get('q');
      const forceRun = u.searchParams.get('run') === '1';
      const saved = localStorage.getItem(LS_KEY_LAST_Q) || '';
      if (urlQ) {
        setQ(urlQ);
        if (!autoRanRef.current && (forceRun || !saved)) {
          autoRanRef.current = true;
          void ask(urlQ, { preserveRun: true });
        }
      }
    } catch {}
  }, [ask]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setQ(next);
    try { localStorage.setItem(LS_KEY_LAST_Q, next); } catch {}
  }
  function getShareUrl(forQ: string): string {
    const current = new URL(window.location.href);
    current.searchParams.set('q', forQ);
    current.searchParams.delete('run');
    if (pack) current.searchParams.set('pack', pack);
    return current.toString();
  }
  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    await ask(q, { preserveRun: false });
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
    lines.push((result.answer ?? '').trim());
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
  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(getShareUrl(q));
      setCopiedLink('Link copied!');
    } catch {
      setCopiedLink('Copy failed');
    } finally {
      setTimeout(() => setCopiedLink(null), 1500);
    }
  }

  const subtitle = `Query the ${packLabel(pack)} pack and cite sources.`;
  const placeholder =
    pack === 'optimal-poker'
      ? 'e.g., When should I polarize my range?'
      : "e.g., What is Hopkins’ view on testing?";

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-zinc-900 dark:text-zinc-100">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Ask the Pack</h1>
        <div className="flex items-center gap-2">
          <PackPicker
            value={pack}
            onChange={(p: string) => {
              setPack(p);
              clearAll();
              try {
                const u = new URL(window.location.href);
                u.searchParams.set('pack', p);
                u.searchParams.delete('q');
                u.searchParams.delete('run');
                window.history.replaceState(null, '', u.toString());
              } catch {}
            }}
          />
          <IntegrityBadge />
        </div>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6">{subtitle}</p>

      <form onSubmit={onAsk} className="mb-3 flex items-center gap-2">
        <input
          ref={inputRef}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-900"
          placeholder={placeholder}
          value={q}
          onChange={handleChange}
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          {loading ? 'Streaming…' : 'Ask'}
        </button>
        {loading && (
          <button
            type="button"
            onClick={cancelStream}
            className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-600 dark:text-red-200 dark:hover:bg-red-900/30"
            title="Stop streaming (Esc)"
          >
            Stop
          </button>
        )}
        {q.trim().length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            disabled={loading}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-800"
            title="Clear the query and reset answer/sources"
          >
            Clear
          </button>
        )}
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
              <button
                onClick={copyShareLink}
                disabled={!q.trim()}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-800"
              >
                Copy share link
              </button>
              {copiedAnswer && <span className="text-xs text-zinc-600 dark:text-zinc-300">{copiedAnswer}</span>}
              {copiedLink && <span className="text-xs text-zinc-600 dark:text-zinc-300">{copiedLink}</span>}
            </div>
          </div>

          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
            {result.answer || (loading ? '…' : '')}
          </p>

          <div className="mt-4">
            <div className="text-sm font-medium mb-1">Top Sources</div>
            <ul className="text-sm">
              {result.sources.map((s) => {
                const href = `/source?chunk=${encodeURIComponent(s.id)}#${encodeURIComponent(s.id)}`;
                return (
                  <li key={`${s.id}-${s.page ?? ''}`} className="border-t border-zinc-200 py-2 dark:border-zinc-800">
                    <div className="flex items-baseline gap-2">
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono underline underline-offset-2 hover:no-underline break-all"
                        title={`Open ${s.id} in Source Browser`}
                      >
                        {s.id}
                      </a>
                      {typeof s.page === 'number' && (
                        <span className="text-zinc-600 dark:text-zinc-300"> (p.{s.page})</span>
                      )}
                    </div>
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
                  {loading ? 'Fetching sources…' : 'No sources returned'}
                </li>
              )}
            </ul>
          </div>
        </section>
      )}

      {/* Toast */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
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
