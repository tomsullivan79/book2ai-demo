'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** Minimal CSS selector escaper (no `any`) */
function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function buildSelectors(id: string): string[] {
  const variants = new Set<string>();
  const raw = id;
  const slug = slugify(id);
  const prefixed = [`chunk-${raw}`, `chunk-${slug}`, `c-${raw}`, `c-${slug}`];
  const allIds = [raw, slug, ...prefixed];

  for (const v of allIds) {
    const esc = cssEscape(v);
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

function findBySelectors(id: string): HTMLElement | null {
  const selectors = buildSelectors(id);
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

function findByText(id: string): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    'code, kbd, pre, .font-mono, [class*="mono"], [data-field="chunk-id"], [data-role="chunk-id"], span, a, div'
  );

  const word = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = new RegExp(`\\b${word}\\b`);

  for (const el of candidates) {
    const txt = (el.textContent || '').trim();
    if (!txt) continue;
    if (txt === id || txt.includes(id) || wordRe.test(txt)) {
      const container =
        el.closest<HTMLElement>('[data-chunk-row],[data-chunk],li,[role="row"],article,section,div');
      return container || el;
    }
  }
  return null;
}

function findTarget(id: string): HTMLElement | null {
  return findBySelectors(id) || findByText(id);
}

/** Highly visible highlight that can’t be clipped easily */
function scrollAndHighlight(el: HTMLElement) {
  // keep previous inline styles to restore later
  const prev = {
    boxShadow: el.style.boxShadow,
    backgroundColor: el.style.backgroundColor,
    transition: el.style.transition,
    outline: el.style.outline,
    scrollMarginTop: el.style.scrollMarginTop,
  };

  // ensure we don't sit under a fixed header
  el.style.scrollMarginTop = '80px';

  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {
    el.scrollIntoView();
  }

  // strong visual flash (amber-400-ish)
  el.style.transition = 'box-shadow .2s ease, background-color .2s ease';
  el.style.boxShadow = '0 0 0 4px rgba(251,191,36,0.95)'; // amber 400
  el.style.backgroundColor = 'rgba(251,191,36,0.18)';       // light fill so it pops
  el.style.outline = 'none';

  const timeout = setTimeout(() => {
    el.style.boxShadow = prev.boxShadow;
    el.style.backgroundColor = prev.backgroundColor;
    el.style.transition = prev.transition;
    el.style.outline = prev.outline;
    el.style.scrollMarginTop = prev.scrollMarginTop;
  }, 2600);

  return () => clearTimeout(timeout);
}

/**
 * DeepLinker:
 * - Reads ?chunk= from the URL.
 * - Tries attribute selectors, then text-content fallback.
 * - Retries briefly, then uses MutationObserver (up to 5s).
 */
export default function DeepLinker() {
  const params = useSearchParams();

  useEffect(() => {
    const chunk = params.get('chunk');
    if (!chunk) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    const attempt = () => {
      const target = findTarget(chunk);
      if (target) {
        cleanup = scrollAndHighlight(target);
        return true;
      }
      return false;
    };

    // 1) immediate
    if (attempt()) return () => cleanup && cleanup();

    // 2) quick retries (hydration)
    const quick = async () => {
      for (let i = 0; i < 5 && !cancelled; i++) {
        await sleep(150);
        if (attempt()) return true;
      }
      return false;
    };

    // 3) observe up to 5s
    const observeUntilFound = () => {
      const deadline = Date.now() + 5000;
      const obs = new MutationObserver(() => {
        if (Date.now() > deadline) {
          obs.disconnect();
          return;
        }
        if (attempt()) {
          obs.disconnect();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true, attributes: true });

      const endTimer = setTimeout(() => obs.disconnect(), 5200);
      cleanup = () => clearTimeout(endTimer);
    };

    void (async () => {
      if (!(await quick()) && !cancelled) observeUntilFound();
    })();

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, [params]);

  return null;
}
