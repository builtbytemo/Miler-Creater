/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import {
  getDeliveryServiceStatus,
  getEmailDeliveryPolicy,
  normalizeEmailAddress,
  parseValidEmailFrom,
} from '../src/lib/briefing/config';
import { createEmailAdapter } from '../src/lib/briefing/channels/email';
import { enqueueDueBriefings } from '../src/lib/briefing/scheduler';
import { dispatchDueBriefings } from '../src/lib/briefing/dispatcher';
import { createFakeAdmin } from './helpers-briefing-fake-db';

const AUTH_USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const AUTH_EMAIL = 'owner@example.com';
const OTHER_EMAIL = 'other@example.com';

const mockGetUser = vi.fn();
const mockRevalidatePath = vi.fn();
let mockUserPrefsDb: any;
let mockTelegramDb: any;
let mockFakeAdmin: any;

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => mockRevalidatePath(path),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: () => mockGetUser(),
    },
    from: vi.fn((table: string) => {
      if (table === 'daily_briefing_preferences') return mockUserPrefsDb;
      if (table === 'telegram_connections') return mockTelegramDb;
      throw new Error(`Unexpected server client table: ${table}`);
    }),
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockFakeAdmin),
}));

import {
  getDailyBriefingStateAction,
  sendTestBriefingMessageAction,
  updateDailyBriefingPreferencesAction,
} from '../src/lib/actions/daily-briefing-actions';
import { POST as cronPost } from '../src/app/api/cron/daily-briefing/route';

