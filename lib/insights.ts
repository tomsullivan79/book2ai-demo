// lib/insights.ts
import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase';

export type StatItem = { key: string; count: number };
export type DayPoint = { day: string; count: number };
export type Insights = {
  totals: { all: number; last7: number };
  series: DayPoint[];
  topQueries: StatItem[];
  topPages: StatItem[];
  topChunks: StatItem[];
};

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function topByPrefix(prefix: string, limit = 10): Promise<StatItem[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('b2ai_counters')
    .select('key, count')
    .like('key', `${prefix}:%`)
    .order('count', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((row) => ({
    key: String(row.key).replace(`${prefix}:`, ''),
    count: Number(row.count),
  }));
}

export async function getInsightsData(): Promise<Insights> {
  const supabase = getSupabaseAdmin();

  // 1) Totals (all-time)
  const { count: allCount, error: allErr } = await supabase
    .from('b2ai_query_log')
    .select('*', { count: 'exact', head: true });
  if (allErr) throw allErr;

  // 2) Totals & series (last 7 days)
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  const { data: last7Rows, error: last7Err } = await supabase
    .from('b2ai_query_log')
    .select('ts')
    .gte('ts', sinceIso)
    .limit(20000);
  if (last7Err) throw last7Err;

  const last7Total = last7Rows?.length ?? 0;

  // Bucket by day (UTC)
  const dayCounts = new Map<string, number>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    dayCounts.set(toYMD(d), 0);
  }
  dayCounts.set(toYMD(now), dayCounts.get(toYMD(now)) || 0);

  last7Rows?.forEach((r) => {
    const day = toYMD(new Date(r.ts as unknown as string));
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
  });

  const series: DayPoint[] = Array.from(dayCounts.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, count]) => ({ day, count }));

  // 3) Top lists
  const [topQueries, topPages, topChunks] = await Promise.all([
    topByPrefix('q', 10),
    topByPrefix('page', 10),
    topByPrefix('chunk', 10),
  ]);

  return {
    totals: { all: allCount || 0, last7: last7Total },
    series,
    topQueries,
    topPages,
    topChunks,
  };
}
