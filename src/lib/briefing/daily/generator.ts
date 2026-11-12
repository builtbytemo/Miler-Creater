import type { SupabaseClient } from '@supabase/supabase-js';
import type { BriefingContentGenerator, BriefingContentRequest, BriefingContentResult } from '../types';
import { DEFAULT_BRIEFING_TIMEZONE, isValidTimeZone } from '../timezone';
import { loadBriefingSources } from './source';
import { buildBriefingSnapshot } from './build';
import { renderEmail } from './render-email';
import { renderTelegram } from './render-telegram';
import type { BriefingSnapshot } from './model';

/** Resolves the user's configured IANA timezone (falls back to the product default). */
async function resolveTimezone(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.from('daily_briefing_preferences').select('timezone').eq('user_id', userId).maybeSingle();
  const tz = (data as { timezone?: string } | null)?.timezone;
  return tz && isValidTimeZone(tz) ? tz : DEFAULT_BRIEFING_TIMEZONE;
}

export async function buildSnapshotForUser(admin: SupabaseClient, userId: string, localDate: string): Promise<BriefingSnapshot> {
  const timezone = await resolveTimezone(admin, userId);
  const sources = await loadBriefingSources(admin, userId, timezone, localDate);
  return buildBriefingSnapshot(sources, localDate);
}

/**
 * The approved Daily Briefing generator. Stages: retrieve+authorize -> filter -> dedupe/sort ->
 * snapshot -> channel render. Both channels render the same snapshot (email adds Day Finder).
 * It only READS data; sending, consent, opt-in, retries and idempotency stay in the dispatcher.
 */
export function createDailyBriefingGenerator(admin: SupabaseClient): BriefingContentGenerator {
  return {
    async generate(request: BriefingContentRequest): Promise<BriefingContentResult> {
      const snapshot = await buildSnapshotForUser(admin, request.userId, request.localDate);
      if (request.channel === 'email') {
        const { subject, text, html } = renderEmail(snapshot);
        return { status: 'ready', message: { channel: 'email', subject, text, html } };
      }
      const { parts, text } = renderTelegram(snapshot);
      return { status: 'ready', message: { channel: 'telegram', text, parts, parseMode: 'HTML' } };
    },
  };
}
