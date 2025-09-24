'use client';

import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type Source = {
  title?: string;
  url?: string;
  page?: number | string;
  snippet?: string;
};

type AskStreamChunk = {
  type: 'text' | 'final' | 'sources' | 'error';
  text?: string;
  answer?: string;
  sources?: Source[];
  error?: string;
};

const PACKS = [
  { id: 'scientific-advertising', title: 'Scientific Advertising' },
  { id: 'optimal-poker', title: 'Optimal Poker' },
];

// Normalize legacy ids to current ids
function normalizePackId(id: string | null): string {
  if (!id) return 'scientific-advertising';
  if (id === 'hopkins-scientific-advertising') return 'scientific-advertising';
  return PACKS.some(p => p.id === id) ? id : 'scientific-advertising';
}

export default function HomePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL state
  const initialPack = normalizePackId(searchParams.get('pack'));
  const initialQ = searchParams.get('q') ?? '';
  const initialRun = searchParams.get('run');

  // UI state
  const [pack, setPack] = useState<string>(initialPack);
  const [q, setQ] = useState<string>(initialQ);
  const [answer, setAnswer] = useState<string>('');
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const controllerRef = useRef<AbortController | null>(null);

  // Keep URL normalized on first mount (legacy pack ids → current)
  useEffect(() => {
    const normalized = normalizePackId(searchParams.get('pack'));
    if (normalized !== searchParams.get('pack')) {
      const p = new URLSearchParams(searchParams.toString());
      p.set('pack', normalized);
      // preserve q/run if present
      router.replace(`${pathname}?${p.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autorun (only when URL explicitly contains run=1 and q)
  useEffect(() => {
    if (initialRun && initialQ.trim().length > 0) {
      void onAsk(initialQ);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helpers — URL sync (replace, not push, to avoid history spam)
  const replaceUrl = React.useCallback(
    (params: Record<string, string | null>) => {
      const p = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(params)) {
        if (v === null) p.delete(k);
        else p.set(k, v);
      }
      router.replace(`${pathname}?${p.toString()}`);
    },
    [router, pathname, searchParams]
  );

  // ---- Item 1 additions: CLEAR + Pack-change clearing ----
  const canClear = useMemo(() => q.trim().length > 0 || answer || sources.length > 0 || error, [q, answer, sources, error]);

  const hardClearUI = React.useCallback(() => {
    // stop any active stream
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    setQ('');
    setAnswer('');
    setSources([]);
    setError(null);
    setLoading(false);
  }, []);

  const handleClearClick = React.useCallback(() => {
    hardClearUI();
    // preserve pack, remove q and run from URL
    replaceUrl({ q: null, run: null, pack });
  }, [hardClearUI, replaceUrl, pack]);

  const handlePackChange = React.useCallback(
    (nextPack: string) => {
      setPack(nextPack);
      // Clear any current query/answer state
      hardClearUI();
      // Update URL to only contain the new pack; remove q/run; prevent autorun
      replaceUrl({ pack: nextPack, q: null, run: null });
    },
    [hardClearUI, replaceUrl]
  );
  // --------------------------------------------------------

  async function onAsk(nextQ?: string) {
    const askQ = (nextQ ?? q).trim();
    if (!askQ) return;

    // Reset state for a fresh run
    setAnswer('');
    setSources([]);
    setError(null);
    setLoading(true);

    // Sync URL for shareability (include run=1)
    replaceUrl({ pack, q: askQ, run: '1' });

    // Abort controller for streaming
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      // NOTE: This assumes your existing /api/ask streaming endpoint.
      // It should work unchanged. We only added CLEAR + URL behaviors.
      const res = await fetch(`/api/ask?pack=${encodeURIComponent(pack)}`, {
        method: 'POST',
        body: JSON.stringify({ q: askQ }),
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      });

      if (!res.ok || !res.body) {
        const msg = `Request failed: ${res.status} ${res.statusText}`;
        setError(msg);
        setToast('Error: request failed');
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunkText = decoder.decode(value, { stream: true });
          // Expect NDJSON or SSE-like lines; handle defensively
          const lines = chunkText.split(/\r?\n/).filter(Boolean);
          for (const line of lines) {
            let data: AskStreamChunk | null = null;
            try {
              data = JSON.parse(line) as AskStreamChunk;
            } catch {
              // Fallback: treat as plain text
              setAnswer(prev => prev + line);
              continue;
            }
            if (!data) continue;

            if (data.type === 'text' && data.text) {
              setAnswer(prev => prev + data.text);
            } else if (data.type === 'sources' && Array.isArray(data.sources)) {
              setSources(data.sources);
            } else if (data.type === 'final') {
              if (data.answer) setAnswer(data.answer);
              if (Array.isArray(data.sources)) setSources(data.sources);
            } else if (data.type === 'error' && data.error) {
              setError(data.error);
            }
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setError('Network error');
        setToast('Error: network issue');
      }
    } finally {
      setLoading(false);
      controllerRef.current = null;
    }
  }

  const onCopyAnswer = async () => {
    try {
      await navigator.clipboard.writeText(answer || '');
      setToast('Answer copied');
    } catch {
      setToast('Copy failed');
    }
  };

  const onCopyShare = async () => {
    try {
      const url = new URL(window.location.href);
      // ensure share link carries q + pack (no need to carry run)
      url.searchParams.set('pack', pack);
      if (q.trim()) url.searchParams.set('q', q.trim());
      url.searchParams.delete('run');
      await navigator.clipboard.writeText(url.toString());
      setToast('Share link copied');
    } catch {
      setToast('Copy failed');
    }
  };

  // auto-hide toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  const selectedPack = useMemo(() => PACKS.find(p => p.id === pack), [pack]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold mb-3">Ask the Pack</h1>

      <div className="flex items-center gap-2 mb-1">
        <label htmlFor="pack" className="text-sm text-gray-500">Pack</label>
        <select
          id="pack"
          className="border rounded px-2 py-1"
          value={pack}
          onChange={(e) => handlePackChange(e.target.value)}
        >
          {PACKS.map(p => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>

        {/* Integrity badge/link (kept) */}
        <a
          href={`/pack?pack=${encodeURIComponent(pack)}`}
          className="text-xs underline ml-auto"
        >
          Checking…
        </a>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Query the {selectedPack?.title ?? 'pack'} pack and cite sources.
      </p>

      <div className="flex gap-2 items-start">
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask a question…"
          className="flex-1 border rounded p-3 min-h-[96px]"
          disabled={loading}
        />

        <div className="flex flex-col gap-2">
          <button
            onClick={() => onAsk()}
            disabled={loading || q.trim().length === 0}
            className="px-4 py-2 border rounded disabled:opacity-50"
            aria-label="Ask"
          >
            {loading ? 'Asking…' : 'Ask'}
          </button>

          {/* NEW: Clear button (only visible when there’s something to clear) */}
          {canClear && (
            <button
              onClick={handleClearClick}
              disabled={loading}
              className="px-4 py-2 border rounded disabled:opacity-50"
              aria-label="Clear"
              title="Clear the query and reset the current answer and sources"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={onCopyAnswer}
          disabled={!answer}
          className="px-3 py-2 border rounded text-sm disabled:opacity-50"
        >
          Copy Answer
        </button>
        <button
          onClick={onCopyShare}
          disabled={q.trim().length === 0}
          className="px-3 py-2 border rounded text-sm disabled:opacity-50"
        >
          Copy Share Link
        </button>
      </div>

      {error && (
        <div className="mt-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {answer && (
        <section className="mt-6">
          <h2 className="font-medium mb-2">Answer</h2>
          <div className="whitespace-pre-wrap border rounded p-3">
            {answer}
          </div>
        </section>
      )}

      {sources.length > 0 && (
        <section className="mt-6">
          <h3 className="font-medium mb-2">Sources</h3>
          <ul className="list-disc ml-5 space-y-2">
            {sources.map((s, i) => (
              <li key={i}>
                {s.url ? (
                  <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                    {s.title ?? s.url}
                  </a>
                ) : (
                  <span>{s.title ?? 'Source'}</span>
                )}
                {s.page ? <span className="text-gray-500"> — p.{String(s.page)}</span> : null}
                {s.snippet ? <div className="text-gray-600 text-sm mt-1">{s.snippet}</div> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* lightweight toasts to keep existing UX feel */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-black text-white text-sm px-3 py-2 rounded">
          {toast}
        </div>
      )}
    </main>
  );
}
