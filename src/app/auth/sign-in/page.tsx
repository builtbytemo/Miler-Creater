'use client';

import { useActionState, Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { signInWithEmail, type AuthActionResult } from '@/lib/auth/actions';
import { GoogleOAuthButton } from '@/components/auth/GoogleOAuthButton';
import { AuthAlert } from '@/components/auth/AuthAlert';
import { getSafeRedirectPath } from '@/lib/auth/redirects';
import { Button } from '@/components/ui/Button';
import { FormField, Input } from '@/components/ui/Input';

function SignInContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawRedirect = searchParams.get('redirectTo');
  const redirectTo = getSafeRedirectPath(rawRedirect, '/dashboard');
  const callbackError = searchParams.get('error');

  const [state, formAction, isPending] = useActionState<
    AuthActionResult | null,
    FormData
  >(signInWithEmail, null);

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
        <h2 className="heading-section text-lg">Sign in to your workspace</h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          Access your unified content calendar and tasks
        </p>
      </div>

      {callbackError && (
        <AuthAlert
          tone="danger"
          message={`Authentication session error: ${callbackError}. Please sign in again.`}
        />
      )}

      {state?.error && <AuthAlert tone="danger" message={state.error} />}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="redirectTo" value={redirectTo} />

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

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="password"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              Password
            </label>
            <Link
              href="/auth/forgot-password"
              className="text-xs font-medium text-[var(--accent-text)] hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={isPending}
          className="w-full"
        >
          {isPending ? 'Signing in...' : 'Sign in with Email'}
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

      <GoogleOAuthButton text="Sign in with Google" redirectTo={redirectTo} />

      <div className="pt-2 text-center text-xs text-[var(--text-secondary)]">
        Don&apos;t have an account?{' '}
        <Link
          href="/auth/sign-up"
          className="font-medium text-[var(--accent-text)] hover:underline"
        >
          Create account
        </Link>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="text-center py-6 text-xs text-[var(--text-muted)]">
          Loading sign in...
        </div>
      }
    >
      <SignInContent />
    </Suspense>
  );
}
