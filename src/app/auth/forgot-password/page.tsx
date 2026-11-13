'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { resetPasswordForEmail, type AuthActionResult } from '@/lib/auth/actions';
import { AuthAlert } from '@/components/auth/AuthAlert';
import { Button } from '@/components/ui/Button';
import { FormField, Input } from '@/components/ui/Input';

export default function ForgotPasswordPage() {
  const [state, formAction, isPending] = useActionState<
    AuthActionResult | null,
    FormData
  >(resetPasswordForEmail, null);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="heading-section text-lg">Reset your password</h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          Enter your registered email to receive a recovery link
        </p>
      </div>

      {state?.error && <AuthAlert tone="danger" message={state.error} />}
      {state?.success && state.message && (
        <AuthAlert tone="success" message={state.message} />
      )}

      <form action={formAction} className="space-y-4">
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

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={isPending}
          className="w-full"
        >
          {isPending ? 'Sending recovery link...' : 'Send Recovery Link'}
        </Button>
      </form>

      <div className="pt-2 text-center text-xs text-[var(--text-secondary)]">
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
