// app/pack/page.tsx
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { verifyPack } from '@/lib/pack';

export default async function PackPage() {
  const report = await verifyPack();

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pack Integrity</h1>
        <nav className="text-sm">
          <Link href="/" className="underline">Home</Link>
        </nav>
      </header>

      <section className="rounded-2xl border p-4">
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${report.sealed ? 'bg-green-500' : 'bg-yellow-500'}`} />
          <div className="text-lg font-medium">
            {report.sealed ? 'Verified pack' : 'Unsealed pack'}
          </div>
        </div>
        <div className="mt-2 text-sm text-gray-600">
          <div><span className="font-medium">ID:</span> {report.manifest.id}</div>
          <div><span className="font-medium">Title:</span> {report.manifest.title}</div>
          <div><span className="font-medium">Author:</span> {report.manifest.author}</div>
          <div><span className="font-medium">Edition:</span> {report.manifest.edition}</div>
          <div><span className="font-medium">Created:</span> {report.manifest.created_at}</div>
        </div>
      </section>

      <section className="rounded-2xl border">
        <div className="p-4 border-b font-semibold">Files</div>
        <div className="divide-y">
          {report.files.map((f) => (
            <div key={f.path} className="p-4 text-sm">
              <div className="flex items-center justify-between">
                <div className="font-medium">{f.purpose}</div>
                <div className={`text-xs ${f.ok === true ? 'text-green-600' : f.ok === false ? 'text-red-600' : 'text-yellow-600'}`}>
                  {f.exists ? (f.ok === true ? 'OK' : f.ok === false ? 'MISMATCH' : 'NO EXPECTED') : 'MISSING'}
                </div>
              </div>
              <div className="mt-1 text-gray-600 break-all">
                <div><span className="font-medium">Path:</span> {f.path}</div>
                <div><span className="font-medium">Size:</span> {f.size ?? '—'} bytes</div>
                <div><span className="font-medium">Expected:</span> {f.expected ?? '—'}</div>
                <div><span className="font-medium">Computed:</span> {f.computed ?? '—'}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="text-sm text-gray-600">
        Tip: Open <code className="px-1 py-0.5 rounded bg-gray-100">/api/pack/integrity</code> to copy computed hashes,
        then paste them into <code className="px-1 py-0.5 rounded bg-gray-100">public/pack/manifest.json</code> to “seal” the pack.
      </section>
    </main>
  );
}
