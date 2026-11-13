'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createTelegramAdapter } from '@/lib/briefing/channels/telegram';
import { createEmailAdapter } from '@/lib/briefing/channels/email';
import {
  authorizeEmailDestination,
  getDeliveryServiceStatus,
  getEmailAccessForUser,
  getTelegramBotUsername,
  type DeliveryServiceStatus,
} from '@/lib/briefing/config';
import {
  DEFAULT_BRIEFING_LOCAL_TIME,
  DEFAULT_BRIEFING_TIMEZONE,
  isValidLocalTime,
  isValidTimeZone,
} from '@/lib/briefing/timezone';
import { LINK_TOKEN_TTL_SECONDS, buildDeepLink, generateLinkToken, hashLinkToken } from '@/lib/briefing/telegram-linking';
import type { BriefingChannel } from '@/lib/briefing/types';

export interface DailyBriefingState {
  enabled: boolean;
  emailEnabled: boolean;
  telegramEnabled: boolean;
  timezone: string;
  deliveryLocalTime: string;
  telegram: { status: 'not_connected' | 'active' | 'blocked'; username: string | null };
  emailAddressVerified: boolean;
  service: DeliveryServiceStatus;
}

export interface BriefingActionResult<T = undefined> {
  success?: boolean;
  error?: string;
  data?: T;
}

async function requireUser(): Promise<{
  supabase: SupabaseClient;
  userId: string;
  email: string | null;
  emailVerified: boolean;
} | null> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return {
    supabase,
    userId: data.user.id,
    email: data.user.email ?? null,
    emailVerified: Boolean(data.user.email && data.user.email_confirmed_at),
  };
}

function validateEmailAccessError(
  ctx: { userId: string; email: string | null; emailVerified: boolean },
  notConfiguredMessage: string
): string | null {
  const access = getEmailAccessForUser(ctx.userId, ctx.email, ctx.emailVerified);
  if (access.reason === 'not_configured') return notConfiguredMessage;
  if (access.reason === 'user_unauthorized') return 'Email delivery is not available for this account';
  if (access.reason === 'email_unverified') return 'Your account email address is not verified';
  if (access.reason === 'recipient_mismatch') {
    return 'Your verified email address is not authorized for email delivery';
  }
  return null;
}

export async function getDailyBriefingStateAction(): Promise<BriefingActionResult<DailyBriefingState>> {
  const ctx = await requireUser();
  if (!ctx) return { error: 'Authentication required' };

  const [{ data: prefs }, { data: conn }] = await Promise.all([
    ctx.supabase.from('daily_briefing_preferences').select('*').eq('user_id', ctx.userId).maybeSingle(),
    ctx.supabase.from('telegram_connections').select('status, telegram_username').eq('user_id', ctx.userId).maybeSingle(),
  ]);

  const service = getDeliveryServiceStatus();
  const access = getEmailAccessForUser(ctx.userId, ctx.email, ctx.emailVerified);

  return {
    data: {
      enabled: prefs?.enabled ?? false,
      emailEnabled: access.configuredForUser && access.destinationAuthorized ? (prefs?.email_enabled ?? false) : false,
      telegramEnabled: prefs?.telegram_enabled ?? false,
      timezone: prefs?.timezone ?? DEFAULT_BRIEFING_TIMEZONE,
      deliveryLocalTime: String(prefs?.delivery_local_time ?? DEFAULT_BRIEFING_LOCAL_TIME).slice(0, 5),
      telegram: conn
        ? { status: conn.status as 'active' | 'blocked', username: conn.telegram_username ?? null }
        : { status: 'not_connected', username: null },
      emailAddressVerified: ctx.emailVerified,
      service: {
        ...service,
        emailConfigured: access.configuredForUser,
        ...(access.reason === 'recipient_mismatch' ? { emailRecipientMismatch: true } : {}),
      },
    },
  };
}

export async function updateDailyBriefingPreferencesAction(input: {
  enabled?: boolean;
  emailEnabled?: boolean;
  telegramEnabled?: boolean;
  timezone?: string;
  deliveryLocalTime?: string;
}): Promise<BriefingActionResult> {
  const ctx = await requireUser();
  if (!ctx) return { error: 'Authentication required' };

  if (input.timezone !== undefined && !isValidTimeZone(input.timezone)) return { error: 'Invalid timezone' };
  if (input.deliveryLocalTime !== undefined && !isValidLocalTime(input.deliveryLocalTime)) {
    return { error: 'Invalid delivery time' };
  }
  if (input.emailEnabled) {
    const emailErr = validateEmailAccessError(ctx, 'Email delivery is not configured on this server');
    if (emailErr) return { error: emailErr };
  }

  const patch: Record<string, unknown> = {};
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.emailEnabled !== undefined) patch.email_enabled = input.emailEnabled;
  if (input.telegramEnabled !== undefined) patch.telegram_enabled = input.telegramEnabled;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.deliveryLocalTime !== undefined) patch.delivery_local_time = input.deliveryLocalTime;

  // 1. Attempt updating the existing preferences row through authenticated RLS.
  // We use direct update/insert rather than upsert because PostgREST upsert (INSERT ... ON CONFLICT DO UPDATE)
  // requires table-level UPDATE privilege in PostgreSQL, whereas our security policy grants column-level
  // privileges to protect email_consent_at and last_test_sent_at from client tampering.
  const { data: updated, error: updateErr } = await ctx.supabase
    .from('daily_briefing_preferences')
    .update(patch)
    .eq('user_id', ctx.userId)
    .select('user_id');

  if (updateErr) {
    console.error('[DailyBriefing Preferences] Update error:', updateErr.message, updateErr.code);
    return { error: 'Could not save Daily Briefing preferences' };
  }

  // 2. If no row existed yet for this user, insert the initial preferences row
  if (!updated || updated.length === 0) {
    const { error: insertErr } = await ctx.supabase
      .from('daily_briefing_preferences')
      .insert({ user_id: ctx.userId, ...patch });

    if (insertErr) {
      if (insertErr.code === '23505') {
        // Concurrent insert race condition: retry update
        const { error: retryErr } = await ctx.supabase
          .from('daily_briefing_preferences')
          .update(patch)
          .eq('user_id', ctx.userId);
        if (retryErr) {
          console.error('[DailyBriefing Preferences] Retry update error:', retryErr.message, retryErr.code);
          return { error: 'Could not save Daily Briefing preferences' };
        }
      } else {
        console.error('[DailyBriefing Preferences] Insert error:', insertErr.message, insertErr.code);
        return { error: 'Could not save Daily Briefing preferences' };
      }
    }
  }

  revalidatePath('/settings/notifications');
  return { success: true };
}

