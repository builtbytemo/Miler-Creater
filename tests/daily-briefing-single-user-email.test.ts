/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import {
  canEnqueueEmailForUser,
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
    delete process.env.VERCEL_GIT_REPO_OWNER;
    delete process.env.VERCEL_GIT_REPO_SLUG;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.DAILY_BRIEFING_EXPECTED_SUPABASE_HOST;
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

      setProductionSingleUserEnv({ DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID: '   ' });
      expect(getDeliveryServiceStatus().emailConfigured).toBe(false);

      setProductionSingleUserEnv({ DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT: undefined });
      expect(getDeliveryServiceStatus().emailConfigured).toBe(false);

      setProductionSingleUserEnv({ DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT: '' });
      expect(getDeliveryServiceStatus().emailConfigured).toBe(false);

      setProductionSingleUserEnv({ RESEND_API_KEY: '   ' });
      expect(getDeliveryServiceStatus().emailConfigured).toBe(false);

      setProductionSingleUserEnv({ EMAIL_FROM: 'invalid-from' });
      expect(getDeliveryServiceStatus().emailConfigured).toBe(false);

      setProductionSingleUserEnv({ EMAIL_FROM: 'Zahi <not-an-email>' });
      expect(getDeliveryServiceStatus().emailConfigured).toBe(false);

      setProductionSingleUserEnv({ DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID: 'not-a-uuid' });
      expect(getDeliveryServiceStatus().emailConfigured).toBe(false);

      setProductionSingleUserEnv({ DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT: 'a@b.com,c@d.com' });
      expect(getDeliveryServiceStatus().emailConfigured).toBe(false);
    });

    it('never enables staging bypass on third-party Vercel Preview deployments or mismatched URLs/forks', () => {
      // Arbitrary non-production Supabase project on Vercel Preview -> must stay restricted single_user!
      process.env.VERCEL_ENV = 'preview';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://thirdparty-preview-project.supabase.co';
      process.env.RESEND_API_KEY = 're_thirdparty';
      process.env.EMAIL_FROM = 'onboarding@resend.dev';

      const thirdPartyPolicy = getEmailDeliveryPolicy();
      expect(thirdPartyPolicy.mode).toBe('single_user');
      expect(thirdPartyPolicy.configured).toBe(false);
      expect(getDeliveryServiceStatus().emailConfigured).toBe(false);

      // Missing Supabase URL on Vercel Preview -> must stay restricted
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      expect(getEmailDeliveryPolicy()).toMatchObject({ mode: 'single_user', configured: false });

      // Non-HTTPS or lookalike subdomain or custom port targeting Zahi staging -> must stay restricted
      for (const suspiciousUrl of [
        'http://prmgrrzqtnygmitplkhn.supabase.co',
        'https://prmgrrzqtnygmitplkhn.supabase.co.attacker.example',
        'https://prmgrrzqtnygmitplkhn.supabase.co:8443',
        'not-a-url',
      ]) {
        process.env.NEXT_PUBLIC_SUPABASE_URL = suspiciousUrl;
        expect(getEmailDeliveryPolicy()).toMatchObject({ mode: 'single_user', configured: false });
      }

      // Third-party GitHub fork metadata even if URL points to Zahi staging -> must stay restricted
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://prmgrrzqtnygmitplkhn.supabase.co';
      process.env.VERCEL_GIT_REPO_OWNER = 'someone-else';
      expect(getEmailDeliveryPolicy()).toMatchObject({ mode: 'single_user', configured: false });
      delete process.env.VERCEL_GIT_REPO_OWNER;

      // Conflicting SUPABASE_URL -> must stay restricted
      process.env.SUPABASE_URL = 'https://other-project.supabase.co';
      expect(getEmailDeliveryPolicy()).toMatchObject({ mode: 'single_user', configured: false });
      delete process.env.SUPABASE_URL;

      // Production Supabase on Vercel Preview -> must stay restricted
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://zcpdpizrbaaekteurwup.supabase.co';
      expect(getEmailDeliveryPolicy()).toMatchObject({ mode: 'single_user', configured: false });
    });

    it('preserves staging multi-user mode ONLY for known Zahi staging when restriction vars are absent', () => {
      process.env.VERCEL_ENV = 'preview';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://prmgrrzqtnygmitplkhn.supabase.co';
      process.env.RESEND_API_KEY = 're_staging';
      process.env.EMAIL_FROM = 'onboarding@resend.dev';

      expect(getEmailDeliveryPolicy()).toEqual({
        mode: 'staging',
        credentialsConfigured: true,
        configured: true,
      });

      // Also preserved when Zahi's Vercel Git repo owner metadata is exposed
      process.env.VERCEL_GIT_REPO_OWNER = 'builtbytemo';
      expect(getEmailDeliveryPolicy()).toEqual({
        mode: 'staging',
        credentialsConfigured: true,
        configured: true,
      });

      // Adding even a partial restriction variable overrides staging bypass and fails closed
      process.env.DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID = AUTH_USER_ID;
      expect(getEmailDeliveryPolicy()).toMatchObject({ mode: 'single_user', configured: false });
    });

    it('supports independent single-user configuration on third-party Vercel Preview and non-Vercel hosts', () => {
      // Non-Vercel hosting (no VERCEL_ENV)
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://selfhost-node.supabase.co';
      process.env.RESEND_API_KEY = 're_selfhost';
      process.env.EMAIL_FROM = 'Zahi <onboarding@resend.dev>';
      expect(getEmailDeliveryPolicy()).toMatchObject({ mode: 'single_user', configured: false });

      process.env.DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID = AUTH_USER_ID;
      process.env.DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT = AUTH_EMAIL;
      expect(getEmailDeliveryPolicy()).toEqual({
        mode: 'single_user',
        credentialsConfigured: true,
        restrictionConfigured: true,
        configured: true,
        allowedUserId: AUTH_USER_ID,
        allowedRecipient: AUTH_EMAIL,
      });

      // Third-party Vercel Preview with own Supabase + allowlist remains strictly single_user (never staging)
      process.env.VERCEL_ENV = 'preview';
      expect(getEmailDeliveryPolicy()).toMatchObject({
        mode: 'single_user',
        configured: true,
        allowedUserId: AUTH_USER_ID,
        allowedRecipient: AUTH_EMAIL,
      });
    });

    it('accepts onboarding@resend.dev and display-name sender formats without header injection', () => {
      expect(parseValidEmailFrom('onboarding@resend.dev')).toBe('onboarding@resend.dev');
      expect(parseValidEmailFrom('Zahi <onboarding@resend.dev>')).toBe('Zahi <onboarding@resend.dev>');
      expect(parseValidEmailFrom('Zahi\r\nBcc: x@y.com <onboarding@resend.dev>')).toBeNull();
      expect(normalizeEmailAddress(' Owner@Example.COM ')).toBe('owner@example.com');
    });

    it('does not hardcode personal email addresses or authorized user IDs in briefing source or docs', () => {
      const files = [
        'src/lib/briefing/config.ts',
        'src/lib/briefing/channels/email.ts',
        'src/lib/briefing/scheduler.ts',
        'src/lib/briefing/dispatcher.ts',
        'src/lib/actions/daily-briefing-actions.ts',
        'src/components/settings/DailyBriefingSettings.tsx',
        'src/app/api/cron/daily-briefing/route.ts',
        '.env.example',
        'docs/SELF_HOSTING_PERSONAL_EMAIL.md',
      ];
      for (const f of files) {
        const src = readFileSync(f, 'utf8');
        expect(src).not.toMatch(/@gmail\.com/i);
        expect(src).not.toMatch(/eac8058d/i);
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

  describe('independent self-hosted installations, non-Vercel hosting, and third-party preview', () => {
    function buildMultiUserCronDb(userA: string, emailA: string, userB: string, emailB: string) {
      const db: any = {
        tables: {
          daily_briefing_preferences: [
            {
              user_id: userA,
              enabled: true,
              email_enabled: true,
              telegram_enabled: true,
              timezone: 'UTC',
              delivery_local_time: '00:00:00',
              email_consent_at: '2026-11-13T00:01:00Z',
            },
            {
              user_id: userB,
              enabled: true,
              email_enabled: true,
              telegram_enabled: true,
              timezone: 'UTC',
              delivery_local_time: '00:00:00',
              email_consent_at: '2026-11-13T00:01:00Z',
            },
          ],
          telegram_connections: [
            { user_id: userA, chat_id: 2001, status: 'active' },
            { user_id: userB, chat_id: 2002, status: 'active' },
          ],
          briefing_deliveries: [],
          tasks: [],
          content_items: [],
          calendar_blocks: [],
          workspaces: [
            { id: 'w-a', owner_id: userA },
            { id: 'w-b', owner_id: userB },
          ],
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

      const admin = createFakeAdmin(db, {
        users: {
          [userA]: { email: emailA, email_confirmed_at: '2026-11-01T00:00:00Z' },
          [userB]: { email: emailB, email_confirmed_at: '2026-11-01T00:00:00Z' },
        },
      });
      return { db, admin };
    }

    it('supports two independent installations with different Supabase projects, Resend credentials, and authorized identities', async () => {
      const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const EMAIL_A = 'alpha@alpha-selfhost.example';
      const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const EMAIL_B = 'beta@beta-custom.example';

      const installations = [
        {
          name: 'Non-Vercel Installation A',
          vercelEnv: undefined,
          host: 'install-a-ref.supabase.co',
          resendKey: 're_install_a_secret',
          from: 'Zahi Personal <onboarding@resend.dev>',
          allowedUser: USER_A,
          allowedEmail: EMAIL_A,
          deniedUser: USER_B,
          deniedEmail: EMAIL_B,
          cronUrl: 'https://zahi-a.selfhost.example/api/cron/daily-briefing',
        },
        {
          name: 'Third-Party Vercel Installation B',
          vercelEnv: 'production',
          host: 'install-b-ref.supabase.co',
          resendKey: 're_install_b_secret',
          from: 'Daily Brief <briefing@beta-custom.example>',
          allowedUser: USER_B,
          allowedEmail: EMAIL_B,
          deniedUser: USER_A,
          deniedEmail: EMAIL_A,
          cronUrl: 'https://zahi-b.vercel.app/api/cron/daily-briefing',
        },
      ];

      for (const inst of installations) {
        delete process.env.VERCEL_ENV;
        if (inst.vercelEnv) process.env.VERCEL_ENV = inst.vercelEnv;
        process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${inst.host}`;
        process.env.DAILY_BRIEFING_EXPECTED_SUPABASE_HOST = inst.host;
        process.env.CRON_SECRET = `cron-${inst.name}`;
        process.env.DAILY_BRIEFING_DELIVERY_ENABLED = 'true';
        process.env.TELEGRAM_BOT_TOKEN = `tg-${inst.name}`;
        process.env.RESEND_API_KEY = inst.resendKey;
        process.env.EMAIL_FROM = inst.from;
        process.env.DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID = inst.allowedUser;
        process.env.DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT = inst.allowedEmail;

        const { admin } = buildMultiUserCronDb(USER_A, EMAIL_A, USER_B, EMAIL_B);
        mockFakeAdmin = admin;

        // UI state shows email enabled ONLY for this installation's authorized user
        mockGetUser.mockResolvedValue({
          data: { user: { id: inst.allowedUser, email: inst.allowedEmail, email_confirmed_at: '2026-11-01T00:00:00Z' } },
        });
        const allowPrefsQuery = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { enabled: true, email_enabled: true, telegram_enabled: true }, error: null }),
        };
        mockUserPrefsDb = allowPrefsQuery;
        mockTelegramDb = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { status: 'active', telegram_username: 'u' }, error: null }),
        };
        const allowedState = await getDailyBriefingStateAction();
        expect(allowedState.data?.service.emailConfigured).toBe(true);
        expect(allowedState.data?.emailEnabled).toBe(true);

        mockGetUser.mockResolvedValue({
          data: { user: { id: inst.deniedUser, email: inst.deniedEmail, email_confirmed_at: '2026-11-01T00:00:00Z' } },
        });
        const deniedState = await getDailyBriefingStateAction();
        expect(deniedState.data?.service.emailConfigured).toBe(false);
        expect(deniedState.data?.emailEnabled).toBe(false);

        const resendCalls: { auth: string | null; idempotencyKey: string | null; body: any }[] = [];
        const telegramCalls: any[] = [];
        global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
          const headers = new Headers(init?.headers);
          if (url === 'https://api.resend.com/emails') {
            resendCalls.push({
              auth: headers.get('authorization'),
              idempotencyKey: headers.get('idempotency-key'),
              body: JSON.parse(String(init?.body)),
            });
            return new Response(JSON.stringify({ id: `msg-${inst.host}` }), { status: 200 });
          }
          if (url.startsWith('https://api.telegram.org/')) {
            telegramCalls.push(JSON.parse(String(init?.body)));
            return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
          }
          throw new Error(`Unexpected fetch URL: ${url}`);
        }) as any;

        const res = await cronPost(
          new NextRequest(inst.cronUrl, {
            method: 'POST',
            headers: { authorization: `Bearer cron-${inst.name}` },
          })
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
          success: true,
          enabled: true,
          enqueue: { enqueued: 3 },
          dispatch: { claimed: 3, sent: 3, failed: 0, skipped: 0 },
        });

        expect(resendCalls).toHaveLength(1);
        expect(resendCalls[0].auth).toBe(`Bearer ${inst.resendKey}`);
        expect(resendCalls[0].idempotencyKey).toMatch(/^briefing-/);
        expect(resendCalls[0].body).toMatchObject({
          from: inst.from,
          to: [inst.allowedEmail],
        });
        expect(resendCalls[0].body.subject).toMatch(/^Your Zahi briefing · /);
        expect(telegramCalls).toHaveLength(2);
      }
    });

    it('fails closed on non-Vercel hosting when restriction vars or explicit cron host are missing or malformed', async () => {
      // Simulate non-Vercel platform without allowlist or cron host pin
      delete process.env.VERCEL_ENV;
      process.env.FLY_APP_NAME = 'zahi-docker-instance';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://selfhost-no-allowlist.supabase.co';
      process.env.CRON_SECRET = 'cron-secret';
      process.env.DAILY_BRIEFING_DELIVERY_ENABLED = 'true';
      process.env.RESEND_API_KEY = 're_selfhost';
      process.env.EMAIL_FROM = 'onboarding@resend.dev';

      expect(getEmailDeliveryPolicy()).toMatchObject({ mode: 'single_user', configured: false });
      expect(canEnqueueEmailForUser(AUTH_USER_ID)).toBe(false);

      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as any;
      const adapterRes = await createEmailAdapter(fetchSpy as any).send(
        { to: AUTH_EMAIL },
        { channel: 'email', subject: 's', text: 't' }
      );
      expect(adapterRes).toEqual({ ok: false, kind: 'not_configured', code: 'email_restriction_not_configured' });
      expect(fetchSpy).not.toHaveBeenCalled();

      // Cron fails closed without DAILY_BRIEFING_EXPECTED_SUPABASE_HOST on non-Vercel host
      const missingHostRes = await cronPost(
        new NextRequest('https://selfhost.example/api/cron/daily-briefing', {
          method: 'POST',
          headers: { authorization: 'Bearer cron-secret' },
        })
      );
      expect(missingHostRes.status).toBe(403);

      // Cron fails closed for malformed or mismatched DAILY_BRIEFING_EXPECTED_SUPABASE_HOST
      for (const badHost of ['', '   ', 'https://selfhost-no-allowlist.supabase.co', 'wrong.supabase.co', 'bad host']) {
        process.env.DAILY_BRIEFING_EXPECTED_SUPABASE_HOST = badHost;
        const badRes = await cronPost(
          new NextRequest('https://selfhost.example/api/cron/daily-briefing', {
            method: 'POST',
            headers: { authorization: 'Bearer cron-secret' },
          })
        );
        expect(badRes.status).toBe(403);
      }
    });

    it('enforces single-user mode on third-party Vercel Preview deployments with or without allowlist config', async () => {
      process.env.VERCEL_ENV = 'preview';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://thirdparty-preview-999.supabase.co';
      process.env.CRON_SECRET = 'cron-preview';
      process.env.DAILY_BRIEFING_DELIVERY_ENABLED = 'true';
      process.env.TELEGRAM_BOT_TOKEN = 'tg-preview';
      process.env.RESEND_API_KEY = 're_thirdparty';
      process.env.EMAIL_FROM = 'Zahi <onboarding@resend.dev>';

      // 1. Without allowlist vars: never infers staging from VERCEL_ENV=preview
      expect(getEmailDeliveryPolicy()).toMatchObject({ mode: 'single_user', configured: false });
      const { db, admin } = buildMultiUserCronDb(AUTH_USER_ID, AUTH_EMAIL, OTHER_USER_ID, OTHER_EMAIL);
      const enqueueBlocked = await enqueueDueBriefings(admin, new Date('2026-11-13T00:05:00Z'));
      expect(enqueueBlocked.enqueued).toBe(2); // Telegram for both users only; zero emails
      expect(db.tables.briefing_deliveries.every((r: any) => r.channel === 'telegram')).toBe(true);

      // Cron without DAILY_BRIEFING_EXPECTED_SUPABASE_HOST also blocks unknown preview host
      const unpinnedCronRes = await cronPost(
        new NextRequest('https://thirdparty-preview.vercel.app/api/cron/daily-briefing', {
          method: 'POST',
          headers: { authorization: 'Bearer cron-preview' },
        })
      );
      expect(unpinnedCronRes.status).toBe(403);

      // 2. With explicit Personal Mode allowlist + target host pin: single_user mode works on third-party Preview
      process.env.DAILY_BRIEFING_EXPECTED_SUPABASE_HOST = 'thirdparty-preview-999.supabase.co';
      process.env.DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID = AUTH_USER_ID;
      process.env.DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT = AUTH_EMAIL;
      expect(getEmailDeliveryPolicy()).toMatchObject({ mode: 'single_user', configured: true });

      const fresh = buildMultiUserCronDb(AUTH_USER_ID, AUTH_EMAIL, OTHER_USER_ID, OTHER_EMAIL);
      mockFakeAdmin = fresh.admin;
      const resendCalls: any[] = [];
      global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === 'https://api.resend.com/emails') {
          resendCalls.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify({ id: 'tp-email-1' }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true, result: { message_id: 2 } }), { status: 200 });
      }) as any;

      const pinnedRes = await cronPost(
        new NextRequest('https://thirdparty-preview.vercel.app/api/cron/daily-briefing', {
          method: 'POST',
          headers: { authorization: 'Bearer cron-preview' },
        })
      );
      expect(pinnedRes.status).toBe(200);
      expect(resendCalls).toHaveLength(1);
      expect(resendCalls[0].to).toEqual([AUTH_EMAIL]);
    });

    it('preserves existing Zahi staging cron and multi-user email delivery without new env vars', async () => {
      process.env.VERCEL_ENV = 'preview';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://prmgrrzqtnygmitplkhn.supabase.co';
      process.env.CRON_SECRET = 'cron-staging';
      process.env.DAILY_BRIEFING_DELIVERY_ENABLED = 'true';
      process.env.TELEGRAM_BOT_TOKEN = 'tg-staging';
      process.env.RESEND_API_KEY = 're_staging';
      process.env.EMAIL_FROM = 'Zahi <onboarding@resend.dev>';

      const { admin } = buildMultiUserCronDb(AUTH_USER_ID, AUTH_EMAIL, OTHER_USER_ID, OTHER_EMAIL);
      mockFakeAdmin = admin;

      const resendRecipients: string[] = [];
      global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === 'https://api.resend.com/emails') {
          const payload = JSON.parse(String(init?.body));
          resendRecipients.push(...payload.to);
          return new Response(JSON.stringify({ id: 'stg-email' }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), { status: 200 });
      }) as any;

      const res = await cronPost(
        new NextRequest('https://preview.miler.app/api/cron/daily-briefing', {
          method: 'POST',
          headers: { authorization: 'Bearer cron-staging' },
        })
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        success: true,
        enabled: true,
        enqueue: { enqueued: 4 },
        dispatch: { claimed: 4, sent: 4, failed: 0, skipped: 0 },
      });
      expect(resendRecipients.sort()).toEqual([AUTH_EMAIL, OTHER_EMAIL].sort());
    });
  });
});
