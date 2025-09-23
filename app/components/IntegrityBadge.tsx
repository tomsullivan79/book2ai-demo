'use client';

import React, { useEffect, useState } from 'react';

type IntegrityManifest = {
  id: string;
  title?: string;
  author?: string;
  edition?: string;
  created_at?: string;
};
type IntegrityReport = {
  manifest: IntegrityManifest;
  files: Array<{
    path: string;
    purpose?: string | null;
    expected?: string | null;
    computed?: string | null;
    exists?: boolean;
    ok?: boolean | null;
    size?: number | null;
  }>;
  sealed: boolean;
};

export default function IntegrityBadge() {
  const [sealed, setSealed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/pack/integrity', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: IntegrityReport = await res.json();
        if (!cancelled) setSealed(Boolean(json?.sealed));
      } catch {
        if (!cancelled) setSealed(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const base =
    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors';
  const okClasses =
    'border-green-300 bg-green-100 text-green-900 dark:border-green-700 dark:bg-green-900/30 dark:text-green-100';
  const warnClasses =
    'border-yellow-300 bg-yellow-100 text-yellow-900 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-100';
  const pendingClasses =
    'border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200';

  const content =
    loading ? (
      <span className={`${base} ${pendingClasses}`} title="Checking pack integrity…">Checking…</span>
    ) : sealed ? (
      <span className={`${base} ${okClasses}`} title="All files match expected hashes">✅ Verified</span>
    ) : (
      <span className={`${base} ${warnClasses}`} title="One or more files are not sealed">⚠️ Unverified</span>
    );

  return (
    <a href="/pack" aria-label="Open Verified Pack details" className="no-underline hover:opacity-90">
      {content}
    </a>
  );
}
