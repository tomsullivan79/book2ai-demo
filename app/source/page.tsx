// app/source/page.tsx
export const runtime = "nodejs";

import { headers } from "next/headers";

type Page = { n: number; text: string };

function splitPages(raw: string): Page[] {
  const lines = raw.split(/\r?\n/);
  const pages: Page[] = [];
  let current = { n: 0, buf: [] as string[] };

  for (const line of lines) {
    const m = line.match(/^\s*\[\[PAGE:(\d+)\]\]\s*$/);
    if (m) {
      if (current.n > 0 && current.buf.length) {
        pages.push({ n: current.n, text: current.buf.join("\n").trim() });
      }
      current = { n: parseInt(m[1], 10), buf: [] };
    } else {
      current.buf.push(line);
    }
  }
  if (current.n > 0 && current.buf.length) {
    pages.push({ n: current.n, text: current.buf.join("\n").trim() });
  }
  return pages;
}

async function getBaseUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_BASE_URL && process.env.NEXT_PUBLIC_BASE_URL.trim()) {
    return process.env.NEXT_PUBLIC_BASE_URL.trim();
  }
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

function normalizePackId(id?: string | null) {
  const v = (id ?? '').toLowerCase().trim();
  if (!v) return 'scientific-advertising';
  if (v === 'hopkins-scientific-advertising' || v === 'hopkins' || v === 'scientific' || v === 'scientific_advertising') {
    return 'scientific-advertising';
  }
  return v === 'optimal-poker' ? 'optimal-poker' : 'scientific-advertising';
}

async function loadSourceText(packParam?: string | null): Promise<string> {
  const base = await getBaseUrl();
  const pack = normalizePackId(packParam);
  const root = `${base}/packs/${encodeURIComponent(pack)}`;

  // Try OP file first, then SA file, then a generic fallback
  const candidates = [
    `${root}/source.txt`,            // Optimal Poker
    `${root}/source_normalized.txt`, // Scientific Advertising
    `${root}/book.txt`,
  ];

  for (const url of candidates) {
    const res = await fetch(url, { cache: "force-cache" });
    if (res.ok) return res.text();
    if (res.status !== 404) {
      throw new Error(`Failed to fetch source text for ${pack} from ${url}: ${res.status}`);
    }
  }

  throw new Error(`No source text found for ${pack} (tried ${candidates.map(u => u.split('/').pop()).join(', ')})`);
}




export default async function SourcePage({
  searchParams,
}: {
  searchParams?: { p?: string; pack?: string }; // add pack to type
}) {
  const raw = await loadSourceText(searchParams?.pack); // pass pack through
  const pages = splitPages(raw);

  // Fallback: if file has no [[PAGE:n]] markers (e.g., Optimal Poker), show whole text as Page 1
  const viewPages = pages.length > 0 ? pages : [{ n: 1, text: raw.trim() }];

  const targetParam = (searchParams?.p ?? "").trim();


  const targetPage = Number(targetParam);
  const validTarget = Number.isFinite(targetPage) && targetPage > 0;
  const hash = validTarget ? `#p-${targetPage}` : "";

  return (
    <main className="p-4 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold mb-3">{packLabel} — Source</h1>
      <p className="text-sm mb-4">
        {viewPages.length > 1
          ? "Jump to a page by number (uses [[PAGE:n]] markers)."
          : "This source doesn’t include page markers; showing full text as Page 1."}
      </p>


      <form action="/source" method="get" className="flex items-center gap-2 mb-4">
        <input type="hidden" name="pack" value={normalizePackId(searchParams?.pack)} />
        <label htmlFor="p" className="text-sm">
          Page:
        </label>
        <input
          id="p"
          name="p"
          defaultValue={validTarget ? String(targetPage) : ""}
          placeholder="e.g. 16"
          className="border rounded px-2 py-1 w-24"
        />
        <button type="submit" className="border rounded px-3 py-1">
          Go
        </button>
        {validTarget ? (
          <a href={`#p-${targetPage}`} className="underline text-sm ml-2">
            Jump to #{targetPage}
          </a>
        ) : null}
      </form>

      {validTarget ? (
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                var h = "${hash}";
                if (h && location.hash !== h) {
                  location.hash = h;
                }
              })();
            `,
          }}
        />
      ) : null}

      <div className="space-y-4">
        {viewPages.map((pg) => (
          <section key={pg.n} id={`p-${pg.n}`} className="border rounded p-3">
            <div className="text-xs text-gray-600 mb-1">Page {pg.n}</div>
            <pre className="whitespace-pre-wrap text-sm">{pg.text}</pre>
          </section>
        ))}
      </div>
    </main>
  );
}
