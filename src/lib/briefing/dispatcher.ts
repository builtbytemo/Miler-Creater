import type { SupabaseClient } from '@supabase/supabase-js';
import { authorizeEmailDestination, authorizeEmailDispatch } from './config';
import { getRegisteredBriefingContentGenerator } from './content';
import { createDailyBriefingGenerator } from './daily/generator';
import { createEmailAdapter, type EmailDestination } from './channels/email';
import { createTelegramAdapter, type TelegramDestination } from './channels/telegram';
import type { BriefingContentGenerator, BriefingChannel, ChannelAdapter, DeliveryResult } from './types';

interface ClaimedDelivery {
  id: string;
  user_id: string;
  channel: BriefingChannel;
  local_date: string;
  claim_token: string;
  attempt_count: number;
}

export interface DispatchDeps {
  generator?: BriefingContentGenerator;
  telegram?: ChannelAdapter<TelegramDestination>;
  email?: ChannelAdapter<EmailDestination>;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
  ambiguous: number;
}

type Outcome = 'sent' | 'retry' | 'failed' | 'skipped' | 'ambiguous';
interface Decision {
  outcome: Outcome;
  code?: string;
  message?: string;
  providerMessageId?: string;
  retryAfter?: number;
}

/** Resolves a verified destination, or null. Never guesses a chat id or address. */
async function resolveDestination(
  admin: SupabaseClient,
  userId: string,
  channel: BriefingChannel
): Promise<TelegramDestination | EmailDestination | null> {
  if (channel === 'telegram') {
    const { data } = await admin
      .from('telegram_connections')
      .select('chat_id, status')
      .eq('user_id', userId)
      .maybeSingle();
    if (!data || data.status !== 'active') return null;
    return { chatId: data.chat_id };
  }
  const { data } = await admin.auth.admin.getUserById(userId);
  const user = data?.user;
  if (!user?.email || !user.email_confirmed_at) return null;
  return { to: user.email };
}

function fromResult(r: DeliveryResult): Decision {
  if (r.ok) return { outcome: 'sent', providerMessageId: r.providerMessageId };
  switch (r.kind) {
    case 'transient':
    case 'rate_limited':
      return { outcome: 'retry', code: r.code, retryAfter: r.retryAfterSeconds };
    case 'ambiguous':
      return { outcome: 'ambiguous', code: r.code };
    case 'not_configured':
      // Provider/credentials missing: retry later so an operator can fix configuration.
      return { outcome: 'retry', code: r.code };
    default:
      return { outcome: 'failed', code: r.code };
  }
}

async function decide(admin: SupabaseClient, d: ClaimedDelivery, deps: Required<DispatchDeps>): Promise<Decision> {
  const { data: prefs } = await admin
    .from('daily_briefing_preferences')
    .select('enabled, email_enabled, telegram_enabled, email_consent_at')
    .eq('user_id', d.user_id)
    .maybeSingle();
  if (!prefs || !prefs.enabled) return { outcome: 'skipped', code: 'briefing_disabled' };
  if (d.channel === 'email' && (!prefs.email_enabled || !prefs.email_consent_at)) {
    return { outcome: 'skipped', code: 'channel_disabled' };
  }
  if (d.channel === 'telegram' && !prefs.telegram_enabled) return { outcome: 'skipped', code: 'channel_disabled' };

  if (d.channel === 'email') {
    const userAuth = authorizeEmailDispatch(d.user_id);
    if (!userAuth.allowed) return { outcome: 'skipped', code: userAuth.code };
  }

  const destination = await resolveDestination(admin, d.user_id, d.channel);
  if (!destination) return { outcome: 'skipped', code: 'no_verified_destination' };

  if (d.channel === 'email') {
    const destAuth = authorizeEmailDestination((destination as EmailDestination).to, d.user_id);
    if (!destAuth.allowed) return { outcome: 'skipped', code: destAuth.code };
    (destination as EmailDestination).to = destAuth.normalizedTo;
  }

  const content = await deps.generator.generate({ userId: d.user_id, localDate: d.local_date, channel: d.channel });
  if (content.status !== 'ready') return { outcome: 'skipped', code: 'content_not_configured' };

  const result =
    d.channel === 'telegram'
      ? await deps.telegram.send(destination as TelegramDestination, content.message)
      : await deps.email.send(destination as EmailDestination, content.message, {
          idempotencyKey: `briefing-${d.id}`,
        });
  return fromResult(result);
}

/**
 * Delivery worker: claims due rows transactionally (FOR UPDATE SKIP LOCKED), generates content
 * via the generator contract, sends via channel adapters and records the outcome. Message
 * content is never logged or persisted.
 */
export async function dispatchDueBriefings(
  admin: SupabaseClient,
  deps: DispatchDeps = {},
  limit = 25
): Promise<DispatchSummary> {
  const resolved: Required<DispatchDeps> = {
    generator: deps.generator ?? getRegisteredBriefingContentGenerator() ?? createDailyBriefingGenerator(admin),
    telegram: deps.telegram ?? createTelegramAdapter(),
    email: deps.email ?? createEmailAdapter(),
  };
  const summary: DispatchSummary = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0, ambiguous: 0 };

  const { data: claimed, error } = await admin.rpc('claim_briefing_deliveries', { p_limit: limit, p_lease_seconds: 300 });
  if (error || !claimed) return summary;

  for (const d of claimed as ClaimedDelivery[]) {
    summary.claimed++;
    let decision: Decision;
    try {
      decision = await decide(admin, d, resolved);
    } catch {
      decision = { outcome: 'ambiguous', code: 'dispatcher_exception' };
    }
    await admin.rpc('finalize_briefing_delivery', {
      p_id: d.id,
      p_claim_token: d.claim_token,
      p_outcome: decision.outcome,
      p_error_code: decision.code ?? null,
      p_error_message: null,
      p_provider_message_id: decision.providerMessageId ?? null,
      p_retry_after_seconds: decision.retryAfter ?? null,
    });
    if (decision.outcome === 'sent') summary.sent++;
    else if (decision.outcome === 'retry') summary.retried++;
    else if (decision.outcome === 'failed') summary.failed++;
    else if (decision.outcome === 'skipped') summary.skipped++;
    else summary.ambiguous++;

    // Blocked destinations: record on the connection so the UI can show it.
    if (decision.outcome === 'failed' && d.channel === 'telegram' && (decision.code === 'telegram_bot_blocked' || decision.code === 'telegram_invalid_chat')) {
      await admin
        .from('telegram_connections')
        .update({ status: 'blocked', status_changed_at: new Date().toISOString() })
        .eq('user_id', d.user_id);
    }
  }
  return summary;
}
