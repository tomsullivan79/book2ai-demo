'use client';

import React from 'react';

type Props = {
  value: string;
  onChange: (next: string) => void;
  className?: string;
};

const PACKS: Array<{ id: string; label: string }> = [
  { id: 'scientific-advertising', label: 'Scientific Advertising' },
  { id: 'optimal-poker', label: 'Optimal Poker' },
];

export default function PackPicker({ value, onChange, className }: Props) {
  return (
    <select
      className={className ?? 'rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Select content pack"
    >
      {PACKS.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </select>
  );
}
