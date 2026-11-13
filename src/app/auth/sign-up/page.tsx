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
    <div className="space-y-5">
      <div>
        <h2 className="heading-section text-base">
          Create your workspace
        </h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          Set up your personal command center for content and tasks
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
            htmlFor="fullName"
            className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
          >
            Full name
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            required
            className="input-control px-3 py-2 text-sm"
            placeholder="Alex Morgan"
          />
        </div>

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
          <label
            htmlFor="password"
            className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
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
            className="input-control px-3 py-2 text-sm"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="btn-accent w-full py-2 px-4 text-sm disabled:opacity-50"
        >
          {isPending ? 'Creating account...' : 'Create Account'}
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

      <GoogleOAuthButton text="Sign up with Google" />

      <div className="pt-1 text-center text-xs text-[var(--text-secondary)]">
        Already have an account?{' '}
        <Link
          href="/auth/sign-in"
          className="font-medium text-[var(--accent-text)] hover:underline"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
