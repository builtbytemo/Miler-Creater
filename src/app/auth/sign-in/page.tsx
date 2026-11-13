'use client';

import { useActionState, Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { signInWithEmail, type AuthActionResult } from '@/lib/auth/actions';
import { GoogleOAuthButton } from '@/components/auth/GoogleOAuthButton';
import { getSafeRedirectPath } from '@/lib/auth/redirects';

function SignInContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawRedirect = searchParams.get('redirectTo');
  const redirectTo = getSafeRedirectPath(rawRedirect, '/dashboard');
  const callbackError = searchParams.get('error');

  const [state, formAction, isPending] = useActionState<AuthActionResult | null, FormData>(
    signInWithEmail,
    null
  );

  useEffect(() => {
    if (state?.success && state.redirectTo) {
      const target = getSafeRedirectPath(state.redirectTo, '/dashboard');
      router.push(target);
      router.refresh();
    }
  }, [state, router]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="heading-section text-base">
          Sign in to your workspace
        </h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          Access your unified content calendar and tasks
        </p>
      </div>

      {callbackError && (
        <div className="p-3 text-xs rounded-[var(--radius-sm)] border badge-danger">
          Authentication session error: {callbackError}. Please sign in again.
        </div>
      )}

      {state?.error && (
        <div className="p-3 text-xs rounded-[var(--radius-sm)] border badge-danger">
          {state.error}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="redirectTo" value={redirectTo} />

        <div>
          <label
            htmlFor="email"
            className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
          >
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="input-control px-3 py-2 text-sm"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label
              htmlFor="password"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              Password
            </label>
            <Link
              href="/auth/forgot-password"
              className="text-xs text-[var(--accent-text)] hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="input-control px-3 py-2 text-sm"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="btn-accent w-full py-2 px-4 text-sm disabled:opacity-50"
        >
          {isPending ? 'Signing in...' : 'Sign in with Email'}
        </button>
      </form>

      <div className="relative my-3">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[var(--border-subtle)]" />
        </div>
        <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
          <span className="bg-[var(--bg-surface)] px-2 text-[var(--text-muted)]">or</span>
        </div>
      </div>

      <GoogleOAuthButton text="Sign in with Google" redirectTo={redirectTo} />

      <div className="pt-1 text-center text-xs text-[var(--text-secondary)]">
        Don&apos;t have an account?{' '}
        <Link
          href="/auth/sign-up"
          className="font-medium text-[var(--accent-text)] hover:underline"
        >
          Create one
        </Link>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="text-center text-xs text-[var(--text-muted)] py-8">
          Loading sign-in form...
        </div>
      }
    >
      <SignInContent />
    </Suspense>
  );
}
