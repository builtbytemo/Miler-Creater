'use client';

import { useActionState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signUpWithEmail, type AuthActionResult } from '@/lib/auth/actions';
import { GoogleOAuthButton } from '@/components/auth/GoogleOAuthButton';

export default function SignUpPage() {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<AuthActionResult | null, FormData>(
    signUpWithEmail,
    null
  );

  useEffect(() => {
    if (state?.success && state.redirectTo) {
      router.push(state.redirectTo);
      router.refresh();
    }
  }, [state, router]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Create your workspace
        </h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
          Set up your personal command center for content and tasks
        </p>
      </div>

      {state?.error && (
        <div className="p-3 text-xs rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">
          {state.error}
        </div>
      )}

      {state?.success && state.message && (
        <div className="p-3 text-xs rounded-lg bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300">
          {state.message}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <div>
          <label
            htmlFor="fullName"
            className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
          >
            Full name
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            required
            className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Alex Morgan"
          />
        </div>

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
          <label
            htmlFor="password"
            className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
          >
            Password (min 8 characters)
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="w-full py-2.5 px-4 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-medium hover:bg-neutral-800 dark:hover:bg-white/90 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {isPending ? 'Creating account...' : 'Create Account'}
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

      <GoogleOAuthButton text="Sign up with Google" />

      <div className="pt-2 text-center text-xs text-neutral-500 dark:text-neutral-400">
        Already have an account?{' '}
        <Link
          href="/auth/sign-in"
          className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
