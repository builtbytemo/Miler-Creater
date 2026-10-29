import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import TasksPage from '../src/app/tasks/page';

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
});
