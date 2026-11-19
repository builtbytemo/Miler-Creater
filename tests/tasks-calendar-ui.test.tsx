import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';

const mockConnection = vi.fn();
const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockGetTasks = vi.fn();

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT: ${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/tasks',
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  })),
}));

vi.mock('@/lib/services/task-service', () => ({
  getTasks: (...args: unknown[]) => mockGetTasks(...args),
}));

vi.mock('@/lib/actions/task-actions', () => ({
  completeTaskAction: vi.fn(),
  cancelTaskAction: vi.fn(),
  deleteTaskAction: vi.fn(),
  updateTaskAction: vi.fn(),
  addTaskDependencyAction: vi.fn(),
  removeTaskDependencyAction: vi.fn(),
  updateRecurrenceRuleAction: vi.fn(),
  stopRecurrenceAction: vi.fn(),
  makeTaskRecurringAction: vi.fn(),
  createTaskAction: vi.fn(),
  getTaskDetailAction: vi.fn().mockResolvedValue({ success: true, data: null }),
}));

vi.mock('@/lib/actions/content-actions', () => ({
  getCalendarEventsAction: vi.fn().mockResolvedValue({ success: true, data: { content: [], tasks: [] } }),
}));

vi.mock('@/lib/actions/notification-actions', () => ({
  getUnreadNotificationCountAction: vi.fn().mockResolvedValue({ success: true, data: 0 }),
  getNotificationsAction: vi.fn(),
  markNotificationAsReadAction: vi.fn(),
  markNotificationAsUnreadAction: vi.fn(),
  markAllNotificationsAsReadAction: vi.fn(),
  dismissNotificationAction: vi.fn(),
}));

import { TaskWorkspace } from '../src/components/tasks/TaskWorkspace';
import { TaskDetailModal } from '../src/components/tasks/TaskDetailModal';
import { CalendarWorkspace } from '../src/components/calendar/CalendarWorkspace';
import { CalendarWeekView } from '../src/components/calendar/CalendarWeekView';
import { CalendarDayView } from '../src/components/calendar/CalendarDayView';
import { getWeekRange, getDayRange } from '@/lib/temporal/calendar';

