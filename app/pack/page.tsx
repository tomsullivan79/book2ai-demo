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
    return () => {
      canceled = true;
    };
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
      <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold bg-green-100 text-green-800 border border-green-200">
        Sealed
      </span>
    ) : (
      <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold bg-yellow-100 text-yellow-800 border border-yellow-200">
        Unsealed
      </span>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold mb-2">Verified Pack</h1>
      <p className="text-sm text-gray-600 mb-6">Cryptographic integrity for your content pack.</p>

      {loading && <div className="text-sm text-gray-500">Loading…</div>}

      {error && !loading && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {!loading && report && (
        <>
          <div className="mb-5 rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-500">Pack ID</div>
                <div className="font-mono text-sm">{report.manifest.id}</div>
              </div>
              <Badge ok={allOk} />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {report.manifest.title && (
                <div>
                  <div className="text-xs text-gray-500">Title</div>
                  <div className="text-sm">{report.manifest.title}</div>
                </div>
              )}
              {report.manifest.author && (
                <div>
                  <div className="text-xs text-gray-500">Author</div>
                  <div className="text-sm">{report.manifest.author}</div>
                </div>
              )}
              {report.manifest.edition && (
                <div>
                  <div className="text-xs text-gray-500">Edition</div>
                  <div className="text-sm">{report.manifest.edition}</div>
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={downloadIntegrity}
                className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Download integrity.json
              </button>
              <button
                onClick={copyHashes}
                className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Copy hashes
              </button>
              {copyMsg && <span className="text-xs text-gray-500">{copyMsg}</span>}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left">
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
                    <tr key={f.path} className="border-t">
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
            <div className="mt-4 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
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
