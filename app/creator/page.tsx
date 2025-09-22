// app/creator/page.tsx
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getInsightsData, type Insights } from '@/lib/insights';

export default async function CreatorPage() {
  const data: Insights = await getInsightsData();

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Creator Dashboard</h1>
        <nav className="text-sm">
          <Link href="/" className="underline">Home</Link>
        </nav>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border p-4">
          <div className="text-sm text-gray-500">All-time queries</div>
          <div className="text-3xl font-bold">{data.totals.all}</div>
        </div>
        <div className="rounded-2xl border p-4">
          <div className="text-sm text-gray-500">Last 7 days</div>
          <div className="text-3xl font-bold">{data.totals.last7}</div>
        </div>
      </section>

      <section className="rounded-2xl border p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">7-day trend</h2>
          <a href="/api/export?days=7" className="text-sm underline">
            Download CSV (7d)
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Day (UTC)</th>
                <th className="py-2">Queries</th>
              </tr>
            </thead>
            <tbody>
              {data.series.map((p) => (
                <tr key={p.day} className="border-b last:border-0">
                  <td className="py-2 pr-4">{p.day}</td>
                  <td className="py-2">{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border p-4">
          <h3 className="font-semibold mb-2">Top Queries</h3>
          <ul className="space-y-1 text-sm">
            {data.topQueries.map((q) => (
              <li key={q.key} className="flex justify-between gap-3">
                <span className="truncate">{q.key}</span>
                <span className="tabular-nums">{q.count}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border p-4">
          <h3 className="font-semibold mb-2">Top Pages</h3>
          <ul className="space-y-1 text-sm">
            {data.topPages.map((q) => (
              <li key={q.key} className="flex justify-between gap-3">
                <span className="truncate">{q.key}</span>
                <span className="tabular-nums">{q.count}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border p-4">
          <h3 className="font-semibold mb-2">Top Chunks</h3>
          <ul className="space-y-1 text-sm">
            {data.topChunks.map((q) => (
              <li key={q.key} className="flex justify-between gap-3">
                <span className="truncate">{q.key}</span>
                <span className="tabular-nums">{q.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