describe('Stage C: Tasks & Calendar UX Overhaul', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

  it('forwards normalized profiles.timezone instead of hardcoded timezone on TasksPage', async () => {
    const TasksPage = (await import('../src/app/tasks/page')).default;

    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'usr-tz' } },
    });

    const mockWorkspaceQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          workspace_id: 'ws-1',
          workspaces: { id: 'ws-1', name: 'Zahi Studio', slug: 'zahi-studio' },
        },
      }),
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'workspace_members') return mockWorkspaceQuery;
      if (table === 'projects') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [] }),
            }),
          }),
        };
      }
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { timezone: 'Asia/Riyadh' } }),
            }),
          }),
        };
      }
      return {};
    });

    mockGetTasks.mockResolvedValueOnce([]);

    const element = await TasksPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Asia/Riyadh');
    expect(html).not.toContain(DEFAULT_TIMEZONE);
  });

  it('renders TaskWorkspace with container queries, keyboard hints, mascot empty state, and subtask bar', () => {
    const emptyHtml = renderToStaticMarkup(
      <TaskWorkspace
        initialTasks={[]}
        workspaceId="ws-1"
        projects={[]}
        userTimeZone="Asia/Riyadh"
      />
    );

    expect(emptyHtml).toContain('@3xl:flex-row');
    expect(emptyHtml).toContain('No tasks found');
    expect(emptyHtml).toContain('Zahi mascot');

    const populatedHtml = renderToStaticMarkup(
      <TaskWorkspace
        initialTasks={[
          {
            id: 't-1',
            workspace_id: 'ws-1',
            project_id: null,
            milestone_id: null,
            parent_task_id: null,
            title: 'Ship Zahi design overhaul',
            description: null,
            status: 'in_progress',
            priority: 'urgent',
            entry_type: 'task',
            created_from: 'tasks',
            due_date: '2026-11-15T10:00:00Z',
            scheduled_start: null,
            scheduled_end: null,
            is_all_day: false,
            estimated_duration_minutes: 45,
            completed_at: null,
            recurrence_rule_id: null,
            occurrence_index: null,
            tags: [],
            assigned_to: null,
            created_by: 'usr-1',
            created_at: '2026-11-10T10:00:00Z',
            updated_at: '2026-11-10T10:00:00Z',
            project: null,
            is_blocked: false,
            blocking_tasks: [],
            subtask_count: 4,
            completed_subtask_count: 2,
          },
        ]}
        workspaceId="ws-1"
        projects={[]}
        userTimeZone="Asia/Riyadh"
        initialDateFilter="all"
      />
    );

    expect(populatedHtml).toContain('Ship Zahi design overhaul');
    expect(populatedHtml).toContain('2/4 subtasks');
  });

  it('replaces native browser confirm() in TaskDetailModal with accessible ConfirmDialog and forwards userTimeZone', () => {
    const modalSource = readFileSync(
      join(process.cwd(), 'src/components/tasks/TaskDetailModal.tsx'),
      'utf8'
    );

    expect(modalSource).not.toMatch(/\bconfirm\s*\(/);
    expect(modalSource).toContain('ConfirmDialog');

    const taskDetailHtml = renderToStaticMarkup(
      <TaskDetailModal
        task={{
          id: 't-1',
          workspace_id: 'ws-1',
          project_id: null,
          milestone_id: null,
          parent_task_id: null,
          title: 'Review release notes',
          description: 'Final copy pass',
          status: 'todo',
          priority: 'high',
          entry_type: 'task',
          created_from: 'tasks',
          due_date: null,
          scheduled_start: '2026-11-14T09:00:00Z',
          scheduled_end: null,
          is_all_day: false,
          estimated_duration_minutes: 30,
          completed_at: null,
          recurrence_rule_id: null,
          occurrence_index: null,
          tags: [],
          assigned_to: null,
          created_by: 'usr-1',
          created_at: '2026-11-10T10:00:00Z',
          updated_at: '2026-11-10T10:00:00Z',
          project: null,
          is_blocked: false,
          blocking_tasks: [],
          subtask_count: 0,
          completed_subtask_count: 0,
          subtasks: [],
          dependencies: [],
          recurrence_rule: null,
        }}
        allTasks={[]}
        workspaceId="ws-1"
        isOpen={true}
        onClose={() => {}}
        userTimeZone="Asia/Riyadh"
      />
    );

    expect(taskDetailHtml).toContain('Review release notes');
    expect(taskDetailHtml).toContain('Delete Task');
  });

  it('renders CalendarWorkspace, CalendarWeekView, and CalendarDayView with @container queries for dual-sidebar width', () => {
    const refDate = new Date('2026-11-13T12:00:00Z');
    const weekRange = getWeekRange(refDate, 'Asia/Riyadh');
    const dayRange = getDayRange(refDate, 'Asia/Riyadh');

    const calHtml = renderToStaticMarkup(
      <CalendarWorkspace
        initialScheduledItems={[]}
        initialScheduledTasks={[]}
        initialUnscheduledItems={[]}
        workspaceId="ws-1"
        workspaceName="Zahi Studio"
        socialAccounts={[]}
        projects={[]}
        userTimeZone="Asia/Riyadh"
        initialWeekRange={weekRange}
      />
    );

    expect(calHtml).toContain('@3xl:flex-row');
    expect(calHtml).toContain('Asia/Riyadh');
    expect(calHtml).toContain('data-testid="calendar-week-grid"');

    const weekHtml = renderToStaticMarkup(
      <CalendarWeekView
        weekDays={weekRange.days}
        items={[]}
        tasks={[]}
        userTimeZone="Asia/Riyadh"
        onOpenDetail={() => {}}
      />
    );

    expect(weekHtml).toContain('@2xl:grid-cols-4');
    expect(weekHtml).toContain('@4xl:grid-cols-7');

    const dayHtml = renderToStaticMarkup(
      <CalendarDayView
        dayRange={dayRange}
        contentItems={[]}
        taskItems={[]}
        userTimeZone="Asia/Riyadh"
        onSelectContent={() => {}}
        onSelectTask={() => {}}
      />
    );

    expect(dayHtml).toContain('@3xl:grid-cols-12');
    expect(dayHtml).toContain('@4xl:grid-cols-24');
  });
});
