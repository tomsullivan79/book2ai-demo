import { NextResponse, NextRequest } from 'next/server';

// ===== Existing admin/creator protection =====
const PROTECTED_PREFIXES = ['/admin', '/creator'];

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

function getCookie(req: NextRequest, name: string): string | null {
  const c = req.cookies.get(name);
  return c ? c.value : null;
}

// ===== NEW: pack normalization for /api/ask/stream =====
function normalizePackId(id: string | null): string | null {
  if (!id) return null;
  const raw = id.trim().toLowerCase();
  // Map legacy SA aliases -> canonical id
  if (
    raw === 'hopkins-scientific-advertising' ||
    raw === 'hopkins' ||
    raw === 'scientific' ||
    raw === 'scientific_advertising' ||
    raw === 'scientificadvertising'
  ) {
    return 'scientific-advertising';
  }
  if (raw === 'scientific-advertising') return 'scientific-advertising';
  if (raw === 'optimal-poker') return 'optimal-poker';
  // pass-through for other ids
  return raw;
}

export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const { pathname } = url;

  // Let /admin/login pass through
  if (pathname === '/admin/login') {
    return NextResponse.next();
  }

  // Protect /admin and /creator (existing behavior)
  if (isProtectedPath(pathname)) {
    const tokenEnv = process.env.ADMIN_TOKEN || '';
    const cookieVal = getCookie(req, 'b2ai_admin');
    const ok = tokenEnv.length > 0 && cookieVal === `ok:${tokenEnv}`;
    if (!ok) {
      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = '/admin/login';
      redirectUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Normalize legacy pack ids for streaming endpoint only
  if (pathname.startsWith('/api/ask/stream')) {
    const current = url.searchParams.get('pack');
    const normalized = normalizePackId(current);
    if (normalized && normalized !== current) {
      url.searchParams.set('pack', normalized);
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

// Expand matcher to include the streaming route (minimal scope)
export const config = {
  matcher: ['/admin/:path*', '/creator/:path*', '/api/ask/stream'],
};
