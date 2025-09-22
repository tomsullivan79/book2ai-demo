"use client";
import { useState } from "react";

export default function Home() {
  const [q,setQ]=useState(""); const [a,setA]=useState<string>(""); const [src,setSrc]=useState<any[]>([]);
  async function ask() {
    setA("…thinking…"); setSrc([]);
    const res = await fetch("/api/ask",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ q })});
    const data = await res.json(); setA(data.answer || ""); setSrc(data.top || []);
  }
  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Book2AI — Scientific Advertising (1923)</h1>
      <div className="flex gap-2 mb-4">
        <input className="flex-1 border p-2 rounded" placeholder="Ask Hopkins…" value={q} onChange={e=>setQ(e.target.value)} />
        <button className="border px-4 py-2 rounded" onClick={ask}>Ask</button>
      </div>
      <pre className="whitespace-pre-wrap border p-3 rounded mb-4">{a}</pre>
      <div>
        <h2 className="font-semibold mb-2">Top sources</h2>
        <ul className="space-y-2">
          {src.map((s,i)=>(
            <li key={i} className="text-sm border p-2 rounded"><b>{s.id}</b> {s.page}<br/>{s.text.slice(0,240)}…</li>
          ))}
        </ul>
      </div>
    </main>
  );
}
