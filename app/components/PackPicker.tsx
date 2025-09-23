'use client';

import { useEffect, useState } from 'react';

type Pack = { id: string; title: string };

export default function PackPicker({
  value,
  onChange,
  className,
}: {
  value?: string | null;
  onChange: (id: string) => void;
  className?: string;
}) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/pack/list', { cache: 'no-store' });
        const j = (await r.json()) as { packs?: Pack[] };
        if (!cancelled) setPacks(j.packs || []);
      } catch {
        if (!cancelled) setPacks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || packs.length <= 1) return null;

  return (
    <select
      className={`rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900 ${className ?? ''}`}
      value={value ?? packs[0]?.id ?? ''}
      onChange={(e) => onChange(e.target.value)}
      title="Select content pack"
    >
      {packs.map((p) => (
        <option key={p.id} value={p.id}>
          {p.title}
        </option>
      ))}
    </select>
  );
}
