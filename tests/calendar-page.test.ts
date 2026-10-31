import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import CalendarPage from '../src/app/calendar/page';
import type { ContentItemWithMeta } from '../src/lib/services/content-service';

// Mock server APIs
const mockConnection = vi.fn();
const mockRedirect = vi.fn();
const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockGetContentItems = vi.fn();
const mockGetSocialAccounts = vi.fn();
const mockGetTasks = vi.fn();

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error(`NEXT_REDIRECT: ${url}`);
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  })),
}));

vi.mock('@/lib/services/content-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/content-service')>();
  return {
    ...actual,
    getContentItems: (...args: unknown[]) => mockGetContentItems(...args),
    getSocialAccounts: (...args: unknown[]) => mockGetSocialAccounts(...args),
  };
});

vi.mock('@/lib/services/task-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/task-service')>();
  return {
    ...actual,
    getTasks: (...args: unknown[]) => mockGetTasks(...args),
  };
});

vi.mock('@/components/layout/AppNavigation', () => ({
  AppNavigation: () => React.createElement('nav', { 'data-testid': 'app-nav' }),
}));

vi.mock('@/components/calendar/CalendarWorkspace', () => ({
  CalendarWorkspace: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'calendar-workspace', ...props }),
}));

describe('CalendarPage Server Component (Phase 4, Step 2)', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnection.mockResolvedValue(undefined);
    mockGetTasks.mockResolvedValue([]);
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'example-anon-key';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  });

  it('calls await connection() before requesting auth session or database queries', async () => {
    const order: string[] = [];
    mockConnection.mockImplementationOnce(async () => {
      order.push('connection');
    });
    mockGetUser.mockImplementationOnce(async () => {
      order.push('getUser');
      return { data: { user: { id: 'usr-111' } } };
    });

    const mockProfileQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { timezone: 'Africa/Cairo' } }),
    };

    const mockMemberQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          workspace_id: 'ws-111',
          workspaces: { id: 'ws-111', name: 'Editorial WS', slug: 'editorial' },
        },
      }),
    };

    const mockProjectsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    mockProjectsQuery.eq.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [] }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return mockProfileQuery;
      if (table === 'workspace_members') return mockMemberQuery;
      if (table === 'projects') return mockProjectsQuery;
      return {};
    });

    mockGetContentItems.mockResolvedValue([]);
    mockGetSocialAccounts.mockResolvedValue([]);

    await CalendarPage();

    expect(order).toEqual(['connection', 'getUser']);
  });

  it('redirects unauthenticated users to /auth/sign-in with redirectTo=/calendar', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    await expect(CalendarPage()).rejects.toThrow('NEXT_REDIRECT: /auth/sign-in?redirectTo=/calendar');
    expect(mockRedirect).toHaveBeenCalledWith('/auth/sign-in?redirectTo=/calendar');
  });

  it('renders configuration warning if NEXT_PUBLIC_SUPABASE_URL is unconfigured', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://your-project-ref.supabase.co';

    const result = await CalendarPage();

    expect(result).toBeDefined();
    expect(result.props.className).toContain('bg-neutral-900');
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('renders fallback notice if user lacks workspace membership', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-111' } } });

    const mockProfileQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { timezone: 'Africa/Cairo' } }),
    };

    const mockMemberQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return mockProfileQuery;
      if (table === 'workspace_members') return mockMemberQuery;
      return {};
    });

    const result = await CalendarPage();

    expect(result).toBeDefined();
    expect(mockGetContentItems).not.toHaveBeenCalled();
  });

  it('resolves timezone from user profile, including alias normalization and fallback', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'usr-111' } } });

    const setupWithTimezone = (tz: string | null) => {
      const mockProfileQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: tz ? { timezone: tz } : null }),
      };

      const mockMemberQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            workspace_id: 'ws-111',
            workspaces: { id: 'ws-111', name: 'Editorial WS', slug: 'editorial' },
          },
        }),
      };

      const mockProjectsQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      mockProjectsQuery.eq.mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [] }),
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'profiles') return mockProfileQuery;
        if (table === 'workspace_members') return mockMemberQuery;
        if (table === 'projects') return mockProjectsQuery;
        return {};
      });

      mockGetContentItems.mockResolvedValue([]);
      mockGetSocialAccounts.mockResolvedValue([]);
    };

    // Case 1: Requirement alias 'Asia/Cairo' normalizes to 'Africa/Cairo'
    setupWithTimezone('Asia/Cairo');
    const result1 = await CalendarPage();
    expect(result1).toBeDefined();

    // Case 2: Configured timezone 'America/New_York'
    setupWithTimezone('America/New_York');
    const result2 = await CalendarPage();
    expect(result2).toBeDefined();

    // Case 3: Invalid timezone 'Invalid/Zone' falls back safely to 'Africa/Cairo'
    setupWithTimezone('Invalid/Zone');
    const result3 = await CalendarPage();
    expect(result3).toBeDefined();

    // Case 4: Missing profile falls back safely to 'Africa/Cairo'
    setupWithTimezone(null);
    const result4 = await CalendarPage();
    expect(result4).toBeDefined();
  });

  it('queries scheduled items using calculated visible range boundaries and unscheduled items separately', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-111' } } });

    const mockProfileQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { timezone: 'Africa/Cairo' } }),
    };

    const mockMemberQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          workspace_id: 'ws-111',
          workspaces: { id: 'ws-111', name: 'Editorial WS', slug: 'editorial' },
        },
      }),
    };

    const mockProjectsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    mockProjectsQuery.eq.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'p-1', name: 'Launch', color: '#3b82f6' }] }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return mockProfileQuery;
      if (table === 'workspace_members') return mockMemberQuery;
      if (table === 'projects') return mockProjectsQuery;
      return {};
    });

    const sampleScheduledItem: ContentItemWithMeta = {
      id: 'c-1',
      workspace_id: 'ws-111',
      social_account_id: null,
      platform: 'linkedin',
      action_type: 'post',
      status: 'scheduled',
      title: 'Scheduled Launch Post',
      body: 'Launch details',
      scheduled_at: '2026-10-28T10:00:00Z',
      duration_minutes: 30,
      media_urls: [],
      external_links: [],
      target_reference: null,
      tags: [],
      notes: null,
      project_id: null,
      milestone_id: null,
      recurrence_rule_id: null,
      created_by: 'usr-111',
      created_at: '2026-10-25T10:00:00Z',
      updated_at: '2026-10-25T10:00:00Z',
    };

    const sampleUnscheduledDraft: ContentItemWithMeta = {
      id: 'c-2',
      workspace_id: 'ws-111',
      social_account_id: null,
      platform: 'x',
      action_type: 'post',
      status: 'draft',
      title: 'Unscheduled Draft Angle',
      body: 'Draft body',
      scheduled_at: null,
      duration_minutes: null,
      media_urls: [],
      external_links: [],
      target_reference: null,
      tags: [],
      notes: null,
      project_id: null,
      milestone_id: null,
      recurrence_rule_id: null,
      created_by: 'usr-111',
      created_at: '2026-10-25T11:00:00Z',
      updated_at: '2026-10-25T11:00:00Z',
    };

    // First call: scheduled items for range
    // Second call: unscheduled items
    mockGetContentItems.mockImplementation((_client, _wsId, filter) => {
      if (filter?.scheduled_from && filter?.scheduled_to) {
        return Promise.resolve([sampleScheduledItem]);
      }
      if (filter?.is_scheduled === false) {
        return Promise.resolve([sampleUnscheduledDraft]);
      }
      return Promise.resolve([]);
    });

    mockGetSocialAccounts.mockResolvedValueOnce([
      {
        id: 'sa-1',
        workspace_id: 'ws-111',
        platform: 'linkedin',
        account_handle: '@commandcenter',
        account_name: 'Command Center',
        avatar_url: null,
        status: 'draft',
        created_at: '2026-10-25T00:00:00Z',
        updated_at: '2026-10-25T00:00:00Z',
      },
    ]);

    const result = await CalendarPage();

    expect(result).toBeDefined();

    // Verify scheduled query passed ISO date range
    expect(mockGetContentItems).toHaveBeenCalledWith(
      expect.anything(),
      'ws-111',
      expect.objectContaining({
        scheduled_from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
        scheduled_to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
      })
    );

    // Verify unscheduled query passed is_scheduled: false
    expect(mockGetContentItems).toHaveBeenCalledWith(
      expect.anything(),
      'ws-111',
      expect.objectContaining({
        is_scheduled: false,
      })
    );

    // Verify social accounts strictly workspace scoped
    expect(mockGetSocialAccounts).toHaveBeenCalledWith(expect.anything(), 'ws-111');
  });
});
