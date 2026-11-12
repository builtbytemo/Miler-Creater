'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createTelegramAdapter, type TelegramDestination } from '@/lib/briefing/channels/telegram';
import { createEmailAdapter, type EmailDestination } from '@/lib/briefing/channels/email';
import { createDailyBriefingGenerator } from '@/lib/briefing/daily/generator';
import { getDeliveryServiceStatus, getTelegramBotUsername, type DeliveryServiceStatus } from '@/lib/briefing/config';
import {
  DEFAULT_BRIEFING_LOCAL_TIME,
  DEFAULT_BRIEFING_TIMEZONE,
  isValidLocalTime,
  isValidTimeZone,
} from '@/lib/briefing/timezone';
import { LINK_TOKEN_TTL_SECONDS, buildDeepLink, generateLinkToken, hashLinkToken } from '@/lib/briefing/telegram-linking';
import type { BriefingChannel, DeliveryResult } from '@/lib/briefing/types';

import {
  CONTROLLED_STAGING_TEST_USER_ID,
  CONTROLLED_STAGING_DATE,
  CONTROLLED_STAGING_TIMEZONE,
  isControlledDispatchAllowed,
  type ControlledDeliveryChannelState,
  type ControlledDispatchState,
} from '@/lib/briefing/controlled-dispatch';

export type { ControlledDeliveryChannelState, ControlledDispatchState };

export interface DailyBriefingState {
  enabled: boolean;
  emailEnabled: boolean;
  telegramEnabled: boolean;
  timezone: string;
  deliveryLocalTime: string;
  telegram: { status: 'not_connected' | 'active' | 'blocked'; username: string | null };
  emailAddressVerified: boolean;
  service: DeliveryServiceStatus;
  controlledDispatch?: ControlledDispatchState;
}

export interface BriefingActionResult<T = undefined> {
  success?: boolean;
  error?: string;
  data?: T;
}

async function requireUser(): Promise<{ supabase: SupabaseClient; userId: string; emailVerified: boolean } | null> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return { supabase, userId: data.user.id, emailVerified: Boolean(data.user.email && data.user.email_confirmed_at) };
}

