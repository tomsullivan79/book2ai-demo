import { NextResponse, NextRequest } from 'next/server';

// Paths to protect (prefix match)
const PROTECTED_PREFIXES = ['/admin', '/creator'];

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

function getCookie(req: NextRequest, name: string): string | null {
  const c = req.cookies.get(name);
  return c ? c.value : null;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Let auth page itself pass through
  if (pathname === '/admin/login') return NextResponse.next();

  if (isProtectedPath(pathname)) {
    const tokenEnv = process.env.ADMIN_TOKEN || '';
    const cookieVal = getCookie(req, 'b2ai_admin');
    // Simple constant-time-ish check
    const ok = tokenEnv.length > 0 && cookieVal === `ok:${tokenEnv}`;
    if (!ok) {
      const url = req.nextUrl.clone();
      url.pathname = '/admin/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/creator/:path*'],
};
