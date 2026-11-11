import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateDue } from './timezone';
import type { BriefingChannel } from './types';

const PAGE_SIZE = 500;
const MAX_PAGES = 20;

export interface EnqueueSummary {
  evaluatedUsers: number;
  enqueued: number;
  notDue: number;
  errors: number;
}

/**
 * Scheduler: decides WHAT is due, nothing else. Idempotent: the unique constraint
 * (user_id, channel, local_date) plus ON CONFLICT DO NOTHING means concurrent or repeated
 * invocations never create duplicate queue rows. No content is generated or sent here.
 */
export async function enqueueDueBriefings(admin: SupabaseClient, now: Date = new Date()): Promise<EnqueueSummary> {
  const summary: EnqueueSummary = { evaluatedUsers: 0, enqueued: 0, notDue: 0, errors: 0 };
  let lastUserId: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    let q = admin
      .from('daily_briefing_preferences')
      .select('user_id, email_enabled, telegram_enabled, timezone, delivery_local_time')
      .eq('enabled', true)
      .order('user_id')
      .limit(PAGE_SIZE);
    if (lastUserId) q = q.gt('user_id', lastUserId);
    const { data, error } = await q;
    if (error) {
      summary.errors++;
      break;
    }
    if (!data || data.length === 0) break;

    const rows: Array<Record<string, unknown>> = [];
    for (const pref of data) {
      summary.evaluatedUsers++;
      let decision;
      try {
        decision = evaluateDue(now, pref.timezone, String(pref.delivery_local_time).slice(0, 5));
      } catch {
        summary.errors++;
        continue;
      }
      if (!decision.due) {
        summary.notDue++;
        continue;
      }
      const channels: BriefingChannel[] = [];
      if (pref.email_enabled) channels.push('email');
      if (pref.telegram_enabled) channels.push('telegram');
      for (const channel of channels) {
        rows.push({
          user_id: pref.user_id,
          channel,
          local_date: decision.localDate,
          timezone: pref.timezone,
          scheduled_for: decision.scheduledFor.toISOString(),
          next_attempt_at: now.toISOString(),
        });
      }
    }

    if (rows.length > 0) {
      const { data: inserted, error: insErr } = await admin
        .from('briefing_deliveries')
        .upsert(rows, { onConflict: 'user_id,channel,local_date', ignoreDuplicates: true })
        .select('id');
      if (insErr) summary.errors++;
      else summary.enqueued += inserted?.length ?? 0;
    }

    lastUserId = data[data.length - 1].user_id;
    if (data.length < PAGE_SIZE) break;
  }
  return summary;
}
