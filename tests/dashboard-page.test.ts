import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DashboardPage from '../src/app/dashboard/page';
import type { DashboardSummary } from '@/lib/services/dashboard-service';
import type { NotificationRow } from '@/lib/services/notification-service';

// Mock server APIs
const mockConnection = vi.fn();
const mockRedirect = vi.fn();
const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockResolveAuthorizedWorkspace = vi.fn();
const mockGetDashboardSummary = vi.fn();

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error(`NEXT_REDIRECT: ${url}`);
  },
  usePathname: () => '/dashboard',
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  })),
}));

vi.mock('@/lib/auth/workspace', () => ({
  resolveAuthorizedWorkspace: (...args: unknown[]) => mockResolveAuthorizedWorkspace(...args),
}));

vi.mock('@/lib/services/dashboard-service', () => ({
  getDashboardSummary: (...args: unknown[]) => mockGetDashboardSummary(...args),
}));

vi.mock('@/lib/auth/actions', () => ({
  signOutAction: vi.fn(),
}));

vi.mock('@/components/layout/AppNavigation', () => ({
  AppNavigation: () => React.createElement('nav', { 'data-testid': 'app-nav' }),
}));

describe('DashboardPage Server Component (Operational Command Center)', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const mockNotif: NotificationRow = {
    id: 'notif-1',
    recipient_id: 'usr-1',
    workspace_id: 'ws-1',
    title: 'Task Overdue Alert',
    message: 'Fix payment webhook bug is overdue.',
    entity_type: 'task',
    entity_id: 'task-1',
    channel: 'in_app',
    status: 'delivered',
    scheduled_for: '2026-10-30T00:30:00Z',
    delivered_at: '2026-10-30T00:30:05Z',
    read_at: null,
    idempotency_key: null,
    created_at: '2026-10-30T00:30:00Z',
  };

  const samplePopulatedSummary: DashboardSummary = {
    workspaceId: 'ws-1',
    userId: 'usr-1',
    referenceTime: '2026-10-30T10:00:00.000Z',
    timeZone: 'America/New_York',
    tasks: {
      overdueCount: 3,
      dueTodayCount: 2,
      pendingSubtasksCount: 4,
      blockedCount: 1,
      urgentTasks: [
        {
          id: 'task-1',
          title: 'Fix payment webhook bug',
          priority: 'urgent',
          status: 'in_progress',
          due_date: '2026-10-29T12:00:00Z',
          project_id: 'p-1',
        },
        {
          id: 'task-2',
          title: 'Submit Q4 financial report',
          priority: 'high',
          status: 'todo',
          due_date: '2026-10-30T17:00:00Z',
          project_id: 'p-2',
        },
      ],
    },
    content: {
      draftCount: 5,
      ideaCount: 2,
      scheduledNext7DaysCount: 8,
      scheduledNext24HoursCount: 1,
      byPlatform: {
        linkedin: 3,
        reddit: 1,
        threads: 2,
        x: 2,
      },
      upcomingItems: [
        {
          id: 'content-1',
          title: 'Feature announcement thread',
          platform: 'x',
          action_type: 'post',
          status: 'scheduled',
          scheduled_at: '2026-10-30T14:00:00Z',
        },
        {
          id: 'content-2',
          title: 'Engineering blog deep dive',
          platform: 'linkedin',
          action_type: 'post',
          status: 'scheduled',
          scheduled_at: '2026-10-31T09:00:00Z',
        },
      ],
    },
    notifications: {
      unreadCount: 6,
      recentUnread: [mockNotif],
    },
  };

  const sampleEmptySummary: DashboardSummary = {
    workspaceId: 'ws-empty',
    userId: 'usr-empty',
    referenceTime: '2026-10-30T10:00:00.000Z',
    timeZone: 'Africa/Cairo',
    tasks: {
      overdueCount: 0,
      dueTodayCount: 0,
      pendingSubtasksCount: 0,
      blockedCount: 0,
      urgentTasks: [],
    },
    content: {
      draftCount: 0,
      ideaCount: 0,
      scheduledNext7DaysCount: 0,
      scheduledNext24HoursCount: 0,
      byPlatform: {
        linkedin: 0,
        reddit: 0,
        threads: 0,
        x: 0,
      },
      upcomingItems: [],
    },
    notifications: {
      unreadCount: 0,
      recentUnread: [],
    },
  };

  const createFluentQuery = (data: unknown) => {
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      limit: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data })),
    };
    return query;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnection.mockResolvedValue(undefined);
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'example-anon-key';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  });

  it('calls await connection() before requesting auth session or database queries', async () => {
    const callOrder: string[] = [];
    mockConnection.mockImplementationOnce(async () => {
      callOrder.push('connection');
    });
    mockGetUser.mockImplementationOnce(async () => {
      callOrder.push('getUser');
      return { data: { user: null } };
    });

    await expect(DashboardPage()).rejects.toThrow('NEXT_REDIRECT: /auth/sign-in?redirectTo=/dashboard');
    expect(callOrder).toEqual(['connection', 'getUser']);
    expect(mockConnection).toHaveBeenCalledTimes(1);
  });

  it('redirects unauthenticated users to /auth/sign-in?redirectTo=/dashboard at request time', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    await expect(DashboardPage()).rejects.toThrow('NEXT_REDIRECT: /auth/sign-in?redirectTo=/dashboard');
    expect(mockRedirect).toHaveBeenCalledWith('/auth/sign-in?redirectTo=/dashboard');
  });

  it('renders fallback notice when user has no active workspace membership', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'usr-no-ws', email: 'noworkspace@example.com' } },
    });
    mockResolveAuthorizedWorkspace.mockResolvedValueOnce({
      workspaceId: null,
      error: 'User usr-no-ws does not belong to any workspace',
    });

    const pageElement = await DashboardPage();
    const html = renderToStaticMarkup(pageElement);

    expect(html).toContain('No Active Workspace Found');
    expect(html).toContain('Please create or join a workspace');
    expect(mockGetDashboardSummary).not.toHaveBeenCalled();
  });

  it('renders populated operational command center dashboard with all KPI cards and widgets', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'usr-1', email: 'owner@example.com' } },
    });
    mockResolveAuthorizedWorkspace.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'owner',
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return createFluentQuery({ id: 'usr-1', full_name: 'Owner User', timezone: 'America/New_York' });
      }
      if (table === 'workspaces') {
        return createFluentQuery({ id: 'ws-1', name: 'Command Center Core', slug: 'command-center-core' });
      }
      if (table === 'workspace_members') {
        return createFluentQuery({ role: 'owner' });
      }
      return createFluentQuery(null);
    });

    mockGetDashboardSummary.mockResolvedValueOnce(samplePopulatedSummary);

    const pageElement = await DashboardPage();
    const html = renderToStaticMarkup(pageElement);

    // 1. Connection called
    expect(mockConnection).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();

    // 2. Service called with proper workspace & user IDs
    expect(mockGetDashboardSummary).toHaveBeenCalledWith(expect.anything(), 'ws-1', 'usr-1');

    // 3. Workspace identity, user role, and attention summary header
    expect(html).toContain('Workspace: Command Center Core');
    expect(html).toContain('Owner User');
    expect(html).toContain('Role: owner');
    expect(html).toContain('Attention required: 3 overdue tasks, 2 tasks due today, 1 post scheduled within 24h.');

    // 4. Quick Action Shortcuts
    expect(html).toContain('href="/tasks"');
    expect(html).toContain('New Task');
    expect(html).toContain('href="/content"');
    expect(html).toContain('New Content');
    expect(html).toContain('href="/calendar"');

    // 5. Seven KPI Cards with counts
    expect(html).toContain('Overdue Tasks');
    expect(html).toContain('3');
    expect(html).toContain('Due Today');
    expect(html).toContain('2');
    expect(html).toContain('Pending Subtasks');
    expect(html).toContain('4');
    expect(html).toContain('Blocked Tasks');
    expect(html).toContain('href="/tasks?status=blocked"');
    expect(html).toContain('1');
    expect(html).toContain('Draft Content');
    expect(html).toContain('5');
    expect(html).toContain('Scheduled (7d)');
    expect(html).toContain('8');
    expect(html).toContain('Unread Alerts');
    expect(html).toContain('6');

    // 6. Action Needed (Urgent Queue)
    expect(html).toContain('Action Needed');
    expect(html).toContain('Fix payment webhook bug');
    expect(html).toContain('Submit Q4 financial report');
    expect(html).toContain('Feature announcement thread');

    // 7. Content Pipeline & Platform Distribution
    expect(html).toContain('Content Pipeline &amp; Scheduling');
    expect(html).toContain('LinkedIn');
    expect(html).toContain('Reddit');
    expect(html).toContain('Threads');
    expect(html).toContain('X (Twitter)');
    expect(html).toContain('Engineering blog deep dive');

    // 8. Recent Notifications Feed
    expect(html).toContain('Recent Unread Alerts');
    expect(html).toContain('Task Overdue Alert');
    expect(html).toContain('Fix payment webhook bug is overdue.');
  });

  it('renders clean empty workspace gracefully with zero counts and empty state messages', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'usr-empty', email: 'empty@example.com' } },
    });
    mockResolveAuthorizedWorkspace.mockResolvedValueOnce({
      workspaceId: 'ws-empty',
      role: 'member',
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return createFluentQuery(null); // Fallback to email
      }
      if (table === 'workspaces') {
        return createFluentQuery({ id: 'ws-empty', name: 'Fresh Workspace', slug: 'fresh' });
      }
      if (table === 'workspace_members') {
        return createFluentQuery({ role: 'member' });
      }
      return createFluentQuery(null);
    });

    mockGetDashboardSummary.mockResolvedValueOnce(sampleEmptySummary);

    const pageElement = await DashboardPage();
    const html = renderToStaticMarkup(pageElement);

    // Dynamic header on track message
    expect(html).toContain('Workspace active. All tasks and content schedules are on track.');

    // Profile fallback to email
    expect(html).toContain('empty@example.com');
    expect(html).toContain('Role: member');

    // KPI Cards with 0
    expect(html).toContain('Overdue Tasks');
    expect(html).toContain('Due Today');
    expect(html).toContain('Pending Subtasks');
    expect(html).toContain('Blocked Tasks');
    expect(html).toContain('Draft Content');
    expect(html).toContain('Scheduled (7d)');
    expect(html).toContain('Unread Alerts');

    // Empty state messages in widgets
    expect(html).toContain('All clear');
    expect(html).toContain('No overdue tasks, tasks due today, or content scheduled in the next 24 hours.');
    expect(html).toContain('No content currently scheduled');
    expect(html).toContain('All caught up');
    expect(html).toContain('You have no unread notifications in this workspace.');
  });

  it('renders database service error banner gracefully when getDashboardSummary fails', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'usr-err', email: 'error@example.com' } },
    });
    mockResolveAuthorizedWorkspace.mockResolvedValueOnce({
      workspaceId: 'ws-err',
      role: 'owner',
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return createFluentQuery({ id: 'usr-err', full_name: 'Admin', timezone: 'UTC' });
      }
      if (table === 'workspaces') {
        return createFluentQuery({ id: 'ws-err', name: 'Error WS', slug: 'error-ws' });
      }
      if (table === 'workspace_members') {
        return createFluentQuery({ role: 'owner' });
      }
      return createFluentQuery(null);
    });

    mockGetDashboardSummary.mockRejectedValueOnce(new Error('PostgreSQL connection timeout'));

    const pageElement = await DashboardPage();
    const html = renderToStaticMarkup(pageElement);

    // Page should still render without throwing
    expect(html).toContain('Operational Command Center');
    expect(html).toContain('Failed to load workspace metrics');
    expect(html).toContain('PostgreSQL connection timeout');

    // Should NOT render KPI cards grid or widgets when summary is null
    expect(html).not.toContain('Overdue Tasks');
    expect(html).not.toContain('Action Needed');
  });
});
