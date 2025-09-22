// app/admin/page.tsx
export const dynamic = "force-dynamic"; // ensure fresh analytics on each request

import { headers } from "next/headers";

type StatItem = { key: string; count: number };
type AnalyticsResponse = {
  totals: { queries: number };
  topQueries: StatItem[];
  topPages: StatItem[];
  topChunks: StatItem[];
};

async function getBaseUrl(): Promise<string> {
  // Prefer explicit env in prod; fallback to request headers (works locally & on Vercel)
  if (process.env.NEXT_PUBLIC_BASE_URL && process.env.NEXT_PUBLIC_BASE_URL.trim()) {
    return process.env.NEXT_PUBLIC_BASE_URL.trim();
  }
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

async function getData(): Promise<AnalyticsResponse> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/analytics`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load analytics: ${res.status}`);
  }
  return (await res.json()) as AnalyticsResponse;
}

export default async function Admin() {
  const data = await getData();

  const Box = ({ children }: { children: React.ReactNode }) => (
    <div className="border rounded p-3">{children}</div>
  );

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Book2AI — Analytics</h1>
      <p className="text-sm mb-4">Totals: {data.totals?.queries ?? 0} queries</p>

      <div className="grid md:grid-cols-3 gap-4">
        <Box>
          <h2 className="font-semibold mb-2">Top Queries</h2>
          <ul className="text-sm space-y-1">
            {data.topQueries?.map((x, i) => (
              <li key={i}>
                {x.key} — <b>{x.count}</b>
              </li>
            ))}
          </ul>
        </Box>
        <Box>
          <h2 className="font-semibold mb-2">Top Page Spans</h2>
          <ul className="text-sm space-y-1">
            {data.topPages?.map((x, i) => (
              <li key={i}>
                [{x.key}] — <b>{x.count}</b>
              </li>
            ))}
          </ul>
        </Box>
        <Box>
          <h2 className="font-semibold mb-2">Top Chunks</h2>
          <ul className="text-sm space-y-1">
            {data.topChunks?.map((x, i) => (
              <li key={i}>
                {x.key} — <b>{x.count}</b>
              </li>
            ))}
          </ul>
        </Box>
      </div>
    </main>
  );
}
