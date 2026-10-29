import { NextResponse, type NextRequest } from 'next/server';
import { type EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getSafeRedirectPath } from '@/lib/auth/redirects';

/**
 * Allowed email verification types accepted by this application.
 * Rejects arbitrary or unsupported verification types for security.
 */
export const ALLOWED_EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  'signup',
  'email',
  'recovery',
  'invite',
  'email_change',
];

export function isAllowedEmailOtpType(type: string | null | undefined): type is EmailOtpType {
  if (!type) return false;
  return (ALLOWED_EMAIL_OTP_TYPES as readonly string[]).includes(type);
}

/**
 * Constructs a safe redirect response preserving the request's origin and host headers.
 */
function buildSuccessRedirect(request: NextRequest, origin: string, next: string): NextResponse {
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

/**
 * Handles OAuth code exchange, email verification (token_hash / OTP), and auth callback redirects.
 * Sets the authenticated session tokens in cookies.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const incomingError = searchParams.get('error');
  const incomingErrorCode = searchParams.get('error_code');
  const rawNext = searchParams.get('next');
  const next = getSafeRedirectPath(rawNext, '/dashboard');

  // 1. Handle incoming error parameters from Supabase Auth server safely
  if (incomingError) {
    // Sanitize into safe, constant error identifiers without leaking internal messages or codes
    const isExpired =
      incomingErrorCode === 'otp_expired' ||
      incomingError === 'access_denied' ||
      searchParams.get('error_description')?.toLowerCase().includes('expired');

    const errorCode = isExpired ? 'VerificationLinkExpired' : 'AuthCallbackError';
    return NextResponse.redirect(`${origin}/auth/sign-in?error=${errorCode}`);
  }

  // 2. Handle Email OTP / Token Hash Verification flow
  if (token_hash && type) {
    if (!isAllowedEmailOtpType(type)) {
      return NextResponse.redirect(`${origin}/auth/sign-in?error=InvalidVerificationType`);
    }

    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.verifyOtp({
        token_hash,
        type,
      });

      if (!error) {
        return buildSuccessRedirect(request, origin, next);
      }

      return NextResponse.redirect(`${origin}/auth/sign-in?error=FailedToVerifySession`);
    } catch {
      return NextResponse.redirect(`${origin}/auth/sign-in?error=FailedToVerifySession`);
    }
  }

  // 3. Handle OAuth / PKCE Code Exchange flow
  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) {
        return buildSuccessRedirect(request, origin, next);
      }

      return NextResponse.redirect(`${origin}/auth/sign-in?error=FailedToExchangeSession`);
    } catch {
      return NextResponse.redirect(`${origin}/auth/sign-in?error=FailedToExchangeSession`);
    }
  }

  // 4. Fallback if no valid code or token_hash was provided
  return NextResponse.redirect(`${origin}/auth/sign-in?error=InvalidAuthCallback`);
}
