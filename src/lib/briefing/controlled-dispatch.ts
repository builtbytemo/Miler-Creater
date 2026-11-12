/**
 * Scoped configuration and validation guards for controlled staging preview dispatch.
 */

export const CONTROLLED_STAGING_TEST_USER_ID = 'b9dffc37-9bb8-422b-ba72-7ab1c3dfb8e3';
export const CONTROLLED_STAGING_DATE = '2026-11-12';
export const CONTROLLED_STAGING_TIMEZONE = 'Africa/Cairo';
export const STAGING_PROJECT_REF = 'prmgrrzqtnygmitplkhn';
export const PRODUCTION_PROJECT_REF = 'zcpdpizrbaaekteurwup';

export interface ControlledDeliveryChannelState {
  status: 'idle' | 'pending' | 'claimed' | 'sent' | 'failed' | 'ambiguous' | 'retry';
  deliveryId: string | null;
  providerMessageId: string | null;
  error: string | null;
}

export interface ControlledDispatchState {
  isAvailable: boolean;
  targetDate: string;
  targetTimezone: string;
  telegramDestination: string | null;
  emailDestination: string | null;
  telegram: ControlledDeliveryChannelState;
  email: ControlledDeliveryChannelState;
}

export function isControlledDispatchAllowed(): { allowed: boolean; reason?: string } {
  const isPreview =
    process.env.VERCEL_ENV === 'preview' ||
    (process.env.NODE_ENV === 'test' && process.env.ALLOW_CONTROLLED_TEST_DISPATCH === 'true');
  if (!isPreview) {
    return {
      allowed: false,
      reason: 'Controlled staging dispatch is strictly restricted to Vercel Preview environments.',
    };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  if (supabaseUrl.includes(PRODUCTION_PROJECT_REF)) {
    return {
      allowed: false,
      reason: 'Execution against production Supabase is strictly forbidden.',
    };
  }

  if (!supabaseUrl.includes(STAGING_PROJECT_REF) && process.env.NODE_ENV !== 'test') {
    return {
      allowed: false,
      reason: 'Target database must be Miler staging (prmgrrzqtnygmitplkhn).',
    };
  }

  return { allowed: true };
}
