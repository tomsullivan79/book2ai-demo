'use client';

import React, { useEffect, useState } from 'react';

type TopItem = { key: string; count: number };
type Insights = {
  totals: { all_time: number; last_7_days: number };
  series_7d: Array<{ day: string; count: number }>;
  top_queries: TopItem[];
  top_pages: TopItem[];
  top_chunks: TopItem[];
};

export default function CreatorPage() {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/insights', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: Insights = await res.json();
        if (!cancelled) setData(json);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 text-zinc-900 dark:text-zinc-100">
      <h1 className="text-2xl font-semibold mb-2">Creator Dashboard</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6">
        Usage insights for your Book2AI demo.
      </p>

      {loading && <div className="text-sm text-zinc-600 dark:text-zinc-300">Loading…</div>}

      {error && !loading && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-100 text-red-900 p-3 dark:border-red-700 dark:bg-red-900/40 dark:text-red-100">
          {error}
        </div>
      )}

      {!loading && data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
            <Card label="All-time queries" value={data.totals.all_time} />
            <Card label="Last 7 days" value={data.totals.last_7_days} />
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 flex items-center justify-between">
              <div>
                <div className="text-xs text-zinc-600 dark:text-zinc-300 mb-1">Export</div>
                <div className="text-sm">Download recent CSV</div>
              </div>
              <a
                href="/api/export?days=7"
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
                download
              >
                Download last 7 days CSV
              </a>
            </div>
          </div>

          {/* Simple 7-day series (text list to keep this step tiny & safe) */}
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-sm font-medium mb-2">Last 7 days</div>
            <ul className="text-sm">
              {data.series_7d.map((d) => (
                <li key={d.day} className="flex justify-between border-t border-zinc-200 py-1 dark:border-zinc-800">
                  <span className="font-mono">{d.day}</span>
                  <span>{d.count}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Top tables */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TopTable title="Top Queries" rows={data.top_queries} mono />
            <TopTable title="Top Pages" rows={data.top_pages} mono={false} />
            <TopTable title="Top Chunks" rows={data.top_chunks} mono />
          </div>
        </>
      )}
    </main>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs text-zinc-600 dark:text-zinc-300 mb-1">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function TopTable({ title, rows, mono }: { title: string; rows: { key: string; count: number }[]; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-sm font-medium mb-2">{title}</div>
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-50 text-left dark:bg-zinc-800">
          <tr>
            <th className="px-3 py-2 font-medium">Key</th>
            <th className="px-3 py-2 font-medium w-16 text-right">Count</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-zinc-200 dark:border-zinc-800">
              <td className={`px-3 py-2 ${mono ? 'font-mono break-all' : ''}`}>{r.key}</td>
              <td className="px-3 py-2 text-right">{r.count}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr className="border-t border-zinc-200 dark:border-zinc-800">
              <td className="px-3 py-2 text-zinc-500" colSpan={2}>No data yet</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
