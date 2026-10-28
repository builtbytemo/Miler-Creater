'use client';

import { useActionState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { updatePassword, type AuthActionResult } from '@/lib/auth/actions';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<AuthActionResult | null, FormData>(
    updatePassword,
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
          Set new password
        </h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
          Choose a strong password for your account
        </p>
      </div>

      {state?.error && (
        <div className="p-3 text-xs rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">
          {state.error}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <div>
          <label
            htmlFor="password"
            className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
          >
            New Password (min 8 characters)
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

        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
          >
            Confirm New Password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
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
          {isPending ? 'Updating password...' : 'Update Password & Sign In'}
        </button>
      </form>

      <div className="pt-2 text-center text-xs text-neutral-500 dark:text-neutral-400">
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
