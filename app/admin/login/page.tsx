'use client';

import { useEffect, useState } from 'react';

export default function AdminLogin() {
  const [token, setToken] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [nextUrl, setNextUrl] = useState<string>('/admin');

  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const n = u.searchParams.get('next');
      if (n) setNextUrl(n);
    } catch {}
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr((j && j.error) || 'Invalid token');
        return;
      }
      window.location.href = nextUrl || '/admin';
    } catch {
      setErr('Network error');
    }
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-12 text-zinc-900 dark:text-zinc-100">
      <h1 className="text-xl font-semibold mb-2">Admin Login</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6">
        Enter the admin token to access the dashboard.
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="password"
          autoFocus
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-900"
          placeholder="Admin Token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button
          type="submit"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          Sign in
        </button>
        {err && (
          <div className="text-sm text-red-600 dark:text-red-400">
            {err}
          </div>
        )}
      </form>
    </main>
  );
}
