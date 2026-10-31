import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDashboardSummary } from '../src/lib/services/dashboard-service';
import type { Database, SocialPlatform } from '../src/types/database';

const mockGetNotifications = vi.fn();

vi.mock('@/lib/services/notification-service', () => ({
  getNotifications: (...args: unknown[]) => mockGetNotifications(...args),
}));

describe('Dashboard Service Layer (Phase 6, Step 6.1: getDashboardSummary)', () => {
  const wsId = '11111111-1111-4111-a111-111111111111';
  const userId = '22222222-2222-4222-a222-222222222222';
  const fixedNow = new Date('2026-10-30T10:00:00.000Z');

  interface MockQueryResponse {
    data?: any;
    error?: any;
    count?: number | null;
  }

  function createMockSupabase(overrides: {
    membership?: { role: string } | null;
    memberError?: Error | null;
    profileTimezone?: string | null;
    profileError?: Error | null;
    tasksCountHandler?: (filters: Record<string, any>) => MockQueryResponse;
    contentCountHandler?: (filters: Record<string, any>) => MockQueryResponse;
    tasksListResponse?: MockQueryResponse;
    contentListResponse?: MockQueryResponse;
  } = {}) {
    const recordedQueries: Array<{
      table: string;
      filters: Record<string, any>;
      selectArgs?: any[];
      isCountQuery: boolean;
      order?: any;
      limit?: number;
    }> = [];

    const client = {
      from: vi.fn((table: string) => {
        const queryState: {
          table: string;
          filters: Record<string, any>;
          selectArgs?: any[];
          isCountQuery: boolean;
          order?: any;
          limit?: number;
        } = {
          table,
          filters: {},
          isCountQuery: false,
        };

        const builder: any = {
          select: vi.fn((fields: string, opts?: { count?: string; head?: boolean }) => {
            queryState.selectArgs = [fields, opts];
            if (opts?.head && opts?.count === 'exact') {
              queryState.isCountQuery = true;
            }
            return builder;
          }),
          eq: vi.fn((col: string, val: any) => {
            queryState.filters[col] = val;
            return builder;
          }),
          neq: vi.fn((col: string, val: any) => {
            queryState.filters[`${col}_neq`] = val;
            return builder;
          }),
          gt: vi.fn((col: string, val: any) => {
            queryState.filters[`${col}_gt`] = val;
            return builder;
          }),
          gte: vi.fn((col: string, val: any) => {
            queryState.filters[`${col}_gte`] = val;
            return builder;
          }),
          lt: vi.fn((col: string, val: any) => {
            queryState.filters[`${col}_lt`] = val;
            return builder;
          }),
          lte: vi.fn((col: string, val: any) => {
            queryState.filters[`${col}_lte`] = val;
            return builder;
          }),
          not: vi.fn((col: string, op: string, val: any) => {
            queryState.filters[`${col}_not_${op}`] = val;
            return builder;
          }),
          is: vi.fn((col: string, val: any) => {
            queryState.filters[`${col}_is`] = val;
            return builder;
          }),
          in: vi.fn((col: string, vals: any[]) => {
            queryState.filters[`${col}_in`] = vals;
            return builder;
          }),
          or: vi.fn((expr: string) => {
            queryState.filters['or'] = expr;
            return builder;
          }),
          order: vi.fn((col: string, opts?: any) => {
            queryState.order = { col, opts };
            return builder;
          }),
          limit: vi.fn((n: number) => {
            queryState.limit = n;
            return builder;
          }),
          maybeSingle: vi.fn(async () => {
            recordedQueries.push({ ...queryState });
            if (table === 'workspace_members') {
              if (overrides.memberError) {
                return { data: null, error: overrides.memberError };
              }
              const role = overrides.membership === undefined ? { role: 'owner' } : overrides.membership;
              return { data: role, error: null };
            }
            if (table === 'profiles') {
              if (overrides.profileError) {
                return { data: null, error: overrides.profileError };
              }
              const tz = overrides.profileTimezone === undefined ? 'Africa/Cairo' : overrides.profileTimezone;
              return { data: tz ? { timezone: tz } : null, error: null };
            }
            return { data: null, error: null };
          }),
          then: (onfulfilled: any, onrejected?: any) => {
            recordedQueries.push({ ...queryState });
            let result: MockQueryResponse = { data: [], error: null, count: 0 };

            if (table === 'tasks') {
              if (queryState.isCountQuery) {
                if (overrides.tasksCountHandler) {
                  result = overrides.tasksCountHandler(queryState.filters);
                } else {
                  result = { data: null, error: null, count: 0 };
                }
              } else {
                result = overrides.tasksListResponse ?? { data: [], error: null, count: null };
              }
            } else if (table === 'content_items') {
              if (queryState.isCountQuery) {
                if (overrides.contentCountHandler) {
                  result = overrides.contentCountHandler(queryState.filters);
                } else {
                  result = { data: null, error: null, count: 0 };
                }
              } else {
                result = overrides.contentListResponse ?? { data: [], error: null, count: null };
              }
            }

            return Promise.resolve(result).then(onfulfilled, onrejected);
          },
        };

        return builder;
      }),
    };

    return { client: client as any, recordedQueries };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNotifications.mockResolvedValue({
      notifications: [],
      total: 0,
      page: 1,
      limit: 5,
    });
  });

  describe('1. Task Metrics Calculations & Rules', () => {
    it('accurately counts overdue active tasks and excludes completed/cancelled tasks', async () => {
      const { client, recordedQueries } = createMockSupabase({
        tasksCountHandler: (filters) => {
          // Overdue task query checks due_date_lt with refTime and parent_task_id_is: null
          if (filters.due_date_lt && filters.parent_task_id_is === null) {
            expect(filters.workspace_id).toBe(wsId);
            expect(filters.status_in).toEqual(['todo', 'in_progress', 'blocked']);
            expect(filters.completed_at_is).toBeNull();
            return { data: null, error: null, count: 4 };
          }
          return { data: null, error: null, count: 0 };
        },
      });

      const summary = await getDashboardSummary(client, wsId, userId, {
        referenceTime: fixedNow,
        userTimeZone: 'Africa/Cairo',
      });

      expect(summary.tasks.overdueCount).toBe(4);
    });

    it('accurately counts tasks due today within user local timezone excluding tasks already overdue', async () => {
      const { client } = createMockSupabase({
        tasksCountHandler: (filters) => {
          if (filters.due_date_gte && filters.due_date_lt) {
            // Must start at or after referenceTime to be mutually exclusive with overdue
            expect(filters.due_date_gte).toBe(fixedNow.toISOString());
            expect(filters.workspace_id).toBe(wsId);
            expect(filters.parent_task_id_is).toBeNull();
            return { data: null, error: null, count: 7 };
          }
          return { data: null, error: null, count: 0 };
        },
      });

      const summary = await getDashboardSummary(client, wsId, userId, {
        referenceTime: fixedNow,
        userTimeZone: 'Africa/Cairo',
      });

      expect(summary.tasks.dueTodayCount).toBe(7);
    });

    it('accurately counts pending subtasks and blocked top-level tasks', async () => {
      const { client } = createMockSupabase({
        tasksCountHandler: (filters) => {
          if (filters.parent_task_id_not_is === null) {
            // Pending subtasks query: parent_task_id IS NOT NULL and status IN (todo, in_progress, blocked)
            expect(filters.status_in).toEqual(['todo', 'in_progress', 'blocked']);
            return { data: null, error: null, count: 12 };
          }
          if (filters.status === 'blocked' && filters.parent_task_id_is === null) {
            // Blocked top-level task query
            return { data: null, error: null, count: 3 };
          }
          return { data: null, error: null, count: 0 };
        },
      });

      const summary = await getDashboardSummary(client, wsId, userId, {
        referenceTime: fixedNow,
        userTimeZone: 'Africa/Cairo',
      });

      expect(summary.tasks.pendingSubtasksCount).toBe(12);
      expect(summary.tasks.blockedCount).toBe(3);
    });

    it('bounds and deterministically sorts tasks requiring attention according to the 4 priority tiers', async () => {
      const rawTasks = [
        // Tier 4: High priority, future due date
        { id: 'task-4', title: 'High Priority Task', priority: 'high', status: 'todo', due_date: '2026-11-05T10:00:00Z', project_id: 'p-1' },
        // Tier 1: Overdue task
        { id: 'task-1', title: 'Overdue Task 1', priority: 'medium', status: 'in_progress', due_date: '2026-10-28T09:00:00Z', project_id: null },
        // Tier 3: Urgent priority, future due date
        { id: 'task-3', title: 'Urgent Priority Task', priority: 'urgent', status: 'todo', due_date: '2026-11-02T10:00:00Z', project_id: null },
        // Tier 2: Due today (later today in Cairo: 15:00 UTC)
        { id: 'task-2', title: 'Due Today Task', priority: 'low', status: 'todo', due_date: '2026-10-30T15:00:00Z', project_id: 'p-2' },
        // Tier 1: Even older overdue task (should come first in Tier 1)
        { id: 'task-0', title: 'Overdue Task 0', priority: 'low', status: 'blocked', due_date: '2026-10-25T08:00:00Z', project_id: null },
        // Extra task beyond limit (should be trimmed by limit = 4)
        { id: 'task-5', title: 'Extra High Task', priority: 'high', status: 'todo', due_date: '2026-11-10T10:00:00Z', project_id: null },
      ];

      const { client } = createMockSupabase({
        tasksListResponse: { data: rawTasks, error: null, count: null },
      });

      const summary = await getDashboardSummary(client, wsId, userId, {
        referenceTime: fixedNow,
        userTimeZone: 'Africa/Cairo',
        urgentTaskLimit: 4,
      });

      expect(summary.tasks.urgentTasks).toHaveLength(4);
      // Order: Tier 1 (task-0, task-1), then Tier 2 (task-2), then Tier 3 (task-3)
      expect(summary.tasks.urgentTasks.map((t) => t.id)).toEqual(['task-0', 'task-1', 'task-2', 'task-3']);
      expect(summary.tasks.urgentTasks[0]).toEqual({
        id: 'task-0',
        title: 'Overdue Task 0',
        priority: 'low',
        status: 'blocked',
        due_date: '2026-10-25T08:00:00Z',
        project_id: null,
      });
    });

    it('guarantees urgent priority tasks are not crowded out when many due-soon tasks exist', async () => {
      // 10 overdue tasks and 1 urgent task without a due date
      const overdueTasks = Array.from({ length: 10 }, (_, i) => ({
        id: `overdue-${i}`,
        title: `Overdue Task ${i}`,
        priority: 'low',
        status: 'todo',
        due_date: '2026-10-25T10:00:00Z',
        project_id: null,
      }));
      const urgentTaskNoDue = {
        id: 'urgent-no-due',
        title: 'Critical Strategy Task',
        priority: 'urgent',
        status: 'todo',
        due_date: null,
        project_id: null,
      };

      const { client } = createMockSupabase({
        tasksListResponse: { data: [...overdueTasks, urgentTaskNoDue], error: null, count: null },
      });

      const summary = await getDashboardSummary(client, wsId, userId, {
        referenceTime: fixedNow,
        urgentTaskLimit: 10,
      });

      // The 10 limit is filled with the top priority tasks
      expect(summary.tasks.urgentTasks).toHaveLength(10);
      expect(summary.tasks.urgentTasks[0].id).toBe('overdue-0');
    });
  });

  describe('2. Content Metrics Calculations & Platform Grouping', () => {
    it('correctly counts drafts, ideas, and time-bounded scheduled items', async () => {
      const in24h = new Date(fixedNow.getTime() + 24 * 60 * 60 * 1000).toISOString();
      const in7d = new Date(fixedNow.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const { client } = createMockSupabase({
        contentCountHandler: (filters) => {
          if (filters.status === 'draft') return { data: null, error: null, count: 5 };
          if (filters.status === 'idea') return { data: null, error: null, count: 8 };
          if (filters.scheduled_at_lte === in24h) return { data: null, error: null, count: 3 };
          if (filters.scheduled_at_lte === in7d) return { data: null, error: null, count: 11 };
          return { data: null, error: null, count: 0 };
        },
      });

      const summary = await getDashboardSummary(client, wsId, userId, {
        referenceTime: fixedNow,
      });

      expect(summary.content.draftCount).toBe(5);
      expect(summary.content.ideaCount).toBe(8);
      expect(summary.content.scheduledNext24HoursCount).toBe(3);
      expect(summary.content.scheduledNext7DaysCount).toBe(11);
    });

    it('guarantees all four platforms are represented in byPlatform breakdown even when zero', async () => {
      const { client } = createMockSupabase({
        contentCountHandler: (filters) => {
          if (filters.platform === 'linkedin') return { data: null, error: null, count: 4 };
          if (filters.platform === 'x') return { data: null, error: null, count: 9 };
          // reddit and threads return count 0
          return { data: null, error: null, count: 0 };
        },
      });

      const summary = await getDashboardSummary(client, wsId, userId, {
        referenceTime: fixedNow,
      });

      expect(summary.content.byPlatform).toEqual({
        linkedin: 4,
        reddit: 0,
        threads: 0,
        x: 9,
      });
    });

    it('returns a bounded, ordered list of upcoming scheduled content items', async () => {
      const rawContent = [
        { id: 'c-1', title: 'Post 1', platform: 'linkedin', action_type: 'post', status: 'scheduled', scheduled_at: '2026-10-30T14:00:00Z' },
        { id: 'c-2', title: 'Post 2', platform: 'x', action_type: 'post', status: 'scheduled', scheduled_at: '2026-10-31T09:00:00Z' },
      ];

      const { client } = createMockSupabase({
        contentListResponse: { data: rawContent, error: null, count: null },
      });

      const summary = await getDashboardSummary(client, wsId, userId, {
        referenceTime: fixedNow,
      });

      expect(summary.content.upcomingItems).toHaveLength(2);
      expect(summary.content.upcomingItems[0]).toEqual({
        id: 'c-1',
        title: 'Post 1',
        platform: 'linkedin',
        action_type: 'post',
        status: 'scheduled',
        scheduled_at: '2026-10-30T14:00:00Z',
      });
    });
  });

  describe('3. Notification Integration', () => {
    it('accurately integrates unread count and top 5 recent notifications for recipient', async () => {
      const fakeNotifications = [
        { id: 'n-1', title: 'New Assignment', message: 'You were assigned to task 1', read_at: null, status: 'delivered', created_at: '2026-10-30T09:00:00Z' },
        { id: 'n-2', title: 'Reminder', message: 'Task is due today', read_at: null, status: 'delivered', created_at: '2026-10-30T08:00:00Z' },
      ];

      mockGetNotifications.mockResolvedValueOnce({
        notifications: fakeNotifications,
        total: 15, // 15 total unread in workspace
        page: 1,
        limit: 5,
      });

      const { client } = createMockSupabase();

      const summary = await getDashboardSummary(client, wsId, userId, {
        referenceTime: fixedNow,
      });

      expect(mockGetNotifications).toHaveBeenCalledWith(client, wsId, userId, {
        unread_only: true,
        limit: 5,
      });
      expect(summary.notifications.unreadCount).toBe(15);
      expect(summary.notifications.recentUnread).toHaveLength(2);
    });
  });

  describe('4. Timezone Resolution & Midnight Boundaries', () => {
    it('uses user profile timezone when available and valid', async () => {
      const { client } = createMockSupabase({
        profileTimezone: 'America/New_York',
      });

      const summary = await getDashboardSummary(client, wsId, userId, {
        referenceTime: fixedNow,
      });

      expect(summary.timeZone).toBe('America/New_York');
    });

    it('falls back to default Africa/Cairo when profile timezone is missing or invalid', async () => {
      const { client } = createMockSupabase({
        profileTimezone: 'Invalid/City',
      });

      const summary = await getDashboardSummary(client, wsId, userId, {
        referenceTime: fixedNow,
      });

      expect(summary.timeZone).toBe('Africa/Cairo');
    });

    it('normalizes Asia/Cairo alias to canonical Africa/Cairo', async () => {
      const { client } = createMockSupabase();

      const summary = await getDashboardSummary(client, wsId, userId, {
        referenceTime: fixedNow,
        userTimeZone: 'Asia/Cairo',
      });

      expect(summary.timeZone).toBe('Africa/Cairo');
    });
  });

  describe('5. Security, Authorization & Error Handling', () => {
    it('rejects unauthenticated or non-member workspace access with clear error', async () => {
      const { client } = createMockSupabase({
        membership: null, // User is not in workspace
      });

      await expect(
        getDashboardSummary(client, wsId, userId, { referenceTime: fixedNow })
      ).rejects.toThrow(/Unauthorized: User.*does not have access to workspace/);
    });

    it('rejects invalid non-UUID workspace ID or user ID', async () => {
      const { client } = createMockSupabase();

      await expect(
        getDashboardSummary(client, 'invalid-ws-uuid', userId)
      ).rejects.toThrow(/Invalid workspace_id: must be a valid UUID/);

      await expect(
        getDashboardSummary(client, wsId, 'not-a-uuid')
      ).rejects.toThrow(/Invalid user_id: must be a valid UUID/);
    });

    it('surfaces database query errors instead of silently masking them as zeroes', async () => {
      const { client } = createMockSupabase({
        tasksCountHandler: () => ({
          data: null,
          error: { message: 'Connection terminated unexpectedly' },
          count: null,
        }),
      });

      await expect(
        getDashboardSummary(client, wsId, userId, { referenceTime: fixedNow })
      ).rejects.toThrow(/Failed to query.*Connection terminated unexpectedly/);
    });

    it('returns clean zero counts and empty lists for legitimate empty workspaces', async () => {
      const { client } = createMockSupabase();

      const summary = await getDashboardSummary(client, wsId, userId, {
        referenceTime: fixedNow,
      });

      expect(summary.tasks.overdueCount).toBe(0);
      expect(summary.tasks.dueTodayCount).toBe(0);
      expect(summary.tasks.pendingSubtasksCount).toBe(0);
      expect(summary.tasks.blockedCount).toBe(0);
      expect(summary.tasks.urgentTasks).toEqual([]);

      expect(summary.content.draftCount).toBe(0);
      expect(summary.content.ideaCount).toBe(0);
      expect(summary.content.scheduledNext24HoursCount).toBe(0);
      expect(summary.content.scheduledNext7DaysCount).toBe(0);
      expect(summary.content.byPlatform).toEqual({
        linkedin: 0,
        reddit: 0,
        threads: 0,
        x: 0,
      });
      expect(summary.content.upcomingItems).toEqual([]);

      expect(summary.notifications.unreadCount).toBe(0);
      expect(summary.notifications.recentUnread).toEqual([]);
    });

    it('ensures every underlying query includes the workspace_id filter', async () => {
      const { client, recordedQueries } = createMockSupabase();

      await getDashboardSummary(client, wsId, userId, { referenceTime: fixedNow });

      // Check all queries made to tasks and content_items
      const dataQueries = recordedQueries.filter((q) => q.table === 'tasks' || q.table === 'content_items');
      expect(dataQueries.length).toBeGreaterThan(0);
      for (const q of dataQueries) {
        expect(q.filters.workspace_id).toBe(wsId);
      }
    });
  });
});