export async function startTelegramConnectionAction(): Promise<BriefingActionResult<{ deepLink: string; expiresAt: string }>> {
  const ctx = await requireUser();
  if (!ctx) return { error: 'Authentication required' };

  const username = getTelegramBotUsername();
  if (!getDeliveryServiceStatus().telegramConfigured || !username) {
    return { error: 'Telegram is not configured on this server yet' };
  }

  const token = generateLinkToken();
  const { data, error } = await ctx.supabase.rpc('create_telegram_link_token', {
    p_token_hash: hashLinkToken(token),
    p_ttl_seconds: LINK_TOKEN_TTL_SECONDS,
  });
  if (error) return { error: 'Could not start the Telegram connection. Please try again later.' };
  return { success: true, data: { deepLink: buildDeepLink(username, token), expiresAt: String(data) } };
}

export async function disconnectTelegramAction(): Promise<BriefingActionResult> {
  const ctx = await requireUser();
  if (!ctx) return { error: 'Authentication required' };

  const { error } = await ctx.supabase.from('telegram_connections').delete().eq('user_id', ctx.userId);
  if (error) return { error: 'Could not disconnect Telegram' };
  await ctx.supabase.from('daily_briefing_preferences').update({ telegram_enabled: false }).eq('user_id', ctx.userId);

  revalidatePath('/settings/notifications');
  return { success: true };
}

const TEST_COOLDOWN_MS = 60_000;

/**
 * Explicit, user-triggered provider check. Sends a fixed "test" message to the caller's OWN
 * verified destination only. This is not a briefing and never uses the content generator.
 */
export async function sendTestBriefingMessageAction(channel: BriefingChannel): Promise<BriefingActionResult> {
  const ctx = await requireUser();
  if (!ctx) return { error: 'Authentication required' };
  if (channel !== 'email' && channel !== 'telegram') return { error: 'Invalid channel' };

  const status = getDeliveryServiceStatus();
  if (channel === 'telegram' && !status.telegramConfigured) return { error: 'Telegram is not configured on this server yet' };
  if (channel === 'email') {
    const emailErr = validateEmailAccessError(ctx, 'Email delivery is not configured on this server yet');
    if (emailErr) return { error: emailErr };
  }

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: prefs } = await admin
    .from('daily_briefing_preferences')
    .select('last_test_sent_at')
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (prefs?.last_test_sent_at && Date.now() - new Date(prefs.last_test_sent_at).getTime() < TEST_COOLDOWN_MS) {
    return { error: 'Please wait a minute before sending another test' };
  }

  const message = {
    channel,
    subject: 'Zahi delivery test',
    text: 'This is a Zahi test message confirming that delivery to this destination works. It is not a Daily Briefing.',
  };

  let result;
  if (channel === 'telegram') {
    const { data: conn } = await admin
      .from('telegram_connections')
      .select('chat_id, status')
      .eq('user_id', ctx.userId)
      .maybeSingle();
    if (!conn || conn.status !== 'active') return { error: 'Telegram is not connected' };
    result = await createTelegramAdapter().send({ chatId: conn.chat_id }, message);
  } else {
    if (!ctx.emailVerified) return { error: 'Your account email address is not verified' };
    const { data: u } = await admin.auth.admin.getUserById(ctx.userId);
    if (!u.user?.email || !u.user.email_confirmed_at) return { error: 'No verified email address' };
    const destAuth = authorizeEmailDestination(u.user.email, ctx.userId);
    if (!destAuth.allowed) return { error: 'Your verified email address is not authorized for email delivery' };
    result = await createEmailAdapter().send({ to: destAuth.normalizedTo }, message);
  }

  // Record the attempt time regardless of outcome to bound abuse.
  await admin
    .from('daily_briefing_preferences')
    .upsert({ user_id: ctx.userId, last_test_sent_at: new Date().toISOString() }, { onConflict: 'user_id' });

  if (!result.ok) return { error: `Test delivery failed (${result.code})` };
  return { success: true };
}
