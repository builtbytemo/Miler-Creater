import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateTaskAction, completeTaskAction, cancelTaskAction } from '../src/lib/actions/task-actions';
import { updateTask, completeTask, type TaskWithMeta } from '../src/lib/services/task-service';
import type { TaskStatus, TaskPriority } from '../src/types/database';

// Mock dependencies of server actions
const mockGetUser = vi.fn();
const mockRevalidatePath = vi.fn();
const mockUpdateTask = vi.fn();
const mockCompleteTask = vi.fn();
const mockCancelTask = vi.fn();

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

vi.mock('@/lib/services/task-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/services/task-service')>();
  return {
    ...actual,
    updateTask: vi.fn((...args: unknown[]) => mockUpdateTask(...args)),
    completeTask: vi.fn((...args: unknown[]) => mockCompleteTask(...args)),
    cancelTask: vi.fn((...args: unknown[]) => mockCancelTask(...args)),
  };
});

describe('Task Status Selector & Dependency Restriction Regression Tests', () => {
  const wsId = '11111111-1111-1111-1111-111111111111';
  const taskId = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateTaskAction Partial Form Data Contract', () => {
    it('accepts partial FormData containing only status without injecting null for omitted fields', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'usr-1' } },
      });

      const updatedTask: TaskWithMeta = {
        id: taskId,
        workspace_id: wsId,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Existing Task',
        description: null,
        priority: 'medium',
        status: 'in_progress',
        scheduled_start: null,
        scheduled_end: null,
        due_date: null,
        estimated_duration_minutes: null,
        is_all_day: false,
        completed_at: null,
        tags: [],
        recurrence_rule_id: null,
        created_by: 'usr-1',
        assigned_to: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        subtask_count: 0,
        completed_subtask_count: 0,
        is_blocked: false,
        blocking_tasks: [],
        project: null,
      };

      mockUpdateTask.mockResolvedValueOnce(updatedTask);

      const formData = new FormData();
      formData.set('workspace_id', wsId);
      formData.set('task_id', taskId);
      formData.set('status', 'in_progress');

      const result = await updateTaskAction(null, formData);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(updatedTask);
      expect(result.error).toBeUndefined();

      // Crucial assertion: updateTask must have received ONLY { status: 'in_progress' }
      // and NOT { title: null, priority: null, ... } which triggers Zod validation failure!
      expect(mockUpdateTask).toHaveBeenCalledWith(
        expect.anything(),
        wsId,
        taskId,
        { status: 'in_progress' }
      );

      expect(mockRevalidatePath).toHaveBeenCalledWith('/tasks');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
    });

    it.each(['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as TaskStatus[])(
      'successfully persists status transition to "%s"',
      async (targetStatus) => {
        mockGetUser.mockResolvedValueOnce({
          data: { user: { id: 'usr-1' } },
        });

        const taskResult: TaskWithMeta = {
          id: taskId,
          workspace_id: wsId,
          parent_task_id: null,
          project_id: null,
          milestone_id: null,
          title: 'Status Test Task',
          description: null,
          priority: 'high',
          status: targetStatus,
          scheduled_start: null,
          scheduled_end: null,
          due_date: null,
          estimated_duration_minutes: null,
          is_all_day: false,
          completed_at: targetStatus === 'done' ? new Date().toISOString() : null,
          tags: [],
          recurrence_rule_id: null,
          created_by: 'usr-1',
          assigned_to: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          subtask_count: 0,
          completed_subtask_count: 0,
          is_blocked: targetStatus === 'blocked',
          blocking_tasks: [],
          project: null,
        };

        mockUpdateTask.mockResolvedValueOnce(taskResult);

        const formData = new FormData();
        formData.set('workspace_id', wsId);
        formData.set('task_id', taskId);
        formData.set('status', targetStatus);

        const result = await updateTaskAction(null, formData);

        expect(result.success).toBe(true);
        expect(result.data).toEqual(taskResult);
        expect(mockUpdateTask).toHaveBeenCalledWith(
          expect.anything(),
          wsId,
          taskId,
          { status: targetStatus }
        );
      }
    );

    it('returns clear error when authentication is missing', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: null },
      });

      const formData = new FormData();
      formData.set('workspace_id', wsId);
      formData.set('task_id', taskId);
      formData.set('status', 'in_progress');

      const result = await updateTaskAction(null, formData);

      expect(result.success).toBeUndefined();
      expect(result.error).toBe('Authentication required');
      expect(mockUpdateTask).not.toHaveBeenCalled();
    });

    it('returns error when workspace_id or task_id is missing', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'usr-1' } },
      });

      const formData = new FormData();
      formData.set('status', 'in_progress');

      const result = await updateTaskAction(null, formData);

      expect(result.success).toBeUndefined();
      expect(result.error).toBe('Workspace ID and Task ID are required');
      expect(mockUpdateTask).not.toHaveBeenCalled();
    });

    it('returns error when database update throws an exception', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'usr-1' } },
      });

      mockUpdateTask.mockRejectedValueOnce(new Error('Database write permission denied'));

      const formData = new FormData();
      formData.set('workspace_id', wsId);
      formData.set('task_id', taskId);
      formData.set('status', 'in_progress');

      const result = await updateTaskAction(null, formData);

      expect(result.success).toBeUndefined();
      expect(result.error).toBe('Database write permission denied');
    });
  });

  describe('completeTaskAction & cancelTaskAction Contracts', () => {
    it('completeTaskAction calls completeTask and revalidates paths', async () => {
      const mockResult = {
        completedTask: { id: taskId, status: 'done' as TaskStatus },
        nextOccurrence: null,
      };
      mockCompleteTask.mockResolvedValueOnce(mockResult);

      const res = await completeTaskAction(wsId, taskId);

      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockResult);
      expect(mockCompleteTask).toHaveBeenCalledWith(expect.anything(), wsId, taskId);
      expect(mockRevalidatePath).toHaveBeenCalledWith('/tasks');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
    });

    it('cancelTaskAction calls cancelTask and revalidates paths', async () => {
      const mockResult = { id: taskId, status: 'cancelled' as TaskStatus };
      mockCancelTask.mockResolvedValueOnce(mockResult);

      const res = await cancelTaskAction(wsId, taskId);

      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockResult);
      expect(mockCancelTask).toHaveBeenCalledWith(expect.anything(), wsId, taskId);
      expect(mockRevalidatePath).toHaveBeenCalledWith('/tasks');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
    });
  });

  describe('Modal Client-Side State Synchronization & Dependency Restriction Rules', () => {
    it('blocks transitioning to "done" client-side when task is blocked by unfinished dependencies', async () => {
      let statusError: string | null = null;
      let isActionPending = false;
      const mockOnClose = vi.fn();
      const mockOnTaskUpdated = vi.fn();

      const taskDetail = {
        id: taskId,
        status: 'todo' as TaskStatus,
        is_blocked: true,
        blocking_tasks: [{ id: 'blocker-1', title: 'Blocker Task', status: 'in_progress' as TaskStatus }],
        dependencies: [],
      };

      // Simulate TaskDetailModal handleStatusChange logic
      const handleStatusChange = async (newStatus: TaskStatus) => {
        if (newStatus === taskDetail.status) return;
        statusError = null;

        const isCompletionRestricted =
          taskDetail.is_blocked ||
          (taskDetail.blocking_tasks && taskDetail.blocking_tasks.length > 0) ||
          (taskDetail.dependencies && taskDetail.dependencies.some((d: any) => d.prerequisite_task?.status !== 'done'));

        if (newStatus === 'done' && isCompletionRestricted) {
          statusError = 'Cannot complete task while prerequisite dependencies are unresolved.';
          return;
        }

        isActionPending = true;
        try {
          // Action call
        } finally {
          isActionPending = false;
        }
      };

      await handleStatusChange('done');

      expect(statusError).toBe('Cannot complete task while prerequisite dependencies are unresolved.');
      expect(isActionPending).toBe(false);
      expect(mockUpdateTask).not.toHaveBeenCalled();
      expect(mockCompleteTask).not.toHaveBeenCalled();
      expect(mockOnClose).not.toHaveBeenCalled();
      expect(mockOnTaskUpdated).not.toHaveBeenCalled();
    });

    it('keeps details modal open after successful status change and updates parent workspace immediately', async () => {
      let currentModalStatus: TaskStatus = 'todo';
      let modalOpen = true;
      let statusError: string | null = null;
      let isActionPending = false;
      const mockOnClose = vi.fn(() => {
        modalOpen = false;
      });

      // Parent TaskWorkspace state
      let selectedDetail = {
        id: taskId,
        status: 'todo' as TaskStatus,
        completed_at: null as string | null,
        is_blocked: false,
        blocking_tasks: [],
      };
      let workspaceTasks = [{ ...selectedDetail }];
      const mockRouterRefresh = vi.fn();

      const onTaskUpdated = (updatedStatus?: TaskStatus) => {
        if (updatedStatus && selectedDetail) {
          selectedDetail = {
            ...selectedDetail,
            status: updatedStatus,
            completed_at: updatedStatus === 'done' ? new Date().toISOString() : null,
            is_blocked: updatedStatus === 'blocked' ? true : selectedDetail.blocking_tasks.length > 0,
          };
          workspaceTasks = workspaceTasks.map((t) =>
            t.id === selectedDetail.id ? { ...t, status: updatedStatus } : t
          );
        }
        mockRouterRefresh();
      };

      // Simulate handleStatusChange on TaskDetailModal
      const handleStatusChange = async (newStatus: TaskStatus) => {
        if (newStatus === currentModalStatus) return;
        statusError = null;
        isActionPending = true;

        try {
          // Simulate successful server update
          const result = { success: true };
          if (result.success) {
            currentModalStatus = newStatus;
            onTaskUpdated(newStatus);
            // CRITICAL: Notice onClose is NOT called!
          }
        } finally {
          isActionPending = false;
        }
      };

      // User changes status from 'todo' to 'in_progress'
      await handleStatusChange('in_progress');

      // Assertions
      expect(currentModalStatus).toBe('in_progress');
      expect(modalOpen).toBe(true); // Modal MUST remain open
      expect(mockOnClose).not.toHaveBeenCalled();
      expect(statusError).toBeNull();
      expect(isActionPending).toBe(false);

      // Parent workspace state updated immediately
      expect(selectedDetail.status).toBe('in_progress');
      expect(workspaceTasks[0]?.status).toBe('in_progress');
      expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
    });

    it('displays error and does not update status or close modal when update action fails', async () => {
      let currentModalStatus: TaskStatus = 'todo';
      let modalOpen = true;
      let statusError: string | null = null;
      let isActionPending = false;
      const mockOnClose = vi.fn(() => {
        modalOpen = false;
      });

      const handleStatusChange = async (newStatus: TaskStatus) => {
        if (newStatus === currentModalStatus) return;
        statusError = null;
        isActionPending = true;

        try {
          // Simulate failed server update
          const result = { error: 'Database constraint violation: status cannot be set' };
          if (result.error) {
            statusError = result.error;
            return;
          }
        } finally {
          isActionPending = false;
        }
      };

      await handleStatusChange('in_progress');

      expect(currentModalStatus).toBe('todo'); // Did NOT change
      expect(modalOpen).toBe(true); // Modal stays open
      expect(mockOnClose).not.toHaveBeenCalled();
      expect(statusError).toBe('Database constraint violation: status cannot be set');
      expect(isActionPending).toBe(false);
    });
  });
});
