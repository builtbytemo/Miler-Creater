'use client';

import { useActionState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signUpWithEmail, type AuthActionResult } from '@/lib/auth/actions';
import { GoogleOAuthButton } from '@/components/auth/GoogleOAuthButton';
import { AuthAlert } from '@/components/auth/AuthAlert';
import { Button } from '@/components/ui/Button';
import { FormField, Input } from '@/components/ui/Input';

export default function SignUpPage() {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<
    AuthActionResult | null,
    FormData
  >(signUpWithEmail, null);

  useEffect(() => {
    if (state?.success && state.redirectTo) {
      router.push(state.redirectTo);
      router.refresh();
    }
  }, [state, router]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="heading-section text-lg">Create your workspace</h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          Set up your personal command center for content and tasks
        </p>
      </div>

      {state?.error && <AuthAlert tone="danger" message={state.error} />}
      {state?.success && state.message && (
        <AuthAlert tone="success" message={state.message} />
      )}

      <form action={formAction} className="space-y-4">
        <FormField htmlFor="fullName" label="Full name">
          <Input
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            required
            placeholder="Alex Morgan"
          />
        </FormField>

        <FormField htmlFor="email" label="Email address">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
          />
        </FormField>

        <FormField htmlFor="password" label="Password (min 8 characters)">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="••••••••"
          />
        </FormField>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={isPending}
          className="w-full"
        >
          {isPending ? 'Creating account...' : 'Create Account'}
        </Button>
      </form>

      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[var(--border-subtle)]" />
        </div>
        <div className="relative flex justify-center text-[11px] font-mono uppercase tracking-wider">
          <span className="bg-[var(--bg-surface)] px-2.5 text-[var(--text-muted)]">
            or
          </span>
        </div>
      </div>

      <GoogleOAuthButton text="Sign up with Google" />

      <div className="pt-2 text-center text-xs text-[var(--text-secondary)]">
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
