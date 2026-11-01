'use client';

import { useActionState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
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
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Sign in to your workspace
        </h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
          Access your unified content calendar and tasks
        </p>
      </div>

      {callbackError && (
        <div className="p-3 text-xs rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">
          Authentication session error: {callbackError}. Please sign in again.
        </div>
      )}

      {state?.error && (
        <div className="p-3 text-xs rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">
          {state.error}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="redirectTo" value={redirectTo} />

        <div>
          <label
            htmlFor="email"
            className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
          >
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label
              htmlFor="password"
              className="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
            >
              Password
            </label>
            <Link
              href="/auth/forgot-password"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
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
            className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="w-full py-2.5 px-4 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-medium hover:bg-neutral-800 dark:hover:bg-white/90 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {isPending ? 'Signing in...' : 'Sign in with Email'}
        </button>
      </form>

      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-neutral-200 dark:border-neutral-800" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white dark:bg-neutral-900 px-2 text-neutral-400">or</span>
        </div>
      </div>

      <GoogleOAuthButton text="Sign in with Google" redirectTo={redirectTo} />

      <div className="pt-2 text-center text-xs text-neutral-500 dark:text-neutral-400">
        Don&apos;t have an account?{' '}
        <Link
          href="/auth/sign-up"
          className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          Create account
        </Link>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="text-center py-6 text-sm text-neutral-500">Loading sign in...</div>}>
      <SignInContent />
    </Suspense>
  );
}
