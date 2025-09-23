'use client';

import React, { useEffect, useMemo, useState } from 'react';
import IntegrityBadge from '../components/IntegrityBadge';
import PackPicker from '../components/PackPicker';

type IntegrityResponse = {
  ok: boolean;
  pack?: { id: string; title?: string | null };
  manifest_digest_ok?: boolean;
  files_ok?: boolean;
  sealed?: boolean;
  computed?: Record<string, string>;
  error?: string;
};

type PackLite = { id: string; title: string };

const LS_KEY_PACK = 'b2ai:pack';

export default function PackPage() {
  const [pack, setPack] = useState<string | null>(null);
  const [packs, setPacks] = useState<PackLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<IntegrityResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Load available packs and pick a default if needed
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/pack/list', { cache: 'no-store' });
        const j = (await r.json()) as { packs?: PackLite[] };
        const list = j.packs || [];
        if (!cancelled) setPacks(list);

        // Determine initial selection:
        // 1) URL ?pack=
        // 2) localStorage
        // 3) if only one pack, select it
        if (!cancelled) {
          let next: string | null = null;
          try {
            const u = new URL(window.location.href);
            next = u.searchParams.get('pack');
          } catch {}
          if (!next) {
            try {
              next = localStorage.getItem(LS_KEY_PACK);
            } catch {}
          }
          if (!next && list.length === 1) {
            next = list[0].id;
          }
          if (next) setPack(next);
        }
      } catch {
        if (!cancelled) setPacks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Mirror pack to URL + localStorage
  useEffect(() => {
    if (!pack) return;
    try {
      localStorage.setItem(LS_KEY_PACK, pack);
      const u = new URL(window.location.href);
      u.searchParams.set('pack', pack);
      window.history.replaceState(null, '', u.toString());
    } catch {}
  }, [pack]);

  // Fetch integrity for selected pack
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pack) {
        setData(null);
        return;
      }
      setLoading(true);
      setErr(null);
      setData(null);
      try {
        const r = await fetch(`/api/pack/integrity?pack=${encodeURIComponent(pack)}`, {
          cache: 'no-store',
        });
        const j = (await r.json()) as IntegrityResponse;
        if (cancelled) return;
        if (!r.ok || !j.ok) {
          setErr(j.error || `Integrity check failed (HTTP ${r.status})`);
          setData(j);
        } else {
          setData(j);
        }
      } catch (e: unknown) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pack]);

  const summary = useMemo(() => {
    if (!data) return null;
    const sealed = data.sealed === true;
    const digestOk = data.manifest_digest_ok === true;
    const filesOk = data.files_ok === true;
    const computedCount = data.computed ? Object.keys(data.computed).length : 0;
    return { sealed, digestOk, filesOk, computedCount };
  }, [data]);

  const statusChip = (ok?: boolean, label?: string) => (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
        ok
          ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
          : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
      }`}
      title={label}
    >
      {label}
    </span>
  );

  const currentTitle =
    data?.pack?.title ||
    (packs.find((p) => p.id === pack)?.title ?? (pack ? `(${pack})` : 'Pack'));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 text-zinc-900 dark:text-zinc-100">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Verified Pack</h1>
        <div className="flex items-center gap-2">
          {/* Pack selector appears when >1 pack exists */}
          <PackPicker value={pack ?? ''} onChange={setPack} />
          <IntegrityBadge />
        </div>
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6">
        Integrity report for your content pack. Select a pack to verify file hashes and manifest state.
      </p>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{currentTitle}</div>
            <div className="text-xs text-zinc-500">
              {pack ? `id: ${pack}` : 'No pack selected'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {statusChip(data?.sealed, 'Sealed')}
            {statusChip(data?.manifest_digest_ok, 'Manifest digest')}
            {statusChip(data?.files_ok, 'File hashes')}
          </div>
        </div>

        {loading && (
          <div className="text-sm text-zinc-600 dark:text-zinc-300">Computing integrity…</div>
        )}

        {err && (
          <div className="rounded-md border border-red-300 bg-red-100 p-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-900/40 dark:text-red-100">
            {err}
          </div>
        )}

        {!loading && data && (
          <div className="mt-2 space-y-3">
            <div className="text-sm">
              <span className="font-medium">Manifest digest OK:</span>{' '}
              {String(data.manifest_digest_ok ?? false)}
            </div>
            <div className="text-sm">
              <span className="font-medium">All file hashes match:</span>{' '}
              {String(data.files_ok ?? false)}
            </div>
            <div className="text-sm">
              <span className="font-medium">Files hashed:</span>{' '}
              {summary ? summary.computedCount : 0}
            </div>

            {data.computed && Object.keys(data.computed).length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-sm font-medium">Computed file hashes</div>
                <ul className="text-xs font-mono rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
                  {Object.entries(data.computed).map(([p, h]) => (
                    <li key={p} className="border-t border-zinc-200 py-1 first:border-t-0 dark:border-zinc-800">
                      <span className="text-zinc-600 dark:text-zinc-300">{p}</span>
                      <div className="truncate">{h}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
