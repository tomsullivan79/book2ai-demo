'use client';

import React, { useEffect, useState } from 'react';

type TopItem = { key: string; count: number };
type SeriesPoint = { day: string; count: number };
type Insights = {
  totals: { all_time: number; last_7_days: number };
  series_7d: SeriesPoint[];
  top_queries: TopItem[];
  top_pages: TopItem[];
  top_chunks: TopItem[];
};

/* ---------- tiny runtime type guards / helpers (no `any`) ---------- */

type UnknownRec = Record<string, unknown>;

function isObj(v: unknown): v is UnknownRec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function toNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function toStringSafe(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function pick(obj: UnknownRec, key: string): unknown {
  return obj[key];
}
function pickObj(obj: UnknownRec, key: string): UnknownRec {
  const v = obj[key];
  return isObj(v) ? v : {};
}
function pickArr(obj: UnknownRec, key: string): unknown[] {
  const v = obj[key];
  return Array.isArray(v) ? v : [];
}

/* ---------- robust normalization without `any` ---------- */

function normalizeInsights(raw: unknown): Insights {
  const root: UnknownRec = isObj(raw) ? raw : {};

  // Totals can be in root.totals or flat
  const totalsObj = pickObj(root, 'totals');
  const totals = {
    all_time: toNumber(pick(totalsObj, 'all_time') ?? pick(root, 'all_time')),
    last_7_days: toNumber(pick(totalsObj, 'last_7_days') ?? pick(root, 'last_7_days')),
  };

  // Series: accept root.series_7d or root.series; each element should map to {day,count}
  const seriesCandidate =
    pickArr(root, 'series_7d').length > 0 ? pickArr(root, 'series_7d') : pickArr(root, 'series');

  const series_7d: SeriesPoint[] = [];
  for (const item of seriesCandidate) {
    if (!isObj(item)) continue;
    const day = toStringSafe(pick(item, 'day') ?? pick(item, 'date'));
    const count = toNumber(pick(item, 'count') ?? pick(item, 'value'));
    if (day) series_7d.push({ day, count });
  }

  // Tops: allow either top_queries OR top.queries (same for pages/chunks)
  const topObj = pickObj(root, 'top');

  const tqRaw = pickArr(root, 'top_queries').length > 0 ? pickArr(root, 'top_queries') : pickArr(topObj, 'queries');
  const tpRaw = pickArr(root, 'top_pages').length > 0 ? pickArr(root, 'top_pages') : pickArr(topObj, 'pages');
  const tcRaw = pickArr(root, 'top_chunks').length > 0 ? pickArr(root, 'top_chunks') : pickArr(topObj, 'chunks');

  const mapTop = (arr: unknown[]): TopItem[] => {
    const out: TopItem[] = [];
    for (const item of arr) {
      if (!isObj(item)) continue;
      const key = toStringSafe(pick(item, 'key') ?? pick(item, 'id') ?? pick(item, 'name'));
      const count = toNumber(pick(item, 'count') ?? pick(item, 'value'));
      if (key) out.push({ key, count });
    }
    return out;
  };

  return {
    totals,
    series_7d,
    top_queries: mapTop(tqRaw),
    top_pages: mapTop(tpRaw),
    top_chunks: mapTop(tcRaw),
  };
}

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
        const json: unknown = await res.json();
        const normalized = normalizeInsights(json);
        if (!cancelled) setData(normalized);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Safe fallbacks so we never map over undefined
  const series = data?.series_7d ?? [];
  const topQueries = data?.top_queries ?? [];
  const topPages = data?.top_pages ?? [];
  const topChunks = data?.top_chunks ?? [];

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

          {/* 7-day series */}
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-sm font-medium mb-2">Last 7 days</div>
            <ul className="text-sm">
              {series.map((d) => (
                <li key={d.day} className="flex justify-between border-t border-zinc-200 py-1 dark:border-zinc-800">
                  <span className="font-mono">{d.day}</span>
                  <span>{d.count}</span>
                </li>
              ))}
              {series.length === 0 && (
                <li className="border-t border-zinc-200 py-1 text-zinc-500 dark:border-zinc-800">
                  No data yet
                </li>
              )}
            </ul>
          </div>

          {/* Top tables */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TopTable title="Top Queries" rows={topQueries} mono />
            <TopTable title="Top Pages" rows={topPages} mono={false} />
            <TopTable title="Top Chunks" rows={topChunks} mono />
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

function TopTable({
  title,
  rows,
  mono,
}: {
  title: string;
  rows: { key: string; count: number }[] | undefined;
  mono?: boolean;
}) {
  const safeRows = Array.isArray(rows) ? rows : [];
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
          {safeRows.map((r) => (
            <tr key={r.key} className="border-t border-zinc-200 dark:border-zinc-800">
              <td className={`px-3 py-2 ${mono ? 'font-mono break-all' : ''}`}>{r.key}</td>
              <td className="px-3 py-2 text-right">{r.count}</td>
            </tr>
          ))}
          {safeRows.length === 0 && (
            <tr className="border-t border-zinc-200 dark:border-zinc-800">
              <td className="px-3 py-2 text-zinc-500" colSpan={2}>
                No data yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
