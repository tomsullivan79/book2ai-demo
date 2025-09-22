"use client";

import { useState } from "react";

type SourceHit = {
  id: string;
  page: string; // e.g., "p.46–50" or "p.107"
  text: string;
};

type AskResponse = {
  answer: string;
  top: SourceHit[];
};

export default function Home() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string>("");
  const [src, setSrc] = useState<SourceHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function ask() {
    if (!q.trim()) return;
    setLoading(true);
    setErrorMsg(null);
    setAnswer("…thinking…");
    setSrc([]);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as
          | { detail?: string; error?: string }
          | null;
        const msg =
          (errJson?.detail ?? errJson?.error) || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const data = (await res.json()) as AskResponse;
      setAnswer(data.answer || "");
      setSrc(Array.isArray(data.top) ? data.top : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setAnswer("");
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }

  function firstPageFromSpan(span: string): number | null {
    const m = span.match(/p\.(\d+)/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
    }

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">
        Book2AI — Scientific Advertising (1923)
      </h1>
      <p className="text-sm text-gray-600 mb-4">
        Ask questions and get page-cited answers from the uploaded source.
      </p>

      <div className="flex gap-2 mb-4">
        <input
          className="flex-1 border p-2 rounded"
          placeholder="Ask Hopkins…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ask();
          }}
        />
        <button
          className="border px-4 py-2 rounded disabled:opacity-60"
          onClick={ask}
          disabled={loading}
        >
          {loading ? "Asking…" : "Ask"}
        </button>
      </div>

      {errorMsg ? (
        <div className="mb-4 text-red-600 text-sm border border-red-300 bg-red-50 p-3 rounded">
          {errorMsg}
        </div>
      ) : null}

      <pre className="whitespace-pre-wrap border p-3 rounded mb-4 min-h-[4rem]">
        {answer}
      </pre>

      <div>
        <h2 className="font-semibold mb-2">Top sources</h2>
        {src.length === 0 ? (
          <p className="text-sm text-gray-600">No sources yet.</p>
        ) : (
          <ul className="space-y-2">
            {src.map((s, i) => {
              const first = firstPageFromSpan(s.page);
              return (
                <li key={i} className="text-sm border p-2 rounded">
                  <b>{s.id}</b> {s.page}
                  {first ? (
                    <>
                      {" "}
                      <a
                        href={`/source?p=${first}`}
                        className="underline ml-2"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open source
                      </a>
                    </>
                  ) : null}
                  <br />
                  {s.text.slice(0, 240)}…
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
