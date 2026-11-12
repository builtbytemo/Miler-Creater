/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  updateDailyBriefingPreferencesAction,
  getDailyBriefingStateAction,
} from '../src/lib/actions/daily-briefing-actions';

// Mock dependencies
const mockRevalidatePath = vi.fn();
vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => mockRevalidatePath(path),
}));

const mockGetUser = vi.fn();
let mockPreferencesDb: any;
let mockTelegramDb: any;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: () => mockGetUser(),
    },
    from: vi.fn((table: string) => {
      if (table === 'daily_briefing_preferences') {
        return mockPreferencesDb;
      }
      if (table === 'telegram_connections') {
        return mockTelegramDb;
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  })),
}));

describe('Daily Briefing Actions Suite', () => {
  const userId = 'b9dffc37-9bb8-422b-ba72-7ab1c3dfb8e3';

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: userId,
          email: 'motriseandgformails@gmail.com',
          email_confirmed_at: '2026-11-10T12:00:00Z',
        },
      },
    });
  });

  describe('updateDailyBriefingPreferencesAction', () => {
    it('requires authentication', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });
      const res = await updateDailyBriefingPreferencesAction({ enabled: true });
      expect(res).toEqual({ error: 'Authentication required' });
    });

    it('rejects invalid timezone', async () => {
      const res = await updateDailyBriefingPreferencesAction({ timezone: 'Invalid/City_Name' });
      expect(res).toEqual({ error: 'Invalid timezone' });
    });

    it('rejects invalid delivery time', async () => {
      const res = await updateDailyBriefingPreferencesAction({ deliveryLocalTime: '25:99' });
      expect(res).toEqual({ error: 'Invalid delivery time' });
    });

    it('rejects enabling email if user email is unverified', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: userId,
            email: 'unconfirmed@example.com',
            email_confirmed_at: null,
          },
        },
      });
      const res = await updateDailyBriefingPreferencesAction({ emailEnabled: true });
      expect(res).toEqual({ error: 'Your account email address is not verified' });
    });

    it('updates existing row directly (preserving column-level grants and avoiding table-level upsert 42501)', async () => {
      const updateMock = vi.fn().mockReturnThis();
      const eqMock = vi.fn().mockReturnThis();
      const selectMock = vi.fn().mockResolvedValue({
        data: [{ user_id: userId }],
        error: null,
      });

      mockPreferencesDb = {
        update: updateMock,
        eq: eqMock,
        select: selectMock,
        insert: vi.fn(),
      };

      const res = await updateDailyBriefingPreferencesAction({
        enabled: true,
        emailEnabled: true,
        telegramEnabled: true,
      });

      expect(res).toEqual({ success: true });
      expect(updateMock).toHaveBeenCalledWith({
        enabled: true,
        email_enabled: true,
        telegram_enabled: true,
      });
      expect(eqMock).toHaveBeenCalledWith('user_id', userId);
      expect(mockPreferencesDb.insert).not.toHaveBeenCalled();
      expect(mockRevalidatePath).toHaveBeenCalledWith('/settings/notifications');
    });

    it('falls back to insert when no preferences row exists yet', async () => {
      // 1. update returns empty rows (row doesn't exist yet)
      const updateMock = vi.fn().mockReturnThis();
      const eqMock = vi.fn().mockReturnThis();
      const selectMock = vi.fn().mockResolvedValue({
        data: [],
        error: null,
      });

      // 2. insert succeeds
      const insertMock = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });

      mockPreferencesDb = {
        update: updateMock,
        eq: eqMock,
        select: selectMock,
        insert: insertMock,
      };

      const res = await updateDailyBriefingPreferencesAction({
        enabled: true,
        deliveryLocalTime: '08:30',
      });

      expect(res).toEqual({ success: true });
      expect(insertMock).toHaveBeenCalledWith({
        user_id: userId,
        enabled: true,
        delivery_local_time: '08:30',
      });
      expect(mockRevalidatePath).toHaveBeenCalledWith('/settings/notifications');
    });

    it('retries update if a concurrent insert race condition occurs (error 23505)', async () => {
      // 1. initial update finds 0 rows
      const selectMock = vi.fn().mockResolvedValue({
        data: [],
        error: null,
      });
      // 2. insert triggers duplicate key (23505) because another concurrent request just inserted
      const insertMock = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      });
      // 3. retry update succeeds
      let updateCallCount = 0;
      const updateMock = vi.fn().mockImplementation(() => {
        updateCallCount++;
        return {
          eq: vi.fn().mockImplementation(() => {
            if (updateCallCount === 1) {
              return { select: selectMock };
            }
            return Promise.resolve({ data: null, error: null });
          }),
        };
      });

      mockPreferencesDb = {
        update: updateMock,
        insert: insertMock,
      };

      const res = await updateDailyBriefingPreferencesAction({ enabled: true });
      expect(res).toEqual({ success: true });
      expect(insertMock).toHaveBeenCalled();
      expect(updateCallCount).toBe(2);
      expect(mockRevalidatePath).toHaveBeenCalledWith('/settings/notifications');
    });

    it('returns user-friendly error when update fails with database error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const updateMock = vi.fn().mockReturnThis();
      const eqMock = vi.fn().mockReturnThis();
      const selectMock = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'permission denied' },
      });

      mockPreferencesDb = {
        update: updateMock,
        eq: eqMock,
        select: selectMock,
      };

      const res = await updateDailyBriefingPreferencesAction({ enabled: true });
      expect(res).toEqual({ error: 'Could not save Daily Briefing preferences' });
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('getDailyBriefingStateAction', () => {
    it('returns complete daily briefing state for authenticated user', async () => {
      mockPreferencesDb = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            enabled: true,
            email_enabled: true,
            telegram_enabled: false,
            timezone: 'Africa/Cairo',
            delivery_local_time: '08:00:00',
          },
          error: null,
        }),
      };

      mockTelegramDb = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            status: 'active',
            telegram_username: 'test_telegram_user',
          },
          error: null,
        }),
      };

      const res = await getDailyBriefingStateAction();
      expect(res.data).toEqual({
        enabled: true,
        emailEnabled: true,
        telegramEnabled: false,
        timezone: 'Africa/Cairo',
        deliveryLocalTime: '08:00',
        telegram: {
          status: 'active',
          username: 'test_telegram_user',
        },
        emailAddressVerified: true,
        service: expect.any(Object),
      });
    });

    it('handles null preferences and missing telegram connection with safe defaults', async () => {
      mockPreferencesDb = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };

      mockTelegramDb = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };

      const res = await getDailyBriefingStateAction();
      expect(res.data).toEqual({
        enabled: false,
        emailEnabled: false,
        telegramEnabled: false,
        timezone: 'Africa/Cairo',
        deliveryLocalTime: '00:00',
        telegram: {
          status: 'not_connected',
          username: null,
        },
        emailAddressVerified: true,
        service: expect.any(Object),
      });
    });
  });
});
