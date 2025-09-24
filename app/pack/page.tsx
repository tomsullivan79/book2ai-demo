'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import PackPicker from '../components/PackPicker';
import IntegrityBadge from '../components/IntegrityBadge';
import { useSearchParams, useRouter } from 'next/navigation';

type IntegrityReport = {
  ok: boolean;
  pack_id: string;
  sealed: boolean;
  manifest_digest_ok: boolean;
  all_hashes_match: boolean;
  files_hashed: number;
  computed: Array<{ path: string; sha256: string }>;
};

// ---- Outer component ONLY adds Suspense to satisfy Next SSR rules ----
export default function PackPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl px-6 py-10">Loading…</div>}>
      <PackPageInner />
    </Suspense>
  );
}

// ---- Actual page contents live here ----
function PackPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [pack, setPack] = useState('scientific-advertising');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Init from URL
  useEffect(() => {
    const p = searchParams.get('pack');
    if (p) setPack(p);
  }, [searchParams]);

  // Keep URL in sync on change (no scroll jump)
  useEffect(() => {
    const u = new URL(window.location.href);
    if (pack) u.searchParams.set('pack', pack);
    router.replace(u.toString(), { scroll: false });
  }, [pack, router]);

  // Fetch integrity report whenever pack changes
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      setReport(null);
      try {
        const r = await fetch(`/api/pack/integrity?pack=${encodeURIComponent(pack)}`, {
          cache: 'no-store',
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as IntegrityReport;
        if (!cancelled) setReport(j);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [pack]);

  const title = useMemo(
    () => (pack === 'optimal-poker' ? 'Optimal Poker' : 'Scientific Advertising'),
    [pack]
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 text-zinc-900 dark:text-zinc-100">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Verified Pack</h1>
        <div className="flex items-center gap-2">
          <PackPicker value={pack} onChange={setPack} />
          <IntegrityBadge />
        </div>
      </div>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-300">
        Integrity report for your content pack. Select a pack to verify file hashes and manifest state.
      </p>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-1 text-base font-medium">{title}</div>
        <div className="mb-3 text-xs text-zinc-500">id: {pack}</div>

        {loading && <div className="text-sm">Checking…</div>}
        {error && (
          <div className="rounded-md border border-red-300 bg-red-100 p-2 text-sm text-red-900 dark:border-red-700 dark:bg-red-900/30 dark:text-red-100">
            {error}
          </div>
        )}

        {report && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border px-2 py-0.5 text-xs border-emerald-700/40 text-emerald-500">
                {report.sealed ? 'Sealed' : 'Unsealed'}
              </span>
              <span className="rounded-full border px-2 py-0.5 text-xs border-emerald-700/40 text-emerald-500">
                Manifest digest {report.manifest_digest_ok ? 'OK' : 'Mismatch'}
              </span>
              <span className="rounded-full border px-2 py-0.5 text-xs border-emerald-700/40 text-emerald-500">
                File hashes {report.all_hashes_match ? 'match' : 'mismatch'}
              </span>
            </div>

            <div className="text-sm">
              <div className="mb-1 font-medium">Files hashed: {report.files_hashed}</div>
              <pre className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950">
                {report.computed.map((f) => `${f.path}\n${f.sha256}`).join('\n\n')}
              </pre>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
