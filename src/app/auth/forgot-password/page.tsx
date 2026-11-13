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
    <div className="space-y-5">
      <div>
        <h2 className="heading-section text-base">
          Reset your password
        </h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          Enter your registered email to receive a recovery link
        </p>
      </div>

      {state?.error && (
        <div className="p-3 text-xs rounded-[var(--radius-sm)] border badge-danger">
          {state.error}
        </div>
      )}

      {state?.success && state.message && (
        <div className="p-3 text-xs rounded-[var(--radius-sm)] border badge-success">
          {state.message}
        </div>
      )}

      <form action={formAction} className="space-y-4">
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

        <button
          type="submit"
          disabled={isPending}
          className="btn-accent w-full py-2 px-4 text-sm disabled:opacity-50"
        >
          {isPending ? 'Sending recovery link...' : 'Send Recovery Link'}
        </button>
      </form>

      <div className="pt-1 text-center text-xs text-[var(--text-secondary)]">
        Remember your password?{' '}
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
