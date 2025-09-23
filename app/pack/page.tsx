'use client';

import React, { useEffect, useMemo, useState } from 'react';

type IntegrityFile = {
  path: string;
  purpose?: string | null;
  expected?: string | null;
  computed?: string | null;
  exists?: boolean;
  ok?: boolean | null;
  size?: number | null;
};

type IntegrityReport = {
  manifest: {
    id: string;
    title?: string;
    author?: string;
    edition?: string;
    created_at?: string;
  };
  files: IntegrityFile[];
  sealed: boolean;
};

export default function PackPage() {
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        const res = await fetch('/api/pack/integrity', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: IntegrityReport = await res.json();
        if (!canceled) setReport(json);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!canceled) setError(msg || 'Failed to load integrity report');
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    load();
    return () => { canceled = true; };
  }, []);

  const allOk = report?.sealed === true;

  const hashesForClipboard = useMemo(() => {
    if (!report) return '';
    const lines: string[] = [];
    lines.push(`# Pack: ${report.manifest.id}`);
    if (report.manifest.title) lines.push(`# Title: ${report.manifest.title}`);
    if (report.manifest.author) lines.push(`# Author: ${report.manifest.author}`);
    lines.push('');
    for (const f of report.files) {
      const status = f.expected ? (f.ok ? 'OK' : 'MISMATCH') : 'UNSEALED';
      lines.push(
        `${f.path}\n  computed: ${f.computed ?? '—'}\n  expected: ${f.expected ?? '—'}\n  status:   ${status}`
      );
    }
    return lines.join('\n');
  }, [report]);

  async function downloadIntegrity() {
    try {
      const res = await fetch('/api/pack/integrity', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fname = `integrity-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to download JSON');
    }
  }

  async function copyHashes() {
    try {
      await navigator.clipboard.writeText(hashesForClipboard);
      setCopyMsg('Hashes copied to clipboard');
      setTimeout(() => setCopyMsg(null), 1500);
    } catch {
      setCopyMsg('Copy failed');
      setTimeout(() => setCopyMsg(null), 1500);
    }
  }

  function Badge({ ok }: { ok: boolean }) {
    return ok ? (
      <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold bg-green-200/80 text-green-900 border border-green-300 dark:bg-green-700/40 dark:text-green-100 dark:border-green-700">
        Sealed
      </span>
    ) : (
      <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold bg-yellow-200/80 text-yellow-900 border border-yellow-300 dark:bg-yellow-700/40 dark:text-yellow-100 dark:border-yellow-700">
        Unsealed
      </span>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-zinc-900 dark:text-zinc-100">
      <h1 className="text-2xl font-semibold mb-2">Verified Pack</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6">
        Cryptographic integrity for your content pack.
      </p>

      {loading && <div className="text-sm text-zinc-600 dark:text-zinc-300">Loading…</div>}

      {error && !loading && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-100 text-red-900 p-3 dark:border-red-700 dark:bg-red-900/40 dark:text-red-100">
          {error}
        </div>
      )}

      {!loading && report && (
        <>
          <div className="mb-5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-zinc-600 dark:text-zinc-300">Pack ID</div>
                <div className="font-mono text-sm">{report.manifest.id}</div>
              </div>
              <Badge ok={allOk} />
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {report.manifest.title && (
                <div>
                  <div className="text-xs text-zinc-600 dark:text-zinc-300">Title</div>
                  <div className="text-sm">{report.manifest.title}</div>
                </div>
              )}
              {report.manifest.author && (
                <div>
                  <div className="text-xs text-zinc-600 dark:text-zinc-300">Author</div>
                  <div className="text-sm">{report.manifest.author}</div>
                </div>
              )}
              {report.manifest.edition && (
                <div>
                  <div className="text-xs text-zinc-600 dark:text-zinc-300">Edition</div>
                  <div className="text-sm">{report.manifest.edition}</div>
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={downloadIntegrity}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
              >
                Download integrity.json
              </button>
              <button
                onClick={copyHashes}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
              >
                Copy hashes
              </button>
              {copyMsg && <span className="text-xs text-zinc-600 dark:text-zinc-300">{copyMsg}</span>}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left dark:bg-zinc-800">
                <tr>
                  <th className="px-4 py-2 font-medium">File</th>
                  <th className="px-4 py-2 font-medium">Purpose</th>
                  <th className="px-4 py-2 font-medium">Expected</th>
                  <th className="px-4 py-2 font-medium">Computed</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Size</th>
                </tr>
              </thead>
              <tbody>
                {report.files.map((f) => {
                  const showOk = Boolean(f.ok && f.expected);
                  return (
                    <tr key={f.path} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="px-4 py-2 font-mono">{f.path}</td>
                      <td className="px-4 py-2">{f.purpose ?? '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs break-all">{f.expected ?? '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs break-all">{f.computed ?? '—'}</td>
                      <td className="px-4 py-2">
                        <Badge ok={showOk} />
                      </td>
                      <td className="px-4 py-2">{typeof f.size === 'number' ? f.size : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!allOk && (
            <div className="mt-4 rounded-md border border-yellow-300 bg-yellow-100 p-3 text-sm text-yellow-900 dark:border-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-100">
              Tip: To seal a file, copy its <span className="font-mono">computed</span> hash into
              the <span className="font-mono">expected</span> field in{' '}
              <span className="font-mono">public/pack/manifest.json</span>, then redeploy.
            </div>
          )}
        </>
      )}
    </main>
  );
}
