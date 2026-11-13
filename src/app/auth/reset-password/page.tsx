'use client';

import { useActionState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthAlert } from '@/components/auth/AuthAlert';
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
    <div className="space-y-5">
      <div>
        <h2 className="heading-section text-base">
          Set new password
        </h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          Choose a strong password for your account
        </p>
      </div>

      {state?.error && <AuthAlert tone="danger" message={state.error} />}

      <form action={formAction} className="space-y-4">
        <div>
          <label
            htmlFor="password"
            className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
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
            className="input-control px-3 py-2 text-sm"
            placeholder="••••••••"
          />
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
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
            className="input-control px-3 py-2 text-sm"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="btn-accent w-full py-2 px-4 text-sm disabled:opacity-50"
        >
          {isPending ? 'Updating password...' : 'Update Password & Sign In'}
        </button>
      </form>

      <div className="pt-1 text-center text-xs text-[var(--text-secondary)]">
        <Link
          href="/auth/sign-in"
          className="font-medium text-[var(--accent-text)] hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
