/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  dispatchControlledStagingBriefingAction,
} from '../src/lib/actions/daily-briefing-actions';
import {
  CONTROLLED_STAGING_TEST_USER_ID,
  CONTROLLED_STAGING_DATE,
  isControlledDispatchAllowed,
} from '../src/lib/briefing/controlled-dispatch';

const mockRevalidatePath = vi.fn();
vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => mockRevalidatePath(path),
}));

const mockGetUser = vi.fn();
let mockAdminFrom: any;
let mockRpc: any;
let mockTelegramSend: any;
let mockEmailSend: any;
let mockGenerateContent: any;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: () => mockGetUser(),
    },
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => mockAdminFrom(table),
    rpc: (...args: any[]) => mockRpc(...args),
    auth: {
      admin: {
        getUserById: vi.fn(async (id: string) => ({
          data: {
            user: {
              id,
              email: 'motriseandgformails@gmail.com',
              email_confirmed_at: '2026-11-10T12:00:00Z',
            },
          },
          error: null,
        })),
      },
    },
  })),
}));

vi.mock('@/lib/briefing/channels/telegram', () => ({
  createTelegramAdapter: vi.fn(() => ({
    send: (...args: any[]) => mockTelegramSend(...args),
  })),
}));

vi.mock('@/lib/briefing/channels/email', () => ({
  createEmailAdapter: vi.fn(() => ({
    send: (...args: any[]) => mockEmailSend(...args),
  })),
}));

vi.mock('@/lib/briefing/daily/generator', () => ({
  createDailyBriefingGenerator: vi.fn(() => ({
    generate: (...args: any[]) => mockGenerateContent(...args),
  })),
}));

