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
function scrollAndBold(el: HTMLElement) {
  const prev = {
    fontWeight: el.style.fontWeight,
    textDecoration: el.style.textDecoration,
    scrollMarginTop: el.style.scrollMarginTop,
  };

  // prefer scrolling the <pre> itself if present under the container
  const pre = el.tagName !== 'PRE' ? el.querySelector<HTMLElement>('pre') : el;
  const target = pre ?? el;

  target.style.scrollMarginTop = '80px';
  try {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {
    target.scrollIntoView();
  }

  // make text clearly bold without altering layout too long
  const prevFW = target.style.fontWeight;
  target.style.fontWeight = '700';

  // subtle underline to improve discoverability on dark themes
  const prevTD = target.style.textDecoration;
  target.style.textDecoration = 'underline';

  const timeout = setTimeout(() => {
    target.style.fontWeight = prevFW || prev.fontWeight;
    target.style.textDecoration = prevTD || prev.textDecoration;
    target.style.scrollMarginTop = prev.scrollMarginTop;
  }, 3000);

  return () => clearTimeout(timeout);
}

/**
 * DeepLinker:
 * - Reads ?chunk= from the URL.
 * - Finds a tight container (prefer <pre>), avoids body/main.
 * - Bold-highlight for 3s.
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
        cleanup = scrollAndBold(target);
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