function setProductionSingleUserEnv(overrides: Record<string, string | undefined> = {}) {
  process.env.VERCEL_ENV = 'production';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://zcpdpizrbaaekteurwup.supabase.co';
  process.env.RESEND_API_KEY = 're_test_prod_key';
  process.env.EMAIL_FROM = 'Zahi <onboarding@resend.dev>';
  process.env.DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID = AUTH_USER_ID;
  process.env.DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT = AUTH_EMAIL;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('Single-user email delivery mode', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID;
    delete process.env.DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT;
    delete process.env.DAILY_BRIEFING_DELIVERY_ENABLED;
    delete process.env.CRON_SECRET;
    global.fetch = originalFetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  describe('configuration parsing & fail-closed defaults', () => {
    it('is disabled by default when no restriction vars are set outside Vercel preview', () => {
      process.env.RESEND_API_KEY = 're_key';
      process.env.EMAIL_FROM = 'onboarding@resend.dev';

      const policy = getEmailDeliveryPolicy();
      expect(policy.mode).toBe('single_user');
      expect(policy.configured).toBe(false);
      expect(getDeliveryServiceStatus().emailConfigured).toBe(false);
    });

    it('fails closed in production if any required configuration variable is missing or malformed', () => {
      setProductionSingleUserEnv({ DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID: undefined });
      expect(getDeliveryServiceStatus().emailConfigured).toBe(false);

      setProductionSingleUserEnv({ DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT: undefined });
      expect(getDeliveryServiceStatus().emailConfigured).toBe(false);

      setProductionSingleUserEnv({ RESEND_API_KEY: '   ' });
      expect(getDeliveryServiceStatus().emailConfigured).toBe(false);

      setProductionSingleUserEnv({ EMAIL_FROM: 'invalid-from' });
      expect(getDeliveryServiceStatus().emailConfigured).toBe(false);

      setProductionSingleUserEnv({ DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID: 'not-a-uuid' });
      expect(getDeliveryServiceStatus().emailConfigured).toBe(false);

      setProductionSingleUserEnv({ DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT: 'a@b.com,c@d.com' });
      expect(getDeliveryServiceStatus().emailConfigured).toBe(false);
    });

    it('preserves staging multi-user mode when VERCEL_ENV=preview targets staging without restriction vars', () => {
      process.env.VERCEL_ENV = 'preview';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://prmgrrzqtnygmitplkhn.supabase.co';
      process.env.RESEND_API_KEY = 're_staging';
      process.env.EMAIL_FROM = 'onboarding@resend.dev';

      const policy = getEmailDeliveryPolicy();
      expect(policy.mode).toBe('staging');
      expect(policy.configured).toBe(true);
    });

    it('never allows staging bypass if preview accidentally points to production Supabase or sets partial allowlist', () => {
      process.env.VERCEL_ENV = 'preview';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://zcpdpizrbaaekteurwup.supabase.co';
      process.env.RESEND_API_KEY = 're_staging';
      process.env.EMAIL_FROM = 'onboarding@resend.dev';
      expect(getEmailDeliveryPolicy().mode).toBe('single_user');
      expect(getEmailDeliveryPolicy().configured).toBe(false);

      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://prmgrrzqtnygmitplkhn.supabase.co';
      process.env.DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID = AUTH_USER_ID;
      expect(getEmailDeliveryPolicy().mode).toBe('single_user');
      expect(getEmailDeliveryPolicy().configured).toBe(false);
    });

    it('accepts onboarding@resend.dev and display-name sender formats without header injection', () => {
      expect(parseValidEmailFrom('onboarding@resend.dev')).toBe('onboarding@resend.dev');
      expect(parseValidEmailFrom('Zahi <onboarding@resend.dev>')).toBe('Zahi <onboarding@resend.dev>');
      expect(parseValidEmailFrom('Zahi\r\nBcc: x@y.com <onboarding@resend.dev>')).toBeNull();
      expect(normalizeEmailAddress(' Owner@Example.COM ')).toBe('owner@example.com');
    });

    it('does not hardcode personal email addresses in briefing source files', () => {
      const files = [
        'src/lib/briefing/config.ts',
        'src/lib/briefing/channels/email.ts',
        'src/lib/briefing/scheduler.ts',
        'src/lib/briefing/dispatcher.ts',
        'src/lib/actions/daily-briefing-actions.ts',
        'src/components/settings/DailyBriefingSettings.tsx',
      ];
      for (const f of files) {
        const src = readFileSync(f, 'utf8');
        expect(src).not.toMatch(/@gmail\.com/i);
        expect(src).not.toContain(AUTH_USER_ID);
      }
    });
  });

  describe('server actions & UI visibility/access controls', () => {
    function setupActionTables(prefRow: any = null) {
      const updateCalls: any[] = [];
      const insertCalls: any[] = [];
      mockUserPrefsDb = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: prefRow, error: null }),
        update: vi.fn((patch: any) => {
          updateCalls.push(patch);
          return {
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockResolvedValue({ data: [{ user_id: prefRow?.user_id ?? AUTH_USER_ID }], error: null }),
          };
        }),
        insert: vi.fn((row: any) => {
          insertCalls.push(row);
          return Promise.resolve({ data: null, error: null });
        }),
      };
      mockTelegramDb = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { status: 'active', telegram_username: 'zahi_user' }, error: null }),
      };
      return { updateCalls, insertCalls };
    }

    it('exposes email toggle and allows enabling + test sends only for the authorized account', async () => {
      setProductionSingleUserEnv({
        EMAIL_FROM: 'onboarding@resend.dev',
        DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID: AUTH_USER_ID.toUpperCase(),
        DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT: 'Owner@Example.COM',
      });
      setupActionTables({
        user_id: AUTH_USER_ID,
        enabled: true,
        email_enabled: true,
        telegram_enabled: true,
        timezone: 'Africa/Cairo',
        delivery_local_time: '00:00:00',
      });

      mockGetUser.mockResolvedValue({
        data: { user: { id: AUTH_USER_ID, email: AUTH_EMAIL, email_confirmed_at: '2026-11-10T00:00:00Z' } },
      });

      const state = await getDailyBriefingStateAction();
      expect(state.data?.service.emailConfigured).toBe(true);
      expect(state.data?.emailEnabled).toBe(true);
      expect(JSON.stringify(state)).not.toContain(AUTH_EMAIL);
      expect(JSON.stringify(state)).not.toContain(AUTH_USER_ID);

      const updateRes = await updateDailyBriefingPreferencesAction({ emailEnabled: true });
      expect(updateRes).toEqual({ success: true });

      const db: any = {
        tables: {
          daily_briefing_preferences: [{ user_id: AUTH_USER_ID, enabled: true, last_test_sent_at: null }],
        },
        rpcs: {},
      };
      mockFakeAdmin = createFakeAdmin(db, {
        users: { [AUTH_USER_ID]: { email: AUTH_EMAIL, email_confirmed_at: '2026-11-10T00:00:00Z' } },
      });
      const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'resend-test-1' }), { status: 200 }));
      global.fetch = fetchSpy as any;

      const testRes = await sendTestBriefingMessageAction('email');
      expect(testRes).toEqual({ success: true });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
      expect(body).toMatchObject({
        from: 'onboarding@resend.dev',
        to: [AUTH_EMAIL],
        subject: 'Zahi delivery test',
      });
    });

    it('hides email availability and blocks enable + test actions for unauthorized users while preserving Telegram', async () => {
      setProductionSingleUserEnv();
      const { updateCalls } = setupActionTables({
        user_id: OTHER_USER_ID,
        enabled: true,
        email_enabled: false,
        telegram_enabled: true,
        timezone: 'Africa/Cairo',
        delivery_local_time: '00:00:00',
      });
      mockGetUser.mockResolvedValue({
        data: { user: { id: OTHER_USER_ID, email: OTHER_EMAIL, email_confirmed_at: '2026-11-10T00:00:00Z' } },
      });

      const state = await getDailyBriefingStateAction();
      expect(state.data?.service.emailConfigured).toBe(false);
      expect(state.data?.service.emailRecipientMismatch).toBeUndefined();
      expect(state.data?.emailEnabled).toBe(false);
      expect(JSON.stringify(state)).not.toContain(AUTH_USER_ID);
      expect(JSON.stringify(state)).not.toContain(AUTH_EMAIL);

      const enableRes = await updateDailyBriefingPreferencesAction({ emailEnabled: true });
      expect(enableRes).toEqual({ error: 'Email delivery is not available for this account' });
      expect(updateCalls).toHaveLength(0);

      // Telegram preferences still work normally
      const tgUpdateRes = await updateDailyBriefingPreferencesAction({ enabled: true, telegramEnabled: true });
      expect(tgUpdateRes).toEqual({ success: true });
      expect(updateCalls).toHaveLength(1);

      const db: any = { tables: { daily_briefing_preferences: [] }, rpcs: {} };
      mockFakeAdmin = createFakeAdmin(db, {
        users: { [OTHER_USER_ID]: { email: OTHER_EMAIL, email_confirmed_at: '2026-11-10T00:00:00Z' } },
      });
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as any;

      const testEmailRes = await sendTestBriefingMessageAction('email');
      expect(testEmailRes).toEqual({ error: 'Email delivery is not available for this account' });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(db.tables.daily_briefing_preferences).toHaveLength(0);
    });

    it('fails closed if authorized user verified email does not match allowed recipient', async () => {
      setProductionSingleUserEnv({ DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT: 'resend-owner@example.com' });
      setupActionTables({
        user_id: AUTH_USER_ID,
        enabled: true,
        email_enabled: true,
        telegram_enabled: true,
      });
      mockGetUser.mockResolvedValue({
        data: { user: { id: AUTH_USER_ID, email: AUTH_EMAIL, email_confirmed_at: '2026-11-10T00:00:00Z' } },
      });

      const state = await getDailyBriefingStateAction();
      expect(state.data?.service.emailConfigured).toBe(false);
      expect(state.data?.service.emailRecipientMismatch).toBe(true);
      expect(state.data?.emailEnabled).toBe(false);

      const enableRes = await updateDailyBriefingPreferencesAction({ emailEnabled: true });
      expect(enableRes).toEqual({ error: 'Your verified email address is not authorized for email delivery' });

      // Turning email off remains allowed even on mismatch
      const disableRes = await updateDailyBriefingPreferencesAction({ emailEnabled: false });
      expect(disableRes).toEqual({ success: true });

      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as any;
      mockFakeAdmin = createFakeAdmin({ tables: {}, rpcs: {} }, {
        users: { [AUTH_USER_ID]: { email: AUTH_EMAIL, email_confirmed_at: '2026-11-10T00:00:00Z' } },
      });
      const testRes = await sendTestBriefingMessageAction('email');
      expect(testRes).toEqual({ error: 'Your verified email address is not authorized for email delivery' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('Resend adapter recipient guard', () => {
    it('enforces allowed recipient before calling Resend API', async () => {
      setProductionSingleUserEnv();
      const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 }));
      const adapter = createEmailAdapter(fetchSpy as any);

      const blocked = await adapter.send({ to: OTHER_EMAIL }, { channel: 'email', subject: 's', text: 't' });
      expect(blocked).toEqual({ ok: false, kind: 'permanent', code: 'email_recipient_unauthorized' });
      expect(fetchSpy).not.toHaveBeenCalled();

      const allowed = await adapter.send(
        { to: ' Owner@Example.com ' },
        { channel: 'email', subject: 's', text: 'body', html: '<p>body</p>' },
        { idempotencyKey: 'briefing-1' }
      );
      expect(allowed).toEqual({ ok: true, providerMessageId: 'msg-1' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('fails closed in adapter when single-user allowlist config is incomplete', async () => {
      setProductionSingleUserEnv({ DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT: undefined });
      const fetchSpy = vi.fn();
      const adapter = createEmailAdapter(fetchSpy as any);

      const res = await adapter.send({ to: AUTH_EMAIL }, { channel: 'email', subject: 's', text: 't' });
      expect(res).toEqual({ ok: false, kind: 'not_configured', code: 'email_restriction_not_configured' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('scheduler & dispatcher single-user isolation and idempotency', () => {
    const NOW = new Date('2026-11-13T00:05:00Z'); // 02:05 Cairo on 2026-11-13

    it('scheduler enqueues email ONLY for the authorized user with consent, while keeping Telegram for all', async () => {
      setProductionSingleUserEnv();
      const db: any = {
        tables: {
          daily_briefing_preferences: [
            {
              user_id: AUTH_USER_ID,
              enabled: true,
              email_enabled: true,
              telegram_enabled: true,
              timezone: 'Africa/Cairo',
              delivery_local_time: '00:00:00',
              email_consent_at: '2026-11-13T00:01:00Z',
            },
            {
              user_id: OTHER_USER_ID,
              enabled: true,
              email_enabled: true,
              telegram_enabled: true,
              timezone: 'Africa/Cairo',
              delivery_local_time: '00:00:00',
              email_consent_at: '2026-11-13T00:01:00Z',
            },
          ],
          // Telegram already sent today for authorized user; email newly enabled
          briefing_deliveries: [
            {
              id: 'existing-tg',
              user_id: AUTH_USER_ID,
              channel: 'telegram',
              local_date: '2026-11-13',
              status: 'sent',
            },
          ],
        },
        rpcs: {},
      };

      const admin = createFakeAdmin(db);
      const s1 = await enqueueDueBriefings(admin, NOW);
      // Enqueues missing email for AUTH_USER_ID + telegram for OTHER_USER_ID; never duplicates existing telegram
      expect(s1.enqueued).toBe(2);

      const s2 = await enqueueDueBriefings(admin, NOW);
      expect(s2.enqueued).toBe(0);

      expect(db.tables.briefing_deliveries.filter((d: any) => d.user_id === AUTH_USER_ID).map((d: any) => d.channel)).toEqual([
        'telegram',
        'email',
      ]);
      expect(db.tables.briefing_deliveries.filter((d: any) => d.user_id === OTHER_USER_ID).map((d: any) => d.channel)).toEqual([
        'telegram',
      ]);
    });

    it('scheduler never enqueues email when config is missing, without affecting Telegram', async () => {
      setProductionSingleUserEnv({ DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID: undefined });
      const db: any = {
        tables: {
          daily_briefing_preferences: [
            {
              user_id: AUTH_USER_ID,
              enabled: true,
              email_enabled: true,
              telegram_enabled: true,
              timezone: 'Africa/Cairo',
              delivery_local_time: '00:00:00',
              email_consent_at: '2026-11-13T00:01:00Z',
            },
          ],
          briefing_deliveries: [],
        },
        rpcs: {},
      };

      const res = await enqueueDueBriefings(createFakeAdmin(db), NOW);
      expect(res.enqueued).toBe(1);
      expect(db.tables.briefing_deliveries.map((d: any) => d.channel)).toEqual(['telegram']);
    });

    it('dispatcher refuses unauthorized users and unauthorized destinations before calling generator or email adapter', async () => {
      setProductionSingleUserEnv();
      const finalized: any[] = [];
      const claimedRows = [
        { id: 'd-unauth-user', user_id: OTHER_USER_ID, channel: 'email', local_date: '2026-11-13', claim_token: 'c1', attempt_count: 1 },
        { id: 'd-wrong-dest', user_id: AUTH_USER_ID, channel: 'email', local_date: '2026-11-13', claim_token: 'c2', attempt_count: 1 },
      ];
      let claimedOnce = false;
      const db: any = {
        tables: {
          daily_briefing_preferences: [
            { user_id: OTHER_USER_ID, enabled: true, email_enabled: true, telegram_enabled: true, email_consent_at: 'x' },
            { user_id: AUTH_USER_ID, enabled: true, email_enabled: true, telegram_enabled: true, email_consent_at: 'x' },
          ],
        },
        rpcs: {
          claim_briefing_deliveries: () => (claimedOnce ? [] : ((claimedOnce = true), claimedRows)),
          finalize_briefing_delivery: (a: any) => (finalized.push(a), true),
        },
      };
      // Authorized user email mismatches allowed recipient
      const admin = createFakeAdmin(db, {
        users: {
          [OTHER_USER_ID]: { email: OTHER_EMAIL, email_confirmed_at: 'now' },
          [AUTH_USER_ID]: { email: 'different@example.com', email_confirmed_at: 'now' },
        },
      });
      const emailSend = vi.fn();
      const gen = { generate: vi.fn() };

      const summary = await dispatchDueBriefings(admin, {
        generator: gen as any,
        email: { send: emailSend },
        telegram: { send: vi.fn() },
      });

      expect(summary.skipped).toBe(2);
      expect(summary.sent).toBe(0);
      expect(gen.generate).not.toHaveBeenCalled();
      expect(emailSend).not.toHaveBeenCalled();
      expect(finalized.map((f) => f.p_error_code)).toEqual(['email_user_unauthorized', 'email_recipient_unauthorized']);
    });

    it('delivers both Telegram and approved Email via cron route for the authorized user only', async () => {
      setProductionSingleUserEnv({
        EMAIL_FROM: 'onboarding@resend.dev',
        CRON_SECRET: 'cron-secret',
        DAILY_BRIEFING_DELIVERY_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: 'tg-token',
      });

      const db: any = {
        tables: {
          daily_briefing_preferences: [
            {
              user_id: AUTH_USER_ID,
              enabled: true,
              email_enabled: true,
              telegram_enabled: true,
              timezone: 'Africa/Cairo',
              delivery_local_time: '00:00:00',
              email_consent_at: '2026-11-13T00:01:00Z',
            },
            {
              user_id: OTHER_USER_ID,
              enabled: true,
              email_enabled: true,
              telegram_enabled: true,
              timezone: 'Africa/Cairo',
              delivery_local_time: '00:00:00',
              email_consent_at: '2026-11-13T00:01:00Z',
            },
          ],
          telegram_connections: [
            { user_id: AUTH_USER_ID, chat_id: 1001, status: 'active' },
            { user_id: OTHER_USER_ID, chat_id: 1002, status: 'active' },
          ],
          briefing_deliveries: [],
          tasks: [],
          content_items: [],
          calendar_blocks: [],
          workspaces: [{ id: 'w1', owner_id: AUTH_USER_ID }],
        },
        rpcs: {
          claim_briefing_deliveries: () => {
            const pending = db.tables.briefing_deliveries.filter((r: any) => !r.status || ['pending', 'retry'].includes(r.status));
            for (const row of pending) {
              row.status = 'claimed';
              row.claim_token = `claim-${row.id}`;
              row.attempt_count = (row.attempt_count ?? 0) + 1;
            }
            return pending;
          },
          finalize_briefing_delivery: (args: any) => {
            const row = db.tables.briefing_deliveries.find((r: any) => r.id === args.p_id);
            if (row) {
              row.status = args.p_outcome;
              row.provider_message_id = args.p_provider_message_id;
              row.last_error_code = args.p_error_code;
            }
            return true;
          },
        },
      };

      mockFakeAdmin = createFakeAdmin(db, {
        users: {
          [AUTH_USER_ID]: { email: AUTH_EMAIL, email_confirmed_at: '2026-11-01T00:00:00Z' },
          [OTHER_USER_ID]: { email: OTHER_EMAIL, email_confirmed_at: '2026-11-01T00:00:00Z' },
        },
      });

      const resendCalls: any[] = [];
      const telegramCalls: any[] = [];
      global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === 'https://api.resend.com/emails') {
          resendCalls.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify({ id: 'email-provider-id' }), { status: 200 });
        }
        if (url.startsWith('https://api.telegram.org/')) {
          telegramCalls.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify({ ok: true, result: { message_id: 55 } }), { status: 200 });
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      }) as any;

      const req = () =>
        new NextRequest('https://miler-creater.vercel.app/api/cron/daily-briefing', {
          method: 'POST',
          headers: { authorization: 'Bearer cron-secret' },
        });

      const res1 = await cronPost(req());
      expect(res1.status).toBe(200);
      const json1 = await res1.json();
      expect(json1).toMatchObject({
        success: true,
        enabled: true,
        enqueue: { enqueued: 3 }, // authorized (email+telegram) + unauthorized (telegram only)
        dispatch: { claimed: 3, sent: 3, failed: 0, skipped: 0 },
      });
      expect(resendCalls).toHaveLength(1);
      expect(resendCalls[0].from).toBe('onboarding@resend.dev');
      expect(resendCalls[0].to).toEqual([AUTH_EMAIL]);
      expect(resendCalls[0].subject).toMatch(/^Your Zahi briefing · /);
      expect(resendCalls[0].html).toContain('ZAHI');
      expect(telegramCalls).toHaveLength(2);

      // Re-running cron tick sends zero duplicates
      const res2 = await cronPost(req());
      const json2 = await res2.json();
      expect(json2).toMatchObject({
        enqueue: { enqueued: 0 },
        dispatch: { claimed: 0, sent: 0 },
      });
      expect(resendCalls).toHaveLength(1);
      expect(telegramCalls).toHaveLength(2);
    });
  });
});
