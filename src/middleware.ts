import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { getSafeRedirectPath } from '@/lib/auth/redirects';

const PROTECTED_PREFIXES = ['/dashboard', '/settings', '/content', '/tasks', '/calendar'];
const AUTH_PREFIXES = ['/auth/sign-in', '/auth/sign-up', '/auth/forgot-password'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Refresh session & get authenticated user
  const { supabaseResponse, user } = await updateSession(request);

  const isProtectedPath = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isAuthPath = AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  // If attempting to access protected route without a valid session, redirect to sign-in
  if (isProtectedPath && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/sign-in';
    url.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(url);
  }

  // If already logged in and navigating to auth sign-in / sign-up, redirect to safe target or dashboard
  if (isAuthPath && user) {
    const safeTarget = getSafeRedirectPath(
      request.nextUrl.searchParams.get('redirectTo'),
      '/dashboard'
    );
    return NextResponse.redirect(new URL(safeTarget, request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public assets (.svg, .png, .jpg, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
