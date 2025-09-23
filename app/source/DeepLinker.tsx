'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function buildSelectors(id: string): string[] {
  const variants = new Set<string>();
  const raw = id;
  const slug = slugify(id);
  const prefixed = [`chunk-${raw}`, `chunk-${slug}`, `c-${raw}`, `c-${slug}`];

  const allIds = [raw, slug, ...prefixed];

  for (const v of allIds) {
    const esc = CSS.escape(v);
    variants.add(`#${esc}`);
    variants.add(`[id="${esc}"]`);
    variants.add(`[data-chunk-id="${esc}"]`);
    variants.add(`[data-id="${esc}"]`);
    variants.add(`[data-key="${esc}"]`);
    variants.add(`[data-chunk="${esc}"]`);
    // partial matches as a last resort
    variants.add(`[data-chunk-id*="${esc}"]`);
    variants.add(`[data-id*="${esc}"]`);
    variants.add(`[data-key*="${esc}"]`);
  }

  return Array.from(variants);
}

function findTarget(id: string): HTMLElement | null {
  const selectors = buildSelectors(id);
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

function scrollAndHighlight(el: HTMLElement) {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('ring-2', 'ring-amber-400', 'rounded-md');

  // If the element is a table row, add styles to the row children too for visibility
  if (el.tagName === 'TR') {
    el.classList.add('bg-amber-50', 'dark:bg-amber-900/20');
  }

  const timeout = setTimeout(() => {
    el.classList.remove('ring-2', 'ring-amber-400');
    if (el.tagName === 'TR') {
      el.classList.remove('bg-amber-50', 'dark:bg-amber-900/20');
    }
  }, 2200);

  return () => clearTimeout(timeout);
}

/**
 * DeepLinker:
 * - Reads ?chunk= from the URL.
 * - Tries multiple selector variants.
 * - If not found immediately, waits for hydration using MutationObserver (up to 5s).
 * - Also respects #fragment if your DOM already has id=… anchors (native scroll happens first).
 */
export default function DeepLinker() {
  const params = useSearchParams();

  useEffect(() => {
    const chunk = params.get('chunk');
    if (!chunk) return;

    // Try immediate
    let target = findTarget(chunk);
    if (target) {
      const cleanup = scrollAndHighlight(target);
      return () => cleanup && cleanup();
    }

    // If not found, wait a tick (post-hydration microtask) then try again
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    const trySoon = async () => {
      // quick retries before full observer
      for (let i = 0; i < 3 && !cancelled; i++) {
        await sleep(150);
        target = findTarget(chunk);
        if (target) {
          cleanup = scrollAndHighlight(target);
          return;
        }
      }

      // Use MutationObserver for up to 5s
      const deadline = Date.now() + 5000;
      const observer = new MutationObserver(() => {
        if (Date.now() > deadline) {
          observer.disconnect();
          return;
        }
        const el = findTarget(chunk);
        if (el) {
          observer.disconnect();
          cleanup = scrollAndHighlight(el);
        }
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      // Hard stop after deadline
      const endTimer = setTimeout(() => {
        observer.disconnect();
      }, 5200);

      // ensure timers/observers clear if unmounted
      cleanup = (() => {
        clearTimeout(endTimer);
      }) as unknown as () => void;
    };

    void trySoon();

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, [params]);

  return null;
}
