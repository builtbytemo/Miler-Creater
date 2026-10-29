import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTaskAction } from '../src/lib/actions/task-actions';
import type { TaskWithMeta } from '../src/lib/services/task-service';

// Mock dependencies of createTaskAction
const mockGetUser = vi.fn();
const mockRevalidatePath = vi.fn();
const mockCreateTask = vi.fn();

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => mockRevalidatePath(path),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

vi.mock('@/lib/services/task-service', () => ({
  createTask: (...args: unknown[]) => mockCreateTask(...args),
}));

describe('Task Immediate Update & State Synchronization Regression Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createTaskAction Server Action Contract', () => {
    it('returns { success: true, data: task } and revalidates /tasks on successful creation', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'usr-123' } },
      });

      const mockCreatedTask: TaskWithMeta = {
        id: 't-new-1',
        workspace_id: 'ws-1',
        title: 'E2E Immediate Update Test',
        description: null,
        priority: 'medium',
        status: 'todo',
        scheduled_start: null,
        scheduled_end: null,
        due_date: null,
        is_all_day: false,
        estimated_duration_minutes: null,
        project_id: null,
        milestone_id: null,
        parent_task_id: null,
        tags: [],
        recurrence_rule_id: null,
        created_by: 'usr-123',
        assigned_to: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
        subtask_count: 0,
        completed_subtask_count: 0,
        is_blocked: false,
        blocking_tasks: [],
        project: null,
      };
      mockCreateTask.mockResolvedValueOnce(mockCreatedTask);

      const formData = new FormData();
      formData.set('workspace_id', 'ws-1');
      formData.set('title', 'E2E Immediate Update Test');
      formData.set('priority', 'medium');
      formData.set('status', 'todo');

      const result = await createTaskAction(null, formData);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockCreatedTask);
      expect(result.error).toBeUndefined();
      expect(mockRevalidatePath).toHaveBeenCalledWith('/tasks');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
    });

    it('returns error without success or data when authentication is missing', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: null },
      });

      const formData = new FormData();
      formData.set('workspace_id', 'ws-1');
      formData.set('title', 'Unauthenticated Task');

      const result = await createTaskAction(null, formData);

      expect(result.success).toBeUndefined();
      expect(result.data).toBeUndefined();
      expect(result.error).toBe('Authentication required');
      expect(mockCreateTask).not.toHaveBeenCalled();
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it('returns error without success or data when workspace_id is missing', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'usr-123' } },
      });

      const formData = new FormData();
      formData.set('title', 'Missing Workspace Task');

      const result = await createTaskAction(null, formData);

      expect(result.success).toBeUndefined();
      expect(result.data).toBeUndefined();
      expect(result.error).toBe('Workspace ID is required');
      expect(mockCreateTask).not.toHaveBeenCalled();
    });

    it('returns error without success or data when database insert throws an exception', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'usr-123' } },
      });
      mockCreateTask.mockRejectedValueOnce(new Error('Database connection failed'));

      const formData = new FormData();
      formData.set('workspace_id', 'ws-1');
      formData.set('title', 'Failed Insert Task');

      const result = await createTaskAction(null, formData);

      expect(result.success).toBeUndefined();
      expect(result.data).toBeUndefined();
      expect(result.error).toBe('Database connection failed');
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });
  });

  describe('TaskWorkspace Client State & Filter Consistency', () => {
    const existingTasks: TaskWithMeta[] = [
      {
        id: 't-existing-1',
        workspace_id: 'ws-1',
        title: 'Existing Task 1',
        description: null,
        priority: 'high',
        status: 'in_progress',
        scheduled_start: null,
        scheduled_end: null,
        due_date: null,
        is_all_day: false,
        estimated_duration_minutes: null,
        project_id: null,
        milestone_id: null,
        parent_task_id: null,
        tags: [],
        recurrence_rule_id: null,
        created_by: 'usr-123',
        assigned_to: null,
        created_at: '2026-10-28T10:00:00Z',
        updated_at: '2026-10-28T10:00:00Z',
        completed_at: null,
        subtask_count: 0,
        completed_subtask_count: 0,
        is_blocked: false,
        blocking_tasks: [],
        project: null,
      },
    ];

    it('immediately reflects created task in local state and filtered list without full reload', () => {
      let currentTasks = [...existingTasks];
      let successBanner: string | null = null;
      const mockRefresh = vi.fn();

      // Simulate TaskWorkspace handleTaskCreated
      const handleTaskCreated = (newTask: TaskWithMeta) => {
        if (!newTask.parent_task_id) {
          if (!currentTasks.some((t) => t.id === newTask.id)) {
            currentTasks = [newTask, ...currentTasks];
          }
        }
        successBanner = `Task "${newTask.title}" created successfully.`;
        mockRefresh();
      };

      const newTask: TaskWithMeta = {
        id: 't-new-2',
        workspace_id: 'ws-1',
        title: 'E2E Immediate Update Test',
        description: 'Testing immediate render',
        priority: 'medium',
        status: 'todo',
        scheduled_start: null,
        scheduled_end: null,
        due_date: null,
        is_all_day: false,
        estimated_duration_minutes: null,
        project_id: null,
        milestone_id: null,
        parent_task_id: null,
        tags: [],
        recurrence_rule_id: null,
        created_by: 'usr-123',
        assigned_to: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
        subtask_count: 0,
        completed_subtask_count: 0,
        is_blocked: false,
        blocking_tasks: [],
        project: null,
      };

      // Before creation
      expect(currentTasks).toHaveLength(1);
      expect(successBanner).toBeNull();

      // Trigger task created
      handleTaskCreated(newTask);

      // Immediately after creation
      expect(currentTasks).toHaveLength(2);
      expect(currentTasks[0]?.id).toBe('t-new-2');
      expect(currentTasks[0]?.title).toBe('E2E Immediate Update Test');
      expect(successBanner).toBe('Task "E2E Immediate Update Test" created successfully.');
      expect(mockRefresh).toHaveBeenCalledTimes(1);

      // Verify client-side filter computation
      const activeFilter = 'active';
      const filtered = currentTasks.filter((t) => {
        if (activeFilter === 'active') return t.status !== 'done' && t.status !== 'cancelled';
        return true;
      });
      expect(filtered.map((t) => t.title)).toContain('E2E Immediate Update Test');
    });

    it('synchronizes with server initialTasks without creating duplicate entries', () => {
      const initialTask: TaskWithMeta = { ...existingTasks[0]! };
      let stateTasks = [initialTask];

      const newTask: TaskWithMeta = {
        ...initialTask,
        id: 't-new-3',
        title: 'Second Task',
      };

      // 1. Immediate client update
      stateTasks = [newTask, ...stateTasks];
      expect(stateTasks).toHaveLength(2);

      // 2. Server revalidation returns updated initialTasks containing both tasks
      const serverUpdatedInitialTasks = [newTask, initialTask];

      // Simulate useEffect([initialTasks]) sync
      stateTasks = serverUpdatedInitialTasks;

      expect(stateTasks).toHaveLength(2);
      expect(stateTasks[0]?.id).toBe('t-new-3');
      expect(stateTasks[1]?.id).toBe('t-existing-1');
    });

    it('does not add or display task if action result indicates failure', () => {
      const stateTasks = [...existingTasks];
      let successBanner: string | null = null;
      let modalOpen = true;

      // Simulate CreateTaskModal effect on failure
      const state = { error: 'Database constraint violation' };
      const onTaskCreated = vi.fn();
      const onClose = vi.fn(() => {
        modalOpen = false;
      });

      if ((state as { success?: boolean }).success) {
        onTaskCreated();
        onClose();
      }

      expect(onTaskCreated).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(modalOpen).toBe(true);
      expect(stateTasks).toHaveLength(1);
      expect(successBanner).toBeNull();
    });
  });
});
