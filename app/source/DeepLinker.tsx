'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/** Finds the chunk element and scrolls/highlights it. */
export default function DeepLinker() {
  const params = useSearchParams();
  useEffect(() => {
    const id = params.get('chunk');
    if (!id) return;

    // Look for a variety of selectors to maximize compatibility with your current /source UI
    const sel = [
      `[data-chunk-id="${CSS.escape(id)}"]`,
      `#${CSS.escape(id)}`,
      `[id="${CSS.escape(id)}"]`,
    ].join(',');

    const el = document.querySelector<HTMLElement>(sel);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-amber-400', 'rounded-md');
      const timeout = setTimeout(() => {
        el.classList.remove('ring-2', 'ring-amber-400');
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [params]);

  return null;
}