export async function getDailyBriefingStateAction(): Promise<BriefingActionResult<DailyBriefingState>> {
  const ctx = await requireUser();
  if (!ctx) return { error: 'Authentication required' };

  const [{ data: prefs }, { data: conn }] = await Promise.all([
    ctx.supabase.from('daily_briefing_preferences').select('*').eq('user_id', ctx.userId).maybeSingle(),
    ctx.supabase.from('telegram_connections').select('status, telegram_username').eq('user_id', ctx.userId).maybeSingle(),
  ]);

  let controlledDispatch: ControlledDispatchState | undefined = undefined;
  if (isControlledDispatchAllowed().allowed && ctx.userId === CONTROLLED_STAGING_TEST_USER_ID) {
    try {
      const admin = createAdminClient() as unknown as SupabaseClient;
      const [{ data: deliveries }, { data: authUser }] = await Promise.all([
        admin
          .from('briefing_deliveries')
          .select('id, channel, status, provider_message_id, last_error_code')
          .eq('user_id', ctx.userId)
          .eq('local_date', CONTROLLED_STAGING_DATE),
        admin.auth.admin.getUserById(ctx.userId),
      ]);

      const tgDelivery = deliveries?.find((d) => d.channel === 'telegram');
      const emDelivery = deliveries?.find((d) => d.channel === 'email');

      controlledDispatch = {
        isAvailable: true,
        targetDate: CONTROLLED_STAGING_DATE,
        targetTimezone: CONTROLLED_STAGING_TIMEZONE,
        telegramDestination: conn?.telegram_username ? `@${conn.telegram_username}` : null,
        emailDestination: authUser?.user?.email ?? null,
        telegram: {
          status: (tgDelivery?.status as ControlledDeliveryChannelState['status']) ?? 'idle',
          deliveryId: tgDelivery?.id ?? null,
          providerMessageId: tgDelivery?.provider_message_id ?? null,
          error: tgDelivery?.last_error_code ?? null,
        },
        email: {
          status: (emDelivery?.status as ControlledDeliveryChannelState['status']) ?? 'idle',
          deliveryId: emDelivery?.id ?? null,
          providerMessageId: emDelivery?.provider_message_id ?? null,
          error: emDelivery?.last_error_code ?? null,
        },
      };
    } catch (e) {
      console.error('[Controlled Dispatch State] Error fetching delivery status:', e);
    }
  }

  return {
    data: {
      enabled: prefs?.enabled ?? false,
      emailEnabled: prefs?.email_enabled ?? false,
      telegramEnabled: prefs?.telegram_enabled ?? false,
      timezone: prefs?.timezone ?? DEFAULT_BRIEFING_TIMEZONE,
      deliveryLocalTime: String(prefs?.delivery_local_time ?? DEFAULT_BRIEFING_LOCAL_TIME).slice(0, 5),
      telegram: conn
        ? { status: conn.status as 'active' | 'blocked', username: conn.telegram_username ?? null }
        : { status: 'not_connected', username: null },
      emailAddressVerified: ctx.emailVerified,
      service: getDeliveryServiceStatus(),
      controlledDispatch,
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
  if (input.emailEnabled && !ctx.emailVerified) {
    return { error: 'Your account email address is not verified' };
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
  if (channel === 'email' && !status.emailConfigured) return { error: 'Email delivery is not configured on this server yet' };

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
    subject: 'Miler delivery test',
    text: 'This is a Miler test message confirming that delivery to this destination works. It is not a Daily Briefing.',
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
    if (!u.user?.email) return { error: 'No verified email address' };
    result = await createEmailAdapter().send({ to: u.user.email }, message);
  }

  // Record the attempt time regardless of outcome to bound abuse.
  await admin
    .from('daily_briefing_preferences')
    .upsert({ user_id: ctx.userId, last_test_sent_at: new Date().toISOString() }, { onConflict: 'user_id' });

  if (!result.ok) return { error: `Test delivery failed (${result.code})` };
  return { success: true };
}

/**
 * Temporary Preview-Only Controlled Dispatch Action.
 *
 * Exclusively executes in Vercel Preview against staging Supabase (prmgrrzqtnygmitplkhn)
 * for the verified staging test user (b9dffc37-9bb8-422b-ba72-7ab1c3dfb8e3).
 *
 * Reuses the production briefing generator, channel adapters, and finalize_briefing_delivery RPC
 * with an atomic exact-delivery-ID claim mechanism.
 */
export async function dispatchControlledStagingBriefingAction(
  channel: BriefingChannel
): Promise<
  BriefingActionResult<{
    deliveryId: string;
    status: string;
    outcome: string;
    providerMessageId?: string;
    errorCode?: string;
  }>
> {
  // 1. Mandatory Environment & Target Guards
  const envCheck = isControlledDispatchAllowed();
  if (!envCheck.allowed) {
    return { error: envCheck.reason || 'Controlled dispatch is not permitted in this environment.' };
  }

  if (channel !== 'telegram' && channel !== 'email') {
    return { error: 'Invalid channel. Only telegram and email are supported.' };
  }

  // 2. Strict Session Authentication & Ownership Guard
  const ctx = await requireUser();
  if (!ctx) {
    return { error: 'Authentication required.' };
  }

  if (ctx.userId !== CONTROLLED_STAGING_TEST_USER_ID) {
    return { error: 'Unauthorized: Controlled staging dispatch is restricted to the authorized staging test user.' };
  }

  // 3. User Preferences, Verification & Consent Verification
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: prefs, error: prefErr } = await admin
    .from('daily_briefing_preferences')
    .select('*')
    .eq('user_id', ctx.userId)
    .maybeSingle();

  if (prefErr || !prefs) {
    return { error: `Failed to load preferences: ${prefErr?.message || 'Preferences not found'}` };
  }

  if (!prefs.enabled) {
    return { error: 'Daily Briefing master switch is disabled. Please enable it in Settings.' };
  }

  let destination: TelegramDestination | EmailDestination;

  if (channel === 'telegram') {
    if (!prefs.telegram_enabled) {
      return { error: 'Telegram delivery is disabled in your preferences.' };
    }
    const { data: conn } = await admin
      .from('telegram_connections')
      .select('chat_id, status')
      .eq('user_id', ctx.userId)
      .maybeSingle();
    if (!conn || conn.status !== 'active') {
      return { error: 'Active Telegram connection not found for this account.' };
    }
    destination = { chatId: conn.chat_id };
  } else {
    if (!prefs.email_enabled || !prefs.email_consent_at) {
      return { error: 'Email delivery requires email_enabled=true and recorded email consent.' };
    }
    if (!ctx.emailVerified) {
      return { error: 'Your account email address is not verified.' };
    }
    const { data: authUser } = await admin.auth.admin.getUserById(ctx.userId);
    if (!authUser?.user?.email || !authUser.user.email_confirmed_at) {
      return { error: 'Confirmed email address not found.' };
    }
    destination = { to: authUser.user.email };
  }

  // 4. Check Existing Delivery Slot for November 12
  const { data: existingDelivery } = await admin
    .from('briefing_deliveries')
    .select('*')
    .eq('user_id', ctx.userId)
    .eq('channel', channel)
    .eq('local_date', CONTROLLED_STAGING_DATE)
    .maybeSingle();

  if (existingDelivery) {
    if (existingDelivery.status === 'sent') {
      return {
        error: `Briefing for ${CONTROLLED_STAGING_DATE} via ${channel} has already been sent successfully. Duplicate sends are prohibited.`,
        data: {
          deliveryId: existingDelivery.id,
          status: 'sent',
          outcome: 'sent',
          providerMessageId: existingDelivery.provider_message_id || undefined,
        },
      };
    }
    if (
      existingDelivery.status === 'claimed' &&
      existingDelivery.claim_expires_at &&
      new Date(existingDelivery.claim_expires_at).getTime() > Date.now()
    ) {
      return { error: 'Delivery is currently being processed by an active worker. Please wait.' };
    }
    if (existingDelivery.status === 'ambiguous') {
      return { error: 'Previous delivery outcome was ambiguous. Automatic retries are disabled to prevent duplicate messages.' };
    }
  }

  // 5. Enqueue or Resolve Pending Delivery Slot
  let deliveryId: string;
  let currentAttemptCount = 0;

  if (!existingDelivery) {
    const deliverySlot = {
      user_id: ctx.userId,
      channel,
      local_date: CONTROLLED_STAGING_DATE,
      timezone: CONTROLLED_STAGING_TIMEZONE,
      scheduled_for: new Date().toISOString(),
      next_attempt_at: new Date().toISOString(),
      status: 'pending',
    };

    const { data: enqueued, error: enqErr } = await admin
      .from('briefing_deliveries')
      .insert(deliverySlot)
      .select('id, status, attempt_count')
      .single();

    if (enqErr) {
      if (enqErr.code === '23505') {
        const { data: refetched } = await admin
          .from('briefing_deliveries')
          .select('id, status, attempt_count')
          .eq('user_id', ctx.userId)
          .eq('channel', channel)
          .eq('local_date', CONTROLLED_STAGING_DATE)
          .single();
        if (!refetched) return { error: 'Failed to resolve concurrent delivery slot.' };
        deliveryId = refetched.id;
        currentAttemptCount = refetched.attempt_count;
      } else {
        return { error: `Failed to enqueue delivery: ${enqErr.message}` };
      }
    } else {
      deliveryId = enqueued.id;
      currentAttemptCount = enqueued.attempt_count;
    }
  } else {
    deliveryId = existingDelivery.id;
    currentAttemptCount = existingDelivery.attempt_count;
  }

  // 6. Atomic Exact-Row Claim
  const claimToken = crypto.randomUUID();
  const leaseSeconds = 300;
  const nowIso = new Date().toISOString();
  const claimExpiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();

  const { data: claimedRow, error: claimErr } = await admin
    .from('briefing_deliveries')
    .update({
      status: 'claimed',
      claim_token: claimToken,
      claimed_at: nowIso,
      claim_expires_at: claimExpiresAt,
      attempt_count: currentAttemptCount + 1,
      updated_at: nowIso,
    })
    .eq('id', deliveryId)
    .in('status', ['pending', 'retry', 'failed'])
    .select('id, attempt_count')
    .maybeSingle();

  if (claimErr || !claimedRow) {
    return { error: 'Delivery could not be claimed. It may have already been claimed or processed concurrently.' };
  }

  // 7. Generate Real Briefing Content for November 12
  const generator = createDailyBriefingGenerator(admin);
  const contentResult = await generator.generate({
    userId: ctx.userId,
    localDate: CONTROLLED_STAGING_DATE,
    channel,
  });

  if (contentResult.status !== 'ready') {
    await admin.rpc('finalize_briefing_delivery', {
      p_id: deliveryId,
      p_claim_token: claimToken,
      p_outcome: 'failed',
      p_error_code: 'content_generation_failed',
      p_error_message: 'Content generator returned non-ready status',
    });
    return { error: 'Failed to generate briefing content for November 12.' };
  }

  // 8. Real Channel Dispatch with Adapter
  let sendResult: DeliveryResult;
  if (channel === 'telegram') {
    const adapter = createTelegramAdapter();
    sendResult = await adapter.send(destination as TelegramDestination, contentResult.message);
  } else {
    const adapter = createEmailAdapter();
    sendResult = await adapter.send(destination as EmailDestination, contentResult.message, {
      idempotencyKey: `briefing-${deliveryId}`,
    });
  }

  // 9. Map DeliveryResult to Outcome
  let outcome = 'failed';
  let errorCode: string | null = null;
  let providerMessageId: string | null = null;

  if (sendResult.ok) {
    outcome = 'sent';
    providerMessageId = sendResult.providerMessageId || null;
  } else {
    errorCode = sendResult.code || null;
    if (sendResult.kind === 'ambiguous') {
      outcome = 'ambiguous';
    } else if (sendResult.kind === 'rate_limited') {
      outcome = 'retry';
    } else {
      outcome = 'failed';
    }
  }

  // 10. Authentic Ledger Finalization via Production RPC
  const { error: finErr } = await admin.rpc('finalize_briefing_delivery', {
    p_id: deliveryId,
    p_claim_token: claimToken,
    p_outcome: outcome,
    p_error_code: errorCode,
    p_error_message: sendResult.ok ? null : `Send failed with code ${errorCode}`,
    p_provider_message_id: providerMessageId,
    p_retry_after_seconds:
      !sendResult.ok && sendResult.kind === 'rate_limited' ? sendResult.retryAfterSeconds || 30 : null,
  });

  if (finErr) {
    console.error('[Controlled Dispatch] finalize_briefing_delivery error:', finErr.message);
  }

  revalidatePath('/settings/notifications');

  if (!sendResult.ok) {
    return {
      error: `Delivery attempt finished with outcome '${outcome}' (${errorCode}).`,
      data: {
        deliveryId,
        status: outcome,
        outcome,
        errorCode: errorCode || undefined,
      },
    };
  }

  return {
    success: true,
    data: {
      deliveryId,
      status: 'sent',
      outcome: 'sent',
      providerMessageId: providerMessageId || undefined,
    },
  };
}
