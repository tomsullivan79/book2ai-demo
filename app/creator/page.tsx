'use client';

import React, { useEffect, useState } from 'react';
import IntegrityBadge from '../components/IntegrityBadge';

type TopItem = { key: string; count: number };
type SeriesPoint = { day: string; count: number };
type Insights = {
  totals: { all_time: number; last_7_days: number };
  series_7d: SeriesPoint[];
  top_queries: TopItem[];
  top_pages: TopItem[];
  top_chunks: TopItem[];
};

type UnknownRec = Record<string, unknown>;
function isObj(v: unknown): v is UnknownRec { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function toNumber(v: unknown, fallback = 0): number { if (typeof v === 'number' && Number.isFinite(v)) return v; const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function toStringSafe(v: unknown): string { return typeof v === 'string' ? v : ''; }
function pick(obj: UnknownRec, key: string): unknown { return obj[key]; }
function pickObj(obj: UnknownRec, key: string): UnknownRec { const v = obj[key]; return isObj(v) ? v : {}; }
function pickArr(obj: UnknownRec, key: string): unknown[] { const v = obj[key]; return Array.isArray(v) ? v : []; }

function normalizeInsights(raw: unknown): Insights {
  const r = (raw ?? {}) as Record<string, unknown>;

  // --- totals (accept all shapes) ---
  const totalsObj = (typeof r.totals === 'object' && r.totals) ? (r.totals as Record<string, unknown>) : {};
  const all_time =
    (typeof totalsObj.all_time === 'number' ? totalsObj.all_time : undefined) ??
    (typeof totalsObj.all === 'number' ? totalsObj.all : undefined) ??
    (typeof (r as any).all_time === 'number' ? (r as any).all_time : undefined) ?? 0;
  const last_7_days =
    (typeof totalsObj.last_7_days === 'number' ? totalsObj.last_7_days : undefined) ??
    (typeof totalsObj.last7 === 'number' ? totalsObj.last7 : undefined) ??
    (typeof (r as any).last_7_days === 'number' ? (r as any).last_7_days : undefined) ?? 0;

  // --- series (series_7d or series) ---
  const seriesArr: unknown[] = Array.isArray((r as any).series_7d)
    ? ((r as any).series_7d as unknown[])
    : Array.isArray((r as any).series)
    ? ((r as any).series as unknown[])
    : [];
  const series_7d = seriesArr
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      const day = typeof o.day === 'string' ? o.day : typeof o.date === 'string' ? o.date : '';
      const count = typeof o.count === 'number' ? o.count : typeof o.value === 'number' ? o.value : 0;
      return day ? { day, count } : null;
    })
    .filter(Boolean) as SeriesPoint[];

  // --- tops (snake_case OR camelCase) ---
  const tqArr: unknown[] =
    Array.isArray((r as any).top_queries) ? ((r as any).top_queries as unknown[])
    : Array.isArray((r as any).topQueries) ? ((r as any).topQueries as unknown[])
    : Array.isArray((r as any).top?.queries) ? ((r as any).top.queries as unknown[])
    : [];
  const tpArr: unknown[] =
    Array.isArray((r as any).top_pages) ? ((r as any).top_pages as unknown[])
    : Array.isArray((r as any).topPages) ? ((r as any).topPages as unknown[])
    : Array.isArray((r as any).top?.pages) ? ((r as any).top.pages as unknown[])
    : [];
  const tcArr: unknown[] =
    Array.isArray((r as any).top_chunks) ? ((r as any).top_chunks as unknown[])
    : Array.isArray((r as any).topChunks) ? ((r as any).topChunks as unknown[])
    : Array.isArray((r as any).top?.chunks) ? ((r as any).top.chunks as unknown[])
    : [];

  const mapTop = (arr: unknown[]) =>
    arr
      .map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        const key =
          typeof o.key === 'string'
            ? o.key
            : typeof o.id === 'string'
            ? o.id
            : typeof o.name === 'string'
            ? o.name
            : '';
        const count = typeof o.count === 'number' ? o.count : typeof o.value === 'number' ? o.value : 0;
        return key ? { key, count } : null;
      })
      .filter(Boolean) as TopItem[];

  return {
    totals: { all_time, last_7_days },
    series_7d,
    top_queries: mapTop(tqArr),
    top_pages: mapTop(tpArr),
    top_chunks: mapTop(tcArr),
  };
}
No other parts of app/creator/page.tsx need to change.

Patch app/admin/page.tsx (make totals accept {all,last7} too)
Replace only the normalizeInsightsHealth function with this:

tsx
Copy code
function normalizeInsightsHealth(raw: unknown): {
  health: Health;
  totals?: InsightsTotals;
  detail?: string;
} {
  if (!isObj(raw)) return { health: 'down', detail: 'no payload' };

  const totalsObj = isObj(pick(raw, 'totals')) ? (pick(raw, 'totals') as UnknownRec) : {};
  const all_time =
    (typeof pick(totalsObj, 'all_time') === 'number' ? (pick(totalsObj, 'all_time') as number) : undefined) ??
    (typeof pick(totalsObj, 'all') === 'number' ? (pick(totalsObj, 'all') as number) : undefined) ??
    (typeof pick(raw, 'all_time') === 'number' ? (pick(raw, 'all_time') as number) : undefined);
  const last_7_days =
    (typeof pick(totalsObj, 'last_7_days') === 'number' ? (pick(totalsObj, 'last_7_days') as number) : undefined) ??
    (typeof pick(totalsObj, 'last7') === 'number' ? (pick(totalsObj, 'last7') as number) : undefined) ??
    (typeof pick(raw, 'last_7_days') === 'number' ? (pick(raw, 'last_7_days') as number) : undefined);

  const hasNumbers = typeof all_time === 'number' || typeof last_7_days === 'number';
  if (hasNumbers) {
    return {
      health: 'ok',
      totals: {
        all_time: typeof all_time === 'number' ? all_time : 0,
        last_7_days: typeof last_7_days === 'number' ? last_7_days : 0,
      },
      detail: 'Insights reachable',
    };
  }
  return { health: 'warn', detail: 'Insights responded without totals' };
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
    return () => { cancelled = true; };
  }, []);

  const series = data?.series_7d ?? [];
  const topQueries = data?.top_queries ?? [];
  const topPages = data?.top_pages ?? [];
  const topChunks = data?.top_chunks ?? [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 text-zinc-900 dark:text-zinc-100">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Creator Dashboard</h1>
        <IntegrityBadge />
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6">Usage insights for your Book2AI demo.</p>

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
              <a href="/api/export?days=7" className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800" download>
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
                <li className="border-t border-zinc-200 py-1 text-zinc-500 dark:border-zinc-800">No data yet</li>
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

function TopTable({ title, rows, mono }: { title: string; rows: { key: string; count: number }[] | undefined; mono?: boolean }) {
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
              <td className="px-3 py-2 text-zinc-500" colSpan={2}>No data yet</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
