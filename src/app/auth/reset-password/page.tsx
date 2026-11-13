'use client';

import { useActionState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { updatePassword, type AuthActionResult } from '@/lib/auth/actions';
import { AuthAlert } from '@/components/auth/AuthAlert';
import { Button } from '@/components/ui/Button';
import { FormField, Input } from '@/components/ui/Input';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<
    AuthActionResult | null,
    FormData
  >(updatePassword, null);

  useEffect(() => {
    if (state?.success && state.redirectTo) {
      router.push(state.redirectTo);
      router.refresh();
    }
  }, [state, router]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="heading-section text-lg">Set new password</h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          Choose a strong password for your account
        </p>
      </div>

      {state?.error && <AuthAlert tone="danger" message={state.error} />}

      <form action={formAction} className="space-y-4">
        <FormField htmlFor="password" label="New Password (min 8 characters)">
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

        <FormField htmlFor="confirmPassword" label="Confirm New Password">
          <Input
            id="confirmPassword"
            name="confirmPassword"
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
          {isPending ? 'Updating password...' : 'Update Password & Sign In'}
        </Button>
      </form>

      <div className="pt-2 text-center text-xs text-[var(--text-secondary)]">
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
