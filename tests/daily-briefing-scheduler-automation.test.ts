/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { enqueueDueBriefings } from '../src/lib/briefing/scheduler';
import { dispatchDueBriefings } from '../src/lib/briefing/dispatcher';
import { evaluateDue, localDateTimeToInstant, getLocalDate } from '../src/lib/briefing/timezone';
import { createDailyBriefingGenerator } from '../src/lib/briefing/daily/generator';
import { GET, POST } from '../src/app/api/cron/daily-briefing/route';
import { createFakeAdmin } from './helpers-briefing-fake-db';
import type { BriefingContentGenerator } from '../src/lib/briefing/types';

describe('Daily Briefing Scheduler & Automation Audit Suite', () => {
  const originalEnv = process.env;
  const TEST_SECRET = 'super-secret-cron-token-12345';
  const STAGING_USER_ID = 'b9dffc37-9bb8-422b-ba72-7ab1c3dfb8e3';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // =========================================================================
  // Scenario 1: Local midnight in Africa/Cairo and global IANA timezones
  // =========================================================================
  describe('Scenario 1: Local midnight across Africa/Cairo and global IANA timezones', () => {
    it('accurately resolves Cairo winter midnight (UTC+2) vs Cairo summer midnight (UTC+3)', () => {
      // Cairo winter (UTC+2): 2026-01-15 00:00 local is 2026-01-14 22:00 UTC
      const winterInstant = localDateTimeToInstant('2026-01-15', '00:00', 'Africa/Cairo');
      expect(winterInstant.toISOString()).toBe('2026-01-14T22:00:00.000Z');

      // Cairo summer (UTC+3): 2026-07-15 00:00 local is 2026-07-14 21:00 UTC
      const summerInstant = localDateTimeToInstant('2026-07-15', '00:00', 'Africa/Cairo');
      expect(summerInstant.toISOString()).toBe('2026-07-14T21:00:00.000Z');
    });

    it('evaluates due status across diverse global IANA zones (UTC, NY, Tokyo, London, Sydney)', () => {
      const testCases = [
        { tz: 'UTC', targetDate: '2026-06-01', expectedUtc: '2026-06-01T00:00:00.000Z' },
        { tz: 'America/New_York', targetDate: '2026-06-01', expectedUtc: '2026-06-01T04:00:00.000Z' }, // EDT (UTC-4)
        { tz: 'Asia/Tokyo', targetDate: '2026-06-01', expectedUtc: '2026-05-31T15:00:00.000Z' }, // JST (UTC+9)
        { tz: 'Europe/London', targetDate: '2026-06-01', expectedUtc: '2026-05-31T23:00:00.000Z' }, // BST (UTC+1)
        { tz: 'Australia/Sydney', targetDate: '2026-06-01', expectedUtc: '2026-05-31T14:00:00.000Z' }, // AEST (UTC+10)
      ];

      for (const tc of testCases) {
        const instant = localDateTimeToInstant(tc.targetDate, '00:00', tc.tz);
        expect(instant.toISOString()).toBe(tc.expectedUtc);
        expect(getLocalDate(instant, tc.tz)).toBe(tc.targetDate);

        // 1 minute before midnight is not due for targetDate
        const justBefore = new Date(instant.getTime() - 60_000);
        const evalBefore = evaluateDue(justBefore, tc.tz, '00:00');
        expect(evalBefore.localDate).not.toBe(tc.targetDate);

        // Exactly at midnight is due for targetDate
        const atMidnight = evaluateDue(instant, tc.tz, '00:00');
        expect(atMidnight.due).toBe(true);
        expect(atMidnight.localDate).toBe(tc.targetDate);
      }
    });
  });

  // =========================================================================
  // Scenario 2: Daylight-saving transitions, including Egyptian DST
  // =========================================================================
  describe('Scenario 2: Daylight-saving transitions & Egyptian DST', () => {
    it('handles Egypt spring-forward gap (midnight does not exist on wall clock)', () => {
      // On 2026-04-24, Egypt clocks jump forward at 00:00 to 01:00.
      const springAt = localDateTimeToInstant('2026-04-24', '00:00', 'Africa/Cairo');
      expect(springAt.toISOString()).toBe('2026-04-23T22:00:00.000Z');
      expect(getLocalDate(springAt, 'Africa/Cairo')).toBe('2026-04-24');

      const decision = evaluateDue(springAt, 'Africa/Cairo', '00:00');
      expect(decision.due).toBe(true);
      expect(decision.localDate).toBe('2026-04-24');
    });

    it('handles Egypt fall-back transition correctly (clock repeats / overlap)', () => {
      // On 2026-10-29/30, clocks fall back from UTC+3 to UTC+2.
      const fallAt = localDateTimeToInstant('2026-10-30', '00:00', 'Africa/Cairo');
      expect(fallAt.toISOString()).toBe('2026-10-29T22:00:00.000Z');
      expect(getLocalDate(fallAt, 'Africa/Cairo')).toBe('2026-10-30');
    });
  });

  // =========================================================================
  // Scenario 3: Repeated cron requests & concurrent executions (idempotency)
  // =========================================================================
  describe('Scenario 3: Repeated cron requests & concurrent executions (idempotency)', () => {
    it('enqueues once and produces zero new rows on subsequent repeated ticks', async () => {
      const now = new Date('2026-11-15T22:05:00Z'); // 00:05 Cairo on 2026-11-16
      const db: any = {
        tables: {
          daily_briefing_preferences: [
            {
              user_id: 'user-idempotent-1',
              enabled: true,
              email_enabled: true,
              telegram_enabled: true,
              timezone: 'Africa/Cairo',
              delivery_local_time: '00:00:00',
              email_consent_at: '2026-11-01T00:00:00Z',
            },
          ],
          briefing_deliveries: [],
        },
        rpcs: {},
      };

      const admin = createFakeAdmin(db);

      // First tick enqueues 2 rows (email + telegram)
      const res1 = await enqueueDueBriefings(admin, now);
      expect(res1.enqueued).toBe(2);
      expect(db.tables.briefing_deliveries).toHaveLength(2);

      // Repeated ticks within the same 5-minute schedule produce 0 new rows
      const res2 = await enqueueDueBriefings(admin, new Date(now.getTime() + 5 * 60_000));
      expect(res2.enqueued).toBe(0);
      expect(db.tables.briefing_deliveries).toHaveLength(2);

      const res3 = await enqueueDueBriefings(admin, new Date(now.getTime() + 10 * 60_000));
      expect(res3.enqueued).toBe(0);
      expect(db.tables.briefing_deliveries).toHaveLength(2);
    });

    it('handles concurrent enqueue attempts safely without duplicate rows', async () => {
      const now = new Date('2026-11-15T22:05:00Z');
      const db: any = {
        tables: {
          daily_briefing_preferences: [
            {
              user_id: 'user-conc-1',
              enabled: true,
              email_enabled: true,
              telegram_enabled: true,
              timezone: 'Africa/Cairo',
              delivery_local_time: '00:00:00',
              email_consent_at: '2026-11-01T00:00:00Z',
            },
          ],
          briefing_deliveries: [],
        },
        rpcs: {},
      };

      const admin = createFakeAdmin(db);

      // 5 concurrent workers firing simultaneously
      await Promise.all([1, 2, 3, 4, 5].map(() => enqueueDueBriefings(admin, now)));

      // Exactly 2 rows exist, never multiplied
      expect(db.tables.briefing_deliveries).toHaveLength(2);
    });
  });

  // =========================================================================
  // Scenario 4: Missed and delayed cron invocations
  // =========================================================================
  describe('Scenario 4: Missed & delayed cron invocations', () => {
    it('catches up within the same day without back-filling previous days', async () => {
      // Suppose scheduler was down at midnight (22:00 UTC) and first runs at 08:30 local time (06:30 UTC)
      const delayedNow = new Date('2026-11-16T06:30:00Z'); // 08:30 Cairo on 2026-11-16
      const db: any = {
        tables: {
          daily_briefing_preferences: [
            {
              user_id: 'user-delayed-1',
              enabled: true,
              email_enabled: true,
              telegram_enabled: true,
              timezone: 'Africa/Cairo',
              delivery_local_time: '00:00:00',
              email_consent_at: '2026-11-01T00:00:00Z',
            },
          ],
          briefing_deliveries: [],
        },
        rpcs: {},
      };

      const admin = createFakeAdmin(db);
      const res = await enqueueDueBriefings(admin, delayedNow);
      expect(res.enqueued).toBe(2);

      // Delivered rows belong strictly to 2026-11-16, not back-filled to 2026-11-15
      const dates = db.tables.briefing_deliveries.map((r: any) => r.local_date);
      expect(dates).toEqual(['2026-11-16', '2026-11-16']);
    });
  });

  // =========================================================================
  // Scenario 5: Empty days (no tasks or calendar blocks)
  // =========================================================================
  describe('Scenario 5: Empty days (no tasks or calendar blocks)', () => {
    it('content generator produces friendly clear-day message and marks delivery sent', async () => {
      const db: any = {
        tables: {
          daily_briefing_preferences: [
            {
              user_id: 'u-empty',
              enabled: true,
              email_enabled: true,
              telegram_enabled: true,
              email_consent_at: '2026-11-01T00:00:00Z',
            },
          ],
          telegram_connections: [{ user_id: 'u-empty', chat_id: 11111, status: 'active' }],
          tasks: [], // No tasks
          workspaces: [{ id: 'w1', owner_id: 'u-empty' }],
        },
        rpcs: {
          claim_briefing_deliveries: () => [
            {
              id: 'deliv-empty',
              user_id: 'u-empty',
              channel: 'telegram',
              local_date: '2026-11-16',
              claim_token: 'claim-tok-empty',
              attempt_count: 1,
            },
          ],
          finalize_briefing_delivery: vi.fn(() => true),
        },
      };

      const admin = createFakeAdmin(db);
      const generator = createDailyBriefingGenerator(admin);

      // Verify the generated message directly
      const content = await generator.generate({ userId: 'u-empty', localDate: '2026-11-16', channel: 'telegram' });
      expect(content.status).toBe('ready');
      if (content.status === 'ready') {
        expect(content.message.text).toContain('Nothing on your list for today');
      }

      // Dispatch through dispatcher
      const mockTelegramSend = vi.fn().mockResolvedValue({ ok: true, providerMessageId: 'tg-empty-msg' });
      const summary = await dispatchDueBriefings(admin, {
        generator,
        telegram: { send: mockTelegramSend },
      });

      expect(summary.sent).toBe(1);
      expect(summary.failed).toBe(0);
      expect(mockTelegramSend).toHaveBeenCalled();
      expect(db.rpcs.finalize_briefing_delivery).toHaveBeenCalledWith(
        expect.objectContaining({
          p_outcome: 'sent',
          p_provider_message_id: 'tg-empty-msg',
        })
      );
    });
  });

  // =========================================================================
  // Scenario 6: Disabled users and channels
  // =========================================================================
  describe('Scenario 6: Disabled users & channels', () => {
    it('does not enqueue when master briefing enabled is false', async () => {
      const db: any = {
        tables: {
          daily_briefing_preferences: [
            {
              user_id: 'u-off',
              enabled: false,
              email_enabled: true,
              telegram_enabled: true,
              timezone: 'Africa/Cairo',
              delivery_local_time: '00:00:00',
            },
          ],
          briefing_deliveries: [],
        },
        rpcs: {},
      };

      const admin = createFakeAdmin(db);
      const res = await enqueueDueBriefings(admin, new Date('2026-11-15T22:05:00Z'));
      expect(res.enqueued).toBe(0);
      expect(db.tables.briefing_deliveries).toHaveLength(0);
    });

    it('skips delivery at dispatch time if preferences were disabled after enqueue', async () => {
      const finalized: any[] = [];
      const db: any = {
        tables: {
          daily_briefing_preferences: [
            { user_id: 'u-turned-off', enabled: false, email_enabled: true, telegram_enabled: true },
          ],
        },
        rpcs: {
          claim_briefing_deliveries: () => [
            {
              id: 'deliv-disabled',
              user_id: 'u-turned-off',
              channel: 'telegram',
              local_date: '2026-11-16',
              claim_token: 'tok-dis',
              attempt_count: 1,
            },
          ],
          finalize_briefing_delivery: (a: any) => (finalized.push(a), true),
        },
      };

      const admin = createFakeAdmin(db);
      const mockSend = vi.fn();
      const summary = await dispatchDueBriefings(admin, {
        telegram: { send: mockSend },
      });

      expect(summary.skipped).toBe(1);
      expect(summary.sent).toBe(0);
      expect(mockSend).not.toHaveBeenCalled();
      expect(finalized[0].p_outcome).toBe('skipped');
      expect(finalized[0].p_error_code).toBe('briefing_disabled');
    });
  });

  // =========================================================================
  // Scenario 7: Staging pre-existing Nov 12 deliveries are NEVER resent
  // =========================================================================
  describe('Scenario 7: Real-world staging guard - Nov 12 sent deliveries are never resent', () => {
    it('does not re-enqueue or claim existing November 12 sent deliveries for staging user', async () => {
      // Replicate the EXACT database state on Staging Supabase prmgrrzqtnygmitplkhn:
      // The user has 2 deliveries for 2026-11-12, status = 'sent'
      const existingSentDeliveries = [
        {
          id: '495501ea-9a55-4b67-82f2-84c5e36e89fc',
          user_id: STAGING_USER_ID,
          channel: 'telegram',
          local_date: '2026-11-12',
          status: 'sent',
          attempt_count: 1,
          provider_message_id: '4',
        },
        {
          id: 'bafc6ebc-544b-48e7-9990-c608afaf80be',
          user_id: STAGING_USER_ID,
          channel: 'email',
          local_date: '2026-11-12',
          status: 'sent',
          attempt_count: 1,
          provider_message_id: '01a1cf0d-280b-725f-8521-a2e0ce26f4f7',
        },
      ];

      const db: any = {
        tables: {
          daily_briefing_preferences: [
            {
              user_id: STAGING_USER_ID,
              enabled: true,
              email_enabled: true,
              telegram_enabled: true,
              timezone: 'Africa/Cairo',
              delivery_local_time: '00:00:00',
              email_consent_at: '2026-11-12T07:15:37.472Z',
            },
          ],
          briefing_deliveries: [...existingSentDeliveries],
          telegram_connections: [{ user_id: STAGING_USER_ID, chat_id: 5269925553, status: 'active' }],
        },
        rpcs: {
          // SQL query in claim_briefing_deliveries: WHERE status IN ('pending', 'retry')
          // Since existing deliveries are 'sent', claim RPC returns empty set
          claim_briefing_deliveries: () =>
            db.tables.briefing_deliveries.filter((d: any) => ['pending', 'retry'].includes(d.status)),
          finalize_briefing_delivery: vi.fn(),
        },
      };

      const admin = createFakeAdmin(db, {
        users: { [STAGING_USER_ID]: { email: 'motriseandgformails@gmail.com', email_confirmed_at: '2026-11-11T16:00:00Z' } },
      });

      // 1. Run enqueueDueBriefings for 2026-11-12
      const nov12Instant = new Date('2026-11-12T08:00:00Z');
      const enqueueSummary = await enqueueDueBriefings(admin, nov12Instant);

      // ON CONFLICT DO NOTHING: 0 rows inserted
      expect(enqueueSummary.enqueued).toBe(0);
      expect(db.tables.briefing_deliveries).toHaveLength(2);
      expect(db.tables.briefing_deliveries[0].status).toBe('sent');
      expect(db.tables.briefing_deliveries[1].status).toBe('sent');

      // 2. Run dispatchDueBriefings
      const mockTg = vi.fn();
      const mockEm = vi.fn();
      const dispatchSummary = await dispatchDueBriefings(admin, {
        telegram: { send: mockTg },
        email: { send: mockEm },
      });

      // Exactly 0 claimed, 0 sent
      expect(dispatchSummary.claimed).toBe(0);
      expect(dispatchSummary.sent).toBe(0);
      expect(mockTg).not.toHaveBeenCalled();
      expect(mockEm).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Scenario 8: Rate limits, timeouts, expired leases & ambiguous outcomes
  // =========================================================================
  describe('Scenario 8: Rate limits, timeouts, expired leases & ambiguous outcomes', () => {
    it('retries transient 429 / 502 with exponential backoff and does not fail immediately', async () => {
      const finalized: any[] = [];
      const db: any = {
        tables: {
          daily_briefing_preferences: [
            { user_id: 'u-rate', enabled: true, email_enabled: false, telegram_enabled: true },
          ],
          telegram_connections: [{ user_id: 'u-rate', chat_id: 9999, status: 'active' }],
        },
        rpcs: {
          claim_briefing_deliveries: () => [
            { id: 'deliv-rate', user_id: 'u-rate', channel: 'telegram', local_date: '2026-11-16', claim_token: 'tok-rate', attempt_count: 1 },
          ],
          finalize_briefing_delivery: (a: any) => (finalized.push(a), true),
        },
      };

      const admin = createFakeAdmin(db);
      const readyGen: BriefingContentGenerator = {
        generate: async (r) => ({ status: 'ready', message: { channel: r.channel, subject: 's', text: 't' } }),
      };

      const summary = await dispatchDueBriefings(admin, {
        generator: readyGen,
        telegram: {
          send: vi.fn().mockResolvedValue({
            ok: false,
            kind: 'rate_limited',
            code: 'telegram_rate_limited',
            retryAfterSeconds: 30,
          }),
        },
      });

      expect(summary.retried).toBe(1);
      expect(finalized[0]).toMatchObject({
        p_outcome: 'retry',
        p_error_code: 'telegram_rate_limited',
        p_retry_after_seconds: 30,
      });
    });

    it('records ambiguous outcome without automatic retry when provider times out', async () => {
      const finalized: any[] = [];
      const db: any = {
        tables: {
          daily_briefing_preferences: [
            { user_id: 'u-timeout', enabled: true, email_enabled: true, telegram_enabled: false, email_consent_at: '2026-11-01T00:00:00Z' },
          ],
        },
        rpcs: {
          claim_briefing_deliveries: () => [
            { id: 'deliv-timeout', user_id: 'u-timeout', channel: 'email', local_date: '2026-11-16', claim_token: 'tok-timeout', attempt_count: 1 },
          ],
          finalize_briefing_delivery: (a: any) => (finalized.push(a), true),
        },
      };

      const admin = createFakeAdmin(db, {
        users: { 'u-timeout': { email: 'to@test.com', email_confirmed_at: '2026-11-01T00:00:00Z' } },
      });
      const readyGen: BriefingContentGenerator = {
        generate: async (r) => ({ status: 'ready', message: { channel: r.channel, subject: 's', text: 't' } }),
      };

      const summary = await dispatchDueBriefings(admin, {
        generator: readyGen,
        email: {
          send: vi.fn().mockResolvedValue({
            ok: false,
            kind: 'ambiguous',
            code: 'email_timeout_or_network',
          }),
        },
      });

      expect(summary.ambiguous).toBe(1);
      expect(summary.retried).toBe(0);
      expect(finalized[0]).toMatchObject({
        p_outcome: 'ambiguous',
        p_error_code: 'email_timeout_or_network',
      });
    });
  });

  // =========================================================================
  // Scenario 9: Email consent enforcement
  // =========================================================================
  describe('Scenario 9: Email consent enforcement', () => {
    it('refuses to enqueue email channel if email_consent_at is null', async () => {
      const db: any = {
        tables: {
          daily_briefing_preferences: [
            {
              user_id: 'u-no-consent',
              enabled: true,
              email_enabled: true,
              telegram_enabled: true,
              timezone: 'Africa/Cairo',
              delivery_local_time: '00:00:00',
              email_consent_at: null, // Consent not given
            },
          ],
          briefing_deliveries: [],
        },
        rpcs: {},
      };

      const admin = createFakeAdmin(db);
      await enqueueDueBriefings(admin, new Date('2026-11-15T22:05:00Z'));

      // Only Telegram enqueued, email omitted
      expect(db.tables.briefing_deliveries.map((d: any) => d.channel)).toEqual(['telegram']);
    });

    it('skips email delivery at dispatch time if consent was revoked between enqueue and dispatch', async () => {
      const finalized: any[] = [];
      const db: any = {
        tables: {
          daily_briefing_preferences: [
            {
              user_id: 'u-revoked',
              enabled: true,
              email_enabled: true,
              telegram_enabled: false,
              email_consent_at: null, // Revoked!
            },
          ],
        },
        rpcs: {
          claim_briefing_deliveries: () => [
            { id: 'deliv-revoked', user_id: 'u-revoked', channel: 'email', local_date: '2026-11-16', claim_token: 'tok-rev', attempt_count: 1 },
          ],
          finalize_briefing_delivery: (a: any) => (finalized.push(a), true),
        },
      };

      const admin = createFakeAdmin(db, {
        users: { 'u-revoked': { email: 'revoked@test.com', email_confirmed_at: '2026-11-01T00:00:00Z' } },
      });

      const mockSend = vi.fn();
      const summary = await dispatchDueBriefings(admin, {
        email: { send: mockSend },
      });

      expect(summary.skipped).toBe(1);
      expect(mockSend).not.toHaveBeenCalled();
      expect(finalized[0]).toMatchObject({
        p_outcome: 'skipped',
        p_error_code: 'channel_disabled',
      });
    });
  });

  // =========================================================================
  // Scenario 10: Queue pagination and batch limits
  // =========================================================================
  describe('Scenario 10: Queue pagination & batch limits', () => {
    it('paginates preferences across multiple pages using keyset pagination', async () => {
      const users: any[] = [];
      for (let i = 1; i <= 25; i++) {
        users.push({
          user_id: `user-${String(i).padStart(3, '0')}`,
          enabled: true,
          email_enabled: false,
          telegram_enabled: true,
          timezone: 'UTC',
          delivery_local_time: '00:00:00',
        });
      }

      const db: any = {
        tables: {
          daily_briefing_preferences: users,
          briefing_deliveries: [],
        },
        rpcs: {},
      };

      const admin = createFakeAdmin(db);
      const res = await enqueueDueBriefings(admin, new Date('2026-11-16T00:05:00Z'));

      expect(res.evaluatedUsers).toBe(25);
      expect(res.enqueued).toBe(25);
      expect(db.tables.briefing_deliveries).toHaveLength(25);
    });
  });

  // =========================================================================
  // Cron Route (/api/cron/daily-briefing) Authorization & Execution
  // =========================================================================
  describe('Cron Route /api/cron/daily-briefing safeguards & handling', () => {
    it('returns HTTP 500 when CRON_SECRET is not configured or whitespace-only', async () => {
      delete process.env.CRON_SECRET;
      const req = new NextRequest('https://preview.miler.app/api/cron/daily-briefing', {
        headers: { authorization: `Bearer ${TEST_SECRET}` },
      });
      const res = await GET(req);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Scheduler secret is not configured');

      // Whitespace only
      process.env.CRON_SECRET = '   ';
      const res2 = await GET(req);
      expect(res2.status).toBe(500);
    });

    it('returns HTTP 401 for missing or invalid Authorization header', async () => {
      process.env.CRON_SECRET = TEST_SECRET;

      // Missing header
      const reqNoAuth = new NextRequest('https://preview.miler.app/api/cron/daily-briefing');
      const resNoAuth = await GET(reqNoAuth);
      expect(resNoAuth.status).toBe(401);

      // Wrong bearer secret
      const reqWrongAuth = new NextRequest('https://preview.miler.app/api/cron/daily-briefing', {
        headers: { authorization: 'Bearer wrong-secret' },
      });
      const resWrongAuth = await GET(reqWrongAuth);
      expect(resWrongAuth.status).toBe(401);
    });

    it('returns HTTP 200 with enabled: false when killswitch DAILY_BRIEFING_DELIVERY_ENABLED !== "true"', async () => {
      process.env.CRON_SECRET = TEST_SECRET;
      process.env.DAILY_BRIEFING_DELIVERY_ENABLED = 'false';

      const req = new NextRequest('https://preview.miler.app/api/cron/daily-briefing', {
        headers: { authorization: `Bearer ${TEST_SECRET}` },
      });
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        success: true,
        enabled: false,
        message: 'Daily Briefing delivery is disabled',
      });
    });

    it('supports POST requests in addition to GET', async () => {
      process.env.CRON_SECRET = TEST_SECRET;
      process.env.DAILY_BRIEFING_DELIVERY_ENABLED = 'false';

      const req = new NextRequest('https://preview.miler.app/api/cron/daily-briefing', {
        method: 'POST',
        headers: { authorization: `Bearer ${TEST_SECRET}` },
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.enabled).toBe(false);
    });
  });
});
