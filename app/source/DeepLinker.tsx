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

function getChunkId(params: ReturnType<typeof useSearchParams> | null): string | null {
  // 1) Try Next's search params
  const fromHook = params?.get('chunk');
  if (fromHook) return fromHook;

  // 2) Fallback to the real URL (helps when the hook isn't ready yet at first paint)
  if (typeof window !== 'undefined') {
    try {
      const u = new URL(window.location.href);
      const q = u.searchParams.get('chunk');
      if (q) return q;
      // 3) As a last resort, support #<id> only
      if (u.hash) return decodeURIComponent(u.hash.replace(/^#/, ''));
    } catch {
      /* no-op */
    }
  }
  return null;
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

/** pick the smallest sensible container around a text match */
function pickBestContainer(el: HTMLElement): HTMLElement {
  const BAD = new Set(['HTML', 'BODY', 'MAIN']);
  const prefer =
    el.closest<HTMLElement>('pre') ||
    el.closest<HTMLElement>('section.border.rounded.p-3') ||
    el.closest<HTMLElement>('section[id^="p-"]') ||
    el.closest<HTMLElement>('[data-chunk-row],[data-chunk],li,[role="row"],article,section,div') ||
    el;

  let candidate = prefer;
  if (BAD.has(candidate.tagName)) candidate = el;

  // If the candidate is basically full-screen, fall back to the leaf node
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  const rect = candidate.getBoundingClientRect();
  if (vw && vh && rect.width > vw * 0.95 && rect.height > vh * 0.9) {
    return el;
  }

  return candidate;
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
      return pickBestContainer(el);
    }
  }
  return null;
}

function findTarget(id: string): HTMLElement | null {
  const byAttr = findBySelectors(id);
  if (byAttr) return pickBestContainer(byAttr);
  return findByText(id);
}

/** Bold-only effect for ~3s (no bg, no large outline) */
function scrollAndBold(container: HTMLElement) {
  // Prefer the <pre> inside the container if present
  const target = container.tagName !== 'PRE' ? container.querySelector<HTMLElement>('pre') ?? container : container;

  const prev = {
    scrollMarginTop: target.style.scrollMarginTop,
    fontWeight: target.style.fontWeight,
    textDecoration: target.style.textDecoration,
  };

  // ensure we don't land under any fixed header
  target.style.scrollMarginTop = '80px';

  // Scroll container first for better positioning, then the inner <pre> if different
  try {
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {
    container.scrollIntoView();
  }
  if (target !== container) {
    try {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      target.scrollIntoView();
    }
  }

  const prevFW = target.style.fontWeight;
  const prevTD = target.style.textDecoration;
  target.style.fontWeight = '700';
  target.style.textDecoration = 'underline';

  const timeout = setTimeout(() => {
    target.style.fontWeight = prevFW || prev.fontWeight;
    target.style.textDecoration = prevTD || prev.textDecoration;
    target.style.scrollMarginTop = prev.scrollMarginTop;
  }, 3000);

  return () => clearTimeout(timeout);
}

export default function DeepLinker() {
  const params = useSearchParams();

  useEffect(() => {
    const id = getChunkId(params);
    if (!id) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    const attempt = () => {
      const target = findTarget(id);
      if (target) {
        cleanup = scrollAndBold(target);
        return true;
      }
      return false;
    };

    // 0) microtask tick (gives params/DOM a beat to hydrate)
    const t0 = setTimeout(() => {
      if (attempt()) return;

      // 1) quick retries
      const quick = async () => {
        for (let i = 0; i < 5 && !cancelled; i++) {
          await sleep(150);
          if (attempt()) return true;
        }
        return false;
      };

      // 2) observer up to 5s
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
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(t0);
      if (cleanup) cleanup();
    };
  }, [params]);

  return null;
}
