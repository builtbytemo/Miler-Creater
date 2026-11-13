/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dispatchDueBriefings } from '../src/lib/briefing/dispatcher';
import { createFakeAdmin } from './helpers-briefing-fake-db';
import type { BriefingContentGenerator } from '../src/lib/briefing/types';

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.VERCEL_ENV = 'preview';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://prmgrrzqtnygmitplkhn.supabase.co';
  delete process.env.DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID;
  delete process.env.DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT;
});
afterEach(() => {
  process.env = { ...originalEnv };
});

function setup(opts: { channel?: 'email' | 'telegram'; prefs?: any; conn?: any; verified?: boolean } = {}) {
  const channel = opts.channel ?? 'telegram';
  const finalized: any[] = [];
  const delivery = { id: 'd1', user_id: 'u1', channel, local_date: '2026-01-15', claim_token: 'tok', attempt_count: 1 };
  let claimedOnce = false;
  const db: any = {
    tables: {
      daily_briefing_preferences: [{ user_id: 'u1', enabled: true, email_enabled: true, telegram_enabled: true, email_consent_at: 'x', ...opts.prefs }],
      telegram_connections: opts.conn === null ? [] : [{ user_id: 'u1', chat_id: 42, status: 'active', ...opts.conn }],
    },
    rpcs: {
      claim_briefing_deliveries: () => (claimedOnce ? [] : ((claimedOnce = true), [delivery])),
      finalize_briefing_delivery: (a: any) => (finalized.push(a), true),
    },
  };
  const admin = createFakeAdmin(db, { users: { u1: { email: 'a@b.c', email_confirmed_at: opts.verified === false ? null : 'now' } } });
  return { admin, finalized, db };
}
const ready: BriefingContentGenerator = { generate: async (r) => ({ status: 'ready', message: { channel: r.channel, subject: 's', text: 'T' } }) };
const notConfigured: BriefingContentGenerator = { generate: async () => ({ status: 'not_configured', reason: 'x' }) };
const adapters = (result: any = { ok: true, providerMessageId: 'm1' }) => ({
  telegram: { send: vi.fn(async () => result) },
  email: { send: vi.fn(async () => result) },
});

describe('Daily Briefing dispatcher', () => {
  it('sends nothing when no content generator is configured (skipped)', async () => {
    const { admin, finalized } = setup();
    const a = adapters();
    const s = await dispatchDueBriefings(admin, { generator: notConfigured, ...a });
    expect(s.skipped).toBe(1);
    expect(a.telegram.send).not.toHaveBeenCalled();
    expect(finalized[0]).toMatchObject({ p_outcome: 'skipped', p_error_code: 'content_not_configured' });
  });

  it('with no generator override the approved Daily Briefing generator is used (never a generic message)', async () => {
    const { admin } = setup();
    const a = adapters();
    const s = await dispatchDueBriefings(admin, a);
    expect(s.sent).toBe(1);
    const msg = (a.telegram.send.mock.calls[0] as any)[1];
    expect(msg.text).toContain('Nothing on your list for today');
  });

  it('sends via telegram when ready and records provider id', async () => {
    const { admin, finalized } = setup();
    const a = adapters();
    await dispatchDueBriefings(admin, { generator: ready, ...a });
    expect(a.telegram.send).toHaveBeenCalledWith({ chatId: 42 }, expect.anything());
    expect(finalized[0]).toMatchObject({ p_outcome: 'sent', p_provider_message_id: 'm1' });
  });

  it('sends email to verified address with idempotency key', async () => {
    const { admin } = setup({ channel: 'email' });
    const a = adapters();
    await dispatchDueBriefings(admin, { generator: ready, ...a });
    expect(a.email.send).toHaveBeenCalledWith({ to: 'a@b.c' }, expect.anything(), { idempotencyKey: 'briefing-d1' });
  });

  it('never sends to unverified email', async () => {
    const { admin, finalized } = setup({ channel: 'email', verified: false });
    const a = adapters();
    await dispatchDueBriefings(admin, { generator: ready, ...a });
    expect(a.email.send).not.toHaveBeenCalled();
    expect(finalized[0].p_error_code).toBe('no_verified_destination');
  });

  it('never sends without email consent or when channel disabled', async () => {
    const noConsent = setup({ channel: 'email', prefs: { email_consent_at: null } });
    const a1 = adapters();
    await dispatchDueBriefings(noConsent.admin, { generator: ready, ...a1 });
    expect(a1.email.send).not.toHaveBeenCalled();
    const off = setup({ prefs: { telegram_enabled: false } });
    const a2 = adapters();
    await dispatchDueBriefings(off.admin, { generator: ready, ...a2 });
    expect(a2.telegram.send).not.toHaveBeenCalled();
    expect(off.finalized[0].p_error_code).toBe('channel_disabled');
  });

  it('skips when master switch was turned off after enqueue, or no telegram connection / blocked', async () => {
    for (const o of [{ prefs: { enabled: false } }, { conn: null }, { conn: { status: 'blocked' } }]) {
      const { admin, finalized } = setup(o as any);
      const a = adapters();
      await dispatchDueBriefings(admin, { generator: ready, ...a });
      expect(a.telegram.send).not.toHaveBeenCalled();
      expect(finalized[0].p_outcome).toBe('skipped');
    }
  });

  it('retries transient and rate-limited failures, honoring retry-after', async () => {
    const t = setup();
    await dispatchDueBriefings(t.admin, { generator: ready, ...adapters({ ok: false, kind: 'transient', code: 'telegram_http_502' }) });
    expect(t.finalized[0]).toMatchObject({ p_outcome: 'retry', p_error_code: 'telegram_http_502' });
    const r = setup();
    await dispatchDueBriefings(r.admin, { generator: ready, ...adapters({ ok: false, kind: 'rate_limited', code: 'x', retryAfterSeconds: 77 }) });
    expect(r.finalized[0]).toMatchObject({ p_outcome: 'retry', p_retry_after_seconds: 77 });
  });

  it('fails permanently on blocked bot and marks the connection blocked', async () => {
    const { admin, finalized, db } = setup();
    await dispatchDueBriefings(admin, { generator: ready, ...adapters({ ok: false, kind: 'blocked', code: 'telegram_bot_blocked' }) });
    expect(finalized[0].p_outcome).toBe('failed');
    expect(db.tables.telegram_connections[0].status).toBe('blocked');
  });

  it('records ambiguous provider outcomes without retrying', async () => {
    const { admin, finalized } = setup();
    await dispatchDueBriefings(admin, { generator: ready, ...adapters({ ok: false, kind: 'ambiguous', code: 'telegram_timeout_or_network' }) });
    expect(finalized[0].p_outcome).toBe('ambiguous');
  });

  it('missing credentials leave the delivery retryable, not lost', async () => {
    const { admin, finalized } = setup();
    await dispatchDueBriefings(admin, { generator: ready, ...adapters({ ok: false, kind: 'not_configured', code: 'telegram_not_configured' }) });
    expect(finalized[0].p_outcome).toBe('retry');
  });

  it('does not put message content in finalize payloads', async () => {
    const { admin, finalized } = setup();
    await dispatchDueBriefings(admin, { generator: ready, ...adapters() });
    expect(JSON.stringify(finalized)).not.toContain('"T"');
  });
});
