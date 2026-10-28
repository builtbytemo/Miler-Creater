'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getSafeRedirectPath } from '@/lib/auth/redirects';
import {
  signInSchema,
  signUpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '@/lib/validation/auth';

export interface AuthActionResult {
  success?: boolean;
  error?: string;
  message?: string;
  redirectTo?: string;
}

export async function signInWithEmail(
  _prevState: AuthActionResult | null,
  formData: FormData
): Promise<AuthActionResult> {
  const rawData = {
    email: formData.get('email'),
    password: formData.get('password'),
  };

  const validation = signInSchema.safeParse(rawData);
  if (!validation.success) {
    return { error: validation.error.issues[0]?.message || 'Invalid input data.' };
  }

  const { email, password } = validation.data;
  const rawRedirect = formData.get('redirectTo') as string;
  const redirectTo = getSafeRedirectPath(rawRedirect, '/dashboard');

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { error: error.message };
    }

    return { success: true, redirectTo };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred during sign-in.',
    };
  }
}

export async function signUpWithEmail(
  _prevState: AuthActionResult | null,
  formData: FormData
): Promise<AuthActionResult> {
  const rawData = {
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
  };

  const validation = signUpSchema.safeParse(rawData);
  if (!validation.success) {
    return { error: validation.error.issues[0]?.message || 'Invalid input data.' };
  }

  const { fullName, email, password } = validation.data;
  const headerList = await headers();
  const origin = headerList.get('origin') || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
        emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
      },
    });

    if (error) {
      return { error: error.message };
    }

    // If Supabase has email confirmations enabled, user must verify email
    if (data.user && data.session === null) {
      return {
        success: true,
        message: 'Account created! Please check your email inbox to verify your email address.',
      };
    }

    return { success: true, redirectTo: '/dashboard' };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred during sign-up.',
    };
  }
}

export async function resetPasswordForEmail(
  _prevState: AuthActionResult | null,
  formData: FormData
): Promise<AuthActionResult> {
  const rawData = {
    email: formData.get('email'),
  };

  const validation = forgotPasswordSchema.safeParse(rawData);
  if (!validation.success) {
    return { error: validation.error.issues[0]?.message || 'Invalid email address.' };
  }

  const { email } = validation.data;
  const headerList = await headers();
  const origin = headerList.get('origin') || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/auth/reset-password`,
    });

    if (error) {
      return { error: error.message };
    }

    return {
      success: true,
      message: 'Password reset instructions have been sent to your email address.',
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Failed to request password reset.',
    };
  }
}

export async function updatePassword(
  _prevState: AuthActionResult | null,
  formData: FormData
): Promise<AuthActionResult> {
  const rawData = {
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  };

  const validation = resetPasswordSchema.safeParse(rawData);
  if (!validation.success) {
    return { error: validation.error.issues[0]?.message || 'Invalid password.' };
  }

  const { password } = validation.data;

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      return { error: error.message };
    }

    return { success: true, redirectTo: '/dashboard' };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Failed to update password.',
    };
  }
}

export async function signOutAction(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Continue redirect even if session is already expired
  }
  redirect('/auth/sign-in');
}
