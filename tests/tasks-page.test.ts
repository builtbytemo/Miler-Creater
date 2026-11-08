import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TasksPage from '../src/app/tasks/page';
import type { TaskDetail, TaskWithMeta } from '@/lib/services/task-service';

const mockConnection = vi.fn();
const mockRedirect = vi.fn();
const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockGetTasks = vi.fn();

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error(`NEXT_REDIRECT: ${url}`);
  },
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
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

vi.mock('@/components/layout/AppNavigation', () => ({
  AppNavigation: () => React.createElement('nav', { 'data-testid': 'app-nav' }),
}));

vi.mock('@/components/tasks/TaskWorkspace', () => ({
  TaskWorkspace: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'task-workspace', ...props }),
}));

describe('TasksPage Server Component (Next.js Cache Components & Prerendering)', () => {
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

  it('calls await connection() before requesting auth session or database queries', async () => {
    const mockWorkspaceQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          workspace_id: 'ws-1',
          workspaces: { id: 'ws-1', name: 'Main Workspace', slug: 'main' },
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
      if (table === 'workspace_members') return mockWorkspaceQuery;
      if (table === 'projects') return mockProjectsQuery;
      return {};
    });

    mockGetTasks.mockResolvedValueOnce([]);

    const order: string[] = [];
    mockConnection.mockImplementationOnce(async () => {
      order.push('connection');
    });
    mockGetUser.mockImplementationOnce(async () => {
      order.push('getUser');
      return { data: { user: { id: 'usr-123' } } };
    });

    await TasksPage({ searchParams: Promise.resolve({}) });

    expect(order).toEqual(['connection', 'getUser']);
    expect(mockConnection).toHaveBeenCalledTimes(1);
  });

  it('redirects unauthenticated users to sign-in with redirectTo=/tasks', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
    });

    await expect(
      TasksPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow('NEXT_REDIRECT: /auth/sign-in?redirectTo=/tasks');

    expect(mockConnection).toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith('/auth/sign-in?redirectTo=/tasks');
  });

  it('renders fallback when no workspace membership exists', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'usr-no-ws' } },
    });

    const mockWorkspaceQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    };

    mockFrom.mockReturnValue(mockWorkspaceQuery);

    const jsx = await TasksPage({ searchParams: Promise.resolve({}) });
    expect(jsx).toBeDefined();
    expect(mockGetTasks).not.toHaveBeenCalled();
  });

  it('fetches tasks and accurately computes stats without triggering unstable Date.now()', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'usr-123' } },
    });

    const mockWorkspaceQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          workspace_id: 'ws-1',
          workspaces: { id: 'ws-1', name: 'Main', slug: 'main' },
        },
      }),
    };

    const mockProjects = [{ id: 'p-1', name: 'Project Alpha', color: '#ff0000' }];
    mockFrom.mockImplementation((table: string) => {
      if (table === 'workspace_members') return mockWorkspaceQuery;
      if (table === 'projects') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: mockProjects }),
            }),
          }),
        };
      }
      return {};
    });

    const sampleTasks = [
      { id: 't-1', title: 'Task 1', status: 'in_progress', is_blocked: false, priority: 'high' },
      { id: 't-2', title: 'Task 2', status: 'blocked', is_blocked: true, priority: 'urgent' },
      { id: 't-3', title: 'Task 3', status: 'done', is_blocked: false, priority: 'low' },
      { id: 't-4', title: 'Task 4', status: 'todo', is_blocked: false, priority: 'medium' },
    ];
    mockGetTasks.mockResolvedValueOnce(sampleTasks);

    const dateNowSpy = vi.spyOn(Date, 'now');

    const jsx = await TasksPage({
      searchParams: Promise.resolve({
        status: 'todo',
        priority: 'urgent',
        project_id: 'p-1',
        search: 'Alpha',
      }),
    });

    expect(jsx).toBeDefined();
    expect(mockConnection).toHaveBeenCalledTimes(1);

    // Verify filter delegation to getTasks
    expect(mockGetTasks).toHaveBeenCalledWith(
      expect.anything(),
      'ws-1',
      expect.objectContaining({
        status: 'todo',
        priority: 'urgent',
        project_id: 'p-1',
        search: 'Alpha',
        parent_task_id: null,
      })
    );

    // Date.now() should not be invoked during page server rendering
    expect(dateNowSpy).not.toHaveBeenCalled();
    dateNowSpy.mockRestore();
  });

  it('renders redesigned TaskWorkspace, CreateTaskModal, and TaskDetailModal with long titles, descriptions, and subtasks', async () => {
    const { TaskWorkspace: RealTaskWorkspace } = await vi.importActual<
      typeof import('@/components/tasks/TaskWorkspace')
    >('@/components/tasks/TaskWorkspace');
    const { CreateTaskModal } = await import('@/components/tasks/CreateTaskModal');
    const { TaskDetailModal } = await import('@/components/tasks/TaskDetailModal');

    const longTitle =
      'Coordinate cross-functional Q4 launch readiness review across engineering, design, and editorial teams with full dependency verification';
    const sampleTask: TaskWithMeta = {
      id: 'task-long-1',
      workspace_id: 'ws-1',
      title: longTitle,
      description:
        'Detailed multi-paragraph launch checklist covering migration gates, OAuth verification, and social publishing windows.\nSecond line of notes.',
      priority: 'urgent',
      status: 'in_progress',
      scheduled_start: '2026-11-08T14:00:00.000Z',
      scheduled_end: '2026-11-08T15:00:00.000Z',
      due_date: '2026-11-09T16:00:00.000Z',
      is_all_day: false,
      estimated_duration_minutes: 60,
      project_id: 'proj-1',
      milestone_id: null,
      parent_task_id: null,
      tags: [],
      recurrence_rule_id: 'rec-1',
      created_by: 'usr-1',
      assigned_to: null,
      created_at: '2026-11-01T10:00:00.000Z',
      updated_at: '2026-11-08T10:00:00.000Z',
      completed_at: null,
      subtask_count: 6,
      completed_subtask_count: 2,
      is_blocked: true,
      blocking_tasks: [{ id: 'prereq-1', title: 'Finalize schema migration', status: 'in_progress' }],
      project: { id: 'proj-1', name: 'Core Platform Launch', color: '#121210' },
    };

    const workspaceHtml = renderToStaticMarkup(
      React.createElement(RealTaskWorkspace, {
        initialTasks: [sampleTask],
        workspaceId: 'ws-1',
        projects: [{ id: 'proj-1', name: 'Core Platform Launch', color: '#121210' }],
        userTimeZone: 'Africa/Cairo',
      })
    );

    // Hierarchy: Page title and New Task primary CTA, then search & filters, then task list
    expect(workspaceHtml).toContain('Tasks');
    expect(workspaceHtml).toContain('New Task');
    expect(workspaceHtml).toContain('aria-label="Search tasks"');
    expect(workspaceHtml).toContain('aria-label="Filter tasks by date"');
    expect(workspaceHtml).toContain('aria-label="Filter by priority"');
    expect(workspaceHtml).toContain('aria-label="Filter by project"');
    expect(workspaceHtml).toContain('aria-label="Sort tasks"');
    expect(workspaceHtml).toContain('1 tasks');
    expect(workspaceHtml).toContain(longTitle);
    expect(workspaceHtml).toContain('2/6 subtasks');
    expect(workspaceHtml).toContain('Blocked');
    expect(workspaceHtml).toContain('Recurring');

    // CreateTaskModal
    const createHtml = renderToStaticMarkup(
      React.createElement(CreateTaskModal, {
        workspaceId: 'ws-1',
        projects: [{ id: 'proj-1', name: 'Core Platform Launch', color: '#121210' }],
        isOpen: true,
        onClose: () => {},
      })
    );
    expect(createHtml).toContain('Create New Task');
    expect(createHtml).toContain('Schedule on Calendar');
    expect(createHtml).toContain('Recurrence Rule');
    expect(createHtml).toContain('Save Task');

    // TaskDetailModal with many subtasks and dependencies
    const subtasks: TaskWithMeta[] = Array.from({ length: 6 }, (_, idx) => ({
      ...sampleTask,
      id: `sub-${idx + 1}`,
      title: `Subtask deliverable item #${idx + 1} with extended description text for wrapping verification`,
      parent_task_id: sampleTask.id,
      status: idx < 2 ? 'done' : 'todo',
      is_blocked: false,
      blocking_tasks: [],
      subtask_count: 0,
      completed_subtask_count: 0,
    }));

    const detailTask: TaskDetail = {
      ...sampleTask,
      subtasks,
      dependencies: [
        {
          id: 'dep-1',
          task_id: sampleTask.id,
          depends_on_task_id: 'prereq-1',
          dependency_type: 'finish_to_start',
          prerequisite_task: {
            id: 'prereq-1',
            title: 'Finalize schema migration',
            status: 'in_progress',
            due_date: null,
          },
        },
      ],
    };

    const detailHtml = renderToStaticMarkup(
      React.createElement(TaskDetailModal, {
        task: detailTask,
        allTasks: [sampleTask],
        workspaceId: 'ws-1',
        isOpen: true,
        onClose: () => {},
      })
    );
    expect(detailHtml).toContain(longTitle);
    expect(detailHtml).toContain('Task Blocked by Unfinished Dependencies');
    expect(detailHtml).toContain('Subtasks (2/6)');
    expect(detailHtml).toContain('Subtask deliverable item #6');
    expect(detailHtml).toContain('Dependencies (1)');
    expect(detailHtml).toContain('Finalize schema migration');
    expect(detailHtml).toContain('Delete Task');
  });
});
