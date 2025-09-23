'use client';

import React, { useEffect, useMemo, useState } from 'react';
import IntegrityBadge from '../components/IntegrityBadge';

type Health = 'ok' | 'warn' | 'down' | 'pending';
type InsightsTotals = { all_time: number; last_7_days: number };

type UnknownRec = Record<string, unknown>;
function isObj(v: unknown): v is UnknownRec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function pick<T extends UnknownRec, K extends string>(obj: T, key: K): unknown {
  return obj[key];
}

function normalizeKvHealth(raw: unknown): { health: Health; detail?: string } {
  if (!isObj(raw)) return { health: 'down', detail: 'no payload' };
  const ok = Boolean(pick(raw, 'ok'));
  const status = String((pick(raw, 'status') ?? '') as string);
  const info = String((pick(raw, 'info') ?? '') as string);

  if (ok || status.toLowerCase() === 'ok' || status.toLowerCase() === 'healthy') {
    return { health: 'ok', detail: info || 'KV reachable' };
  }
  if (Object.keys(raw).length > 0) {
    return { health: 'warn', detail: status || info || 'KV responded with issues' };
  }
  return { health: 'down', detail: 'no response' };
}

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

function HealthChip({
  label,
  state,
  detail,
  right,
}: {
  label: string;
  state: Health;
  detail?: string;
  right?: React.ReactNode;
}) {
  const base = 'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium';
  const cls =
    state === 'ok'
      ? 'border-green-300 bg-green-100 text-green-900 dark:border-green-700 dark:bg-green-900/30 dark:text-green-100'
      : state === 'warn'
      ? 'border-yellow-300 bg-yellow-100 text-yellow-900 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-100'
      : state === 'pending'
      ? 'border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200'
      : 'border-red-300 bg-red-100 text-red-900 dark:border-red-700 dark:bg-red-900/30 dark:text-red-100';

  const icon = state === 'ok' ? '✅' : state === 'warn' ? '⚠️' : state === 'pending' ? '⏳' : '🛑';

  return (
    <div className={`${base} ${cls}`}>
      <span>{icon}</span>
      <span className="font-semibold">{label}</span>
      {detail && <span className="opacity-80">· {detail}</span>}
      {right && <span className="ml-1">{right}</span>}
    </div>
  );
}

export default function AdminPage() {
  const [kv, setKv] = useState<{ health: Health; detail?: string }>({ health: 'pending' });
  const [sb, setSb] = useState<{ health: Health; detail?: string; totals?: InsightsTotals }>({
    health: 'pending',
  });
  const [checkedAt, setCheckedAt] = useState<string>('');

  // Manual mirror state
  const [mirroring, setMirroring] = useState(false);
  const [mirrorMsg, setMirrorMsg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const kvRes = await fetch('/api/kv/health', { cache: 'no-store' });
        const kvJson: unknown = kvRes.ok ? await kvRes.json() : null;
        const kvNorm = normalizeKvHealth(kvJson);
        if (!cancelled) setKv(kvNorm);
      } catch {
        if (!cancelled) setKv({ health: 'down', detail: 'fetch failed' });
      }

      try {
        const sbRes = await fetch('/api/insights', { cache: 'no-store' });
        const sbJson: unknown = sbRes.ok ? await sbRes.json() : null;
        const sbNorm = normalizeInsightsHealth(sbJson);
        if (!cancelled) setSb(sbNorm);
      } catch {
        if (!cancelled) setSb({ health: 'down', detail: 'fetch failed' });
      }

      if (!cancelled) setCheckedAt(new Date().toLocaleString());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const kvOpsLink = useMemo(
    () => (
      <a
        href="/api/kv/ops?op=llen"
        className="rounded border border-current/30 px-2 py-0.5 text-[10px] opacity-80 hover:opacity-100"
      >
        ops
      </a>
    ),
    []
  );

  async function runMirror() {
    setMirroring(true);
    setMirrorMsg('');
    try {
      const res = await fetch('/api/admin/mirror', { method: 'POST', cache: 'no-store' });
      const json: unknown = await res.json();
      if (!res.ok || !isObj(json)) {
        setMirrorMsg('Mirror failed.');
      } else {
        const result = isObj(json.result) ? (json.result as UnknownRec) : {};
        const drained = String(result['drained'] ?? '0');
        const seen = String(result['seen'] ?? '0');
        const after = String(result['after'] ?? '0');
        setMirrorMsg(`Mirrored: drained=${drained}, seen=${seen}, queue_after=${after}`);
      }
    } catch {
      setMirrorMsg('Mirror failed (network).');
    } finally {
      setMirroring(false);
      // refresh the insights chip after a short beat
      setTimeout(async () => {
        try {
          const sbRes = await fetch('/api/insights', { cache: 'no-store' });
          const sbJson: unknown = sbRes.ok ? await sbRes.json() : null;
          const sbNorm = normalizeInsightsHealth(sbJson);
          setSb(sbNorm);
        } catch {
          /* ignore */
        }
      }, 500);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 text-zinc-900 dark:text-zinc-100">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <IntegrityBadge />
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6">
        Real-time counters and backend health for your Book2AI demo.
      </p>

      {/* Health row */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <HealthChip label="KV" state={kv.health} detail={kv.detail} right={kvOpsLink} />
        <HealthChip
          label="Supabase"
          state={sb.health}
          detail={
            sb.totals
              ? `all-time ${sb.totals.all_time} · last 7d ${sb.totals.last_7_days}`
              : sb.detail
          }
        />
        <span className="text-xs text-zinc-600 dark:text-zinc-400 ml-2">
          Last checked: {checkedAt || '—'}
        </span>
      </div>

      {/* Manual mirror card */}
      <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Mirror queue to Supabase</div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              Triggers <span className="font-mono">/api/cron/mirror</span> using your server secret.
            </div>
          </div>
          <button
            onClick={runMirror}
            disabled={mirroring}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-800"
          >
            {mirroring ? 'Mirroring…' : 'Run Mirror Now'}
          </button>
        </div>
        {mirrorMsg && (
          <div className="mt-3 text-xs text-zinc-700 dark:text-zinc-300">{mirrorMsg}</div>
        )}
      </div>

      {/* Shortcuts */}
      <div className="mt-6 text-sm">
        <div className="mb-2 font-medium">Shortcuts</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <a className="underline hover:no-underline" href="/api/kv/health">
              /api/kv/health
            </a>{' '}
            — KV readiness
          </li>
          <li>
            <a className="underline hover:no-underline" href="/api/kv/ops?op=lrange">
              /api/kv/ops?op=lrange
            </a>{' '}
            — recent queue peek (token-guarded in prod)
          </li>
          <li>
            <a className="underline hover:no-underline" href="/api/insights">
              /api/insights
            </a>{' '}
            — Supabase-backed insights
          </li>
          <li>
            <a className="underline hover:no-underline" href="/creator">
              /creator
            </a>{' '}
            — dashboard
          </li>
        </ul>
      </div>
    </main>
  );
}