describe('Preview-Only Controlled Staging Dispatch Suite', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VERCEL_ENV = 'preview';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://prmgrrzqtnygmitplkhn.supabase.co';
    process.env.ALLOW_CONTROLLED_TEST_DISPATCH = 'true';

    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: CONTROLLED_STAGING_TEST_USER_ID,
          email: 'motriseandgformails@gmail.com',
          email_confirmed_at: '2026-11-10T12:00:00Z',
        },
      },
    });

    mockGenerateContent = vi.fn().mockResolvedValue({
      status: 'ready',
      message: {
        channel: 'telegram',
        text: 'Sample Telegram briefing content',
        subject: 'Sample Subject',
      },
    });

    mockTelegramSend = vi.fn().mockResolvedValue({
      ok: true,
      providerMessageId: 'tg_msg_12345',
    });

    mockEmailSend = vi.fn().mockResolvedValue({
      ok: true,
      providerMessageId: 'email_msg_67890',
    });

    mockRpc = vi.fn().mockResolvedValue({ data: true, error: null });
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe('1. Mandatory Environment & Security Guards', () => {
    it('refuses execution outside preview environment', async () => {
      process.env.VERCEL_ENV = 'production';
      delete process.env.ALLOW_CONTROLLED_TEST_DISPATCH;

      const check = isControlledDispatchAllowed();
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('restricted to Vercel Preview');

      const res = await dispatchControlledStagingBriefingAction('telegram');
      expect(res.error).toContain('restricted to Vercel Preview');
    });

    it('refuses execution against production Supabase (zcpdpizrbaaekteurwup)', async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://zcpdpizrbaaekteurwup.supabase.co';

      const check = isControlledDispatchAllowed();
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('production Supabase is strictly forbidden');

      const res = await dispatchControlledStagingBriefingAction('email');
      expect(res.error).toContain('production Supabase is strictly forbidden');
    });

    it('refuses unauthenticated caller', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });
      const res = await dispatchControlledStagingBriefingAction('telegram');
      expect(res.error).toBe('Authentication required.');
    });

    it('refuses caller with non-test user ID', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: '99999999-9999-4999-a999-999999999999',
            email: 'other@example.com',
            email_confirmed_at: '2026-11-10T12:00:00Z',
          },
        },
      });

      const res = await dispatchControlledStagingBriefingAction('telegram');
      expect(res.error).toContain('restricted to the authorized staging test user');
    });
  });

  describe('2. Preferences, Verification & Consent Guards', () => {
    it('refuses dispatch if master briefing switch is disabled', async () => {
      mockAdminFrom = vi.fn((table: string) => {
        if (table === 'daily_briefing_preferences') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { enabled: false, telegram_enabled: true, email_enabled: true },
              error: null,
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await dispatchControlledStagingBriefingAction('telegram');
      expect(res.error).toContain('Daily Briefing master switch is disabled');
    });

    it('refuses Telegram dispatch if telegram_enabled is false', async () => {
      mockAdminFrom = vi.fn((table: string) => {
        if (table === 'daily_briefing_preferences') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { enabled: true, telegram_enabled: false },
              error: null,
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await dispatchControlledStagingBriefingAction('telegram');
      expect(res.error).toContain('Telegram delivery is disabled');
    });

    it('refuses Email dispatch if email_consent_at is null or email_enabled is false', async () => {
      mockAdminFrom = vi.fn((table: string) => {
        if (table === 'daily_briefing_preferences') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { enabled: true, email_enabled: true, email_consent_at: null },
              error: null,
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await dispatchControlledStagingBriefingAction('email');
      expect(res.error).toContain('requires email_enabled=true and recorded email consent');
    });
  });

  describe('3. Exact Delivery Claim & Concurrency Safeguards', () => {
    it('refuses duplicate send if delivery row is already sent', async () => {
      mockAdminFrom = vi.fn((table: string) => {
        if (table === 'daily_briefing_preferences') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { enabled: true, telegram_enabled: true },
              error: null,
            }),
          };
        }
        if (table === 'telegram_connections') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { chat_id: 5269925553, status: 'active' },
              error: null,
            }),
          };
        }
        if (table === 'briefing_deliveries') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'deliv-1111',
                status: 'sent',
                provider_message_id: 'tg_prior_100',
              },
              error: null,
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await dispatchControlledStagingBriefingAction('telegram');
      expect(res.error).toContain('has already been sent successfully. Duplicate sends are prohibited');
      expect(res.data?.status).toBe('sent');
      expect(mockTelegramSend).not.toHaveBeenCalled();
    });

    it('refuses send if delivery row is actively claimed by another worker', async () => {
      mockAdminFrom = vi.fn((table: string) => {
        if (table === 'daily_briefing_preferences') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { enabled: true, telegram_enabled: true },
              error: null,
            }),
          };
        }
        if (table === 'telegram_connections') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { chat_id: 5269925553, status: 'active' },
              error: null,
            }),
          };
        }
        if (table === 'briefing_deliveries') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'deliv-1111',
                status: 'claimed',
                claim_expires_at: new Date(Date.now() + 60_000).toISOString(),
              },
              error: null,
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await dispatchControlledStagingBriefingAction('telegram');
      expect(res.error).toContain('Delivery is currently being processed');
      expect(mockTelegramSend).not.toHaveBeenCalled();
    });
  });

  describe('4. Successful Dispatch & Ledger Finalization', () => {
    it('executes atomic claim, provider dispatch, and ledger finalization for Telegram', async () => {
      const mockUpdate = vi.fn().mockReturnThis();
      const mockIn = vi.fn().mockReturnThis();
      const mockSelect = vi.fn().mockReturnThis();
      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: { id: 'deliv-2222', attempt_count: 1 },
        error: null,
      });

      mockAdminFrom = vi.fn((table: string) => {
        if (table === 'daily_briefing_preferences') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { enabled: true, telegram_enabled: true },
              error: null,
            }),
          };
        }
        if (table === 'telegram_connections') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { chat_id: 5269925553, status: 'active' },
              error: null,
            }),
          };
        }
        if (table === 'briefing_deliveries') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null, // No existing slot yet
              error: null,
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'deliv-2222', status: 'pending', attempt_count: 0 },
                  error: null,
                }),
              }),
            }),
            update: mockUpdate.mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: mockIn.mockReturnValue({
                  select: mockSelect.mockReturnValue({
                    maybeSingle: mockMaybeSingle,
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await dispatchControlledStagingBriefingAction('telegram');

      expect(res.success).toBe(true);
      expect(res.data?.status).toBe('sent');
      expect(res.data?.providerMessageId).toBe('tg_msg_12345');

      // Verify content generated for November 12
      expect(mockGenerateContent).toHaveBeenCalledWith({
        userId: CONTROLLED_STAGING_TEST_USER_ID,
        localDate: CONTROLLED_STAGING_DATE,
        channel: 'telegram',
      });

      // Verify channel adapter called with chat_id
      expect(mockTelegramSend).toHaveBeenCalledWith(
        { chatId: 5269925553 },
        expect.any(Object)
      );

      // Verify finalize_briefing_delivery RPC called
      expect(mockRpc).toHaveBeenCalledWith('finalize_briefing_delivery', {
        p_id: 'deliv-2222',
        p_claim_token: expect.any(String),
        p_outcome: 'sent',
        p_error_code: null,
        p_error_message: null,
        p_provider_message_id: 'tg_msg_12345',
        p_retry_after_seconds: null,
      });

      expect(mockRevalidatePath).toHaveBeenCalledWith('/settings/notifications');
    });

    it('records ambiguous outcome without automatic retry when provider times out', async () => {
      mockTelegramSend = vi.fn().mockResolvedValue({
        ok: false,
        kind: 'ambiguous',
        code: 'telegram_timeout_or_network',
      });

      mockAdminFrom = vi.fn((table: string) => {
        if (table === 'daily_briefing_preferences') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { enabled: true, telegram_enabled: true },
              error: null,
            }),
          };
        }
        if (table === 'telegram_connections') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { chat_id: 5269925553, status: 'active' },
              error: null,
            }),
          };
        }
        if (table === 'briefing_deliveries') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'deliv-3333', status: 'pending', attempt_count: 0 },
              error: null,
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { id: 'deliv-3333', attempt_count: 1 },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await dispatchControlledStagingBriefingAction('telegram');

      expect(res.error).toContain("finished with outcome 'ambiguous'");
      expect(res.data?.status).toBe('ambiguous');

      // Verify RPC recorded 'ambiguous' and did NOT schedule retry
      expect(mockRpc).toHaveBeenCalledWith('finalize_briefing_delivery', {
        p_id: 'deliv-3333',
        p_claim_token: expect.any(String),
        p_outcome: 'ambiguous',
        p_error_code: 'telegram_timeout_or_network',
        p_error_message: expect.stringContaining('telegram_timeout_or_network'),
        p_provider_message_id: null,
        p_retry_after_seconds: null,
      });
    });
  });
});
