'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { resetPasswordForEmail, type AuthActionResult } from '@/lib/auth/actions';

export default function ForgotPasswordPage() {
  const [state, formAction, isPending] = useActionState<AuthActionResult | null, FormData>(
    resetPasswordForEmail,
    null
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Reset your password
        </h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
          Enter your registered email to receive a recovery link
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

        <button
          type="submit"
          disabled={isPending}
          className="w-full py-2.5 px-4 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-medium hover:bg-neutral-800 dark:hover:bg-white/90 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {isPending ? 'Sending recovery link...' : 'Send Recovery Link'}
        </button>
      </form>

      <div className="pt-2 text-center text-xs text-neutral-500 dark:text-neutral-400">
        Remember your password?{' '}
        <Link
          href="/auth/sign-in"
          className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
