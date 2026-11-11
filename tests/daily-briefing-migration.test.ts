import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20261111000003_daily_briefing_delivery.sql', 'utf8');

describe('Daily Briefing migration safeguards', () => {
  it('enables RLS on every new table', () => {
    for (const t of ['daily_briefing_preferences', 'telegram_connections', 'telegram_link_tokens', 'telegram_webhook_updates', 'briefing_deliveries', 'briefing_delivery_attempts']) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
    }
  });
  it('defaults everything to disabled in Africa/Cairo at 00:00', () => {
    expect(sql).toMatch(/enabled BOOLEAN NOT NULL DEFAULT false/);
    expect(sql).toMatch(/timezone TEXT NOT NULL DEFAULT 'Africa\/Cairo'/);
    expect(sql).toMatch(/delivery_local_time TIME NOT NULL DEFAULT '00:00'/);
  });
  it('prevents duplicate queue records', () => {
    expect(sql).toContain('UNIQUE (user_id, channel, local_date)');
  });
  it('claims transactionally with SKIP LOCKED', () => expect(sql).toContain('FOR UPDATE SKIP LOCKED'));
  it('restricts privileged functions to service_role', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.claim_briefing_deliveries\(INT, INT\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.consume_telegram_link_token\(TEXT, BIGINT, TEXT\) TO service_role/);
  });
  it('hides chat_id from clients and does not touch existing reminder tables', () => {
    expect(sql).toContain('GRANT SELECT (user_id, telegram_username, status, linked_at)');
    expect(sql).not.toMatch(/ALTER TABLE public\.(notification_preferences|notifications)\b/);
  });
  it('pins search_path on all functions', () => {
    const fns = sql.match(/CREATE OR REPLACE FUNCTION/g)!.length;
    expect(sql.match(/SET search_path = public, pg_catalog/g)!.length).toBe(fns);
  });
});
