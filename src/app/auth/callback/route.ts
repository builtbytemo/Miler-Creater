import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSafeRedirectPath } from '@/lib/auth/redirects';

/**
 * Handles OAuth code exchange and email verification redirects.
 * Exchanges the temporary authorization code for a session token stored in cookies.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const rawNext = searchParams.get('next');
  const next = getSafeRedirectPath(rawNext, '/dashboard');

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) {
        const forwardedHost = request.headers.get('x-forwarded-host');
        const isLocal = process.env.NODE_ENV === 'development';

        if (isLocal) {
          return NextResponse.redirect(`${origin}${next}`);
        } else if (forwardedHost) {
          return NextResponse.redirect(`https://${forwardedHost}${next}`);
        } else {
          return NextResponse.redirect(`${origin}${next}`);
        }
      }
    } catch {
      return NextResponse.redirect(`${origin}/auth/sign-in?error=FailedToExchangeSession`);
    }
  }

  // Fallback if no code provided or exchange encountered error
  return NextResponse.redirect(`${origin}/auth/sign-in?error=InvalidAuthCallback`);
}
