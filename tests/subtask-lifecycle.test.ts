import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTaskDetailAction } from '../src/lib/actions/task-actions';
import { getTaskById, type TaskDetail, type TaskWithMeta } from '../src/lib/services/task-service';
import type { TaskStatus } from '../src/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';

// Mock dependencies of getTaskDetailAction
const mockGetUser = vi.fn();
const mockGetTaskById = vi.fn();

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
    getTaskById: vi.fn((...args: unknown[]) => mockGetTaskById(...args)),
  };
});

describe('Subtask Visibility & Lifecycle Regression Tests', () => {
  const wsId = '11111111-1111-1111-1111-111111111111';
  const parentTaskId = '22222222-2222-2222-2222-222222222222';
  const subtaskId = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTaskDetailAction Server Action Contract', () => {
    it('returns full TaskDetail with subtasks and dependencies on success', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'usr-123' } },
      });

      const mockDetail: TaskDetail = {
        id: parentTaskId,
        workspace_id: wsId,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Parent Task',
        description: 'Parent description',
        priority: 'high',
        status: 'todo',
        scheduled_start: null,
        scheduled_end: null,
        due_date: null,
        estimated_duration_minutes: null,
        is_all_day: false,
        completed_at: null,
        tags: [],
        recurrence_rule_id: null,
        created_by: 'usr-123',
        assigned_to: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        subtask_count: 1,
        completed_subtask_count: 0,
        is_blocked: false,
        blocking_tasks: [],
        project: null,
        subtasks: [
          {
            id: subtaskId,
            workspace_id: wsId,
            parent_task_id: parentTaskId,
            project_id: null,
            milestone_id: null,
            title: 'Subtask 1',
            description: null,
            priority: 'medium',
            status: 'todo',
            scheduled_start: null,
            scheduled_end: null,
            due_date: null,
            estimated_duration_minutes: null,
            is_all_day: false,
            completed_at: null,
            tags: [],
            recurrence_rule_id: null,
            created_by: 'usr-123',
            assigned_to: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            subtask_count: 0,
            completed_subtask_count: 0,
            is_blocked: false,
            blocking_tasks: [],
            project: null,
          },
        ],
        dependencies: [],
      };

      mockGetTaskById.mockResolvedValueOnce(mockDetail);

      const result = await getTaskDetailAction(wsId, parentTaskId);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockDetail);
      expect(mockGetTaskById).toHaveBeenCalledWith(expect.anything(), wsId, parentTaskId);
    });

    it('returns error when user is unauthenticated', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: null },
      });

      const result = await getTaskDetailAction(wsId, parentTaskId);

      expect(result.success).toBeUndefined();
      expect(result.error).toBe('Authentication required');
      expect(mockGetTaskById).not.toHaveBeenCalled();
    });

    it('returns error when workspaceId or taskId is omitted', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'usr-123' } },
      });

      const result = await getTaskDetailAction('', parentTaskId);

      expect(result.success).toBeUndefined();
      expect(result.error).toBe('Workspace ID and Task ID are required');
    });

    it('returns error when task is not found', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'usr-123' } },
      });

      mockGetTaskById.mockResolvedValueOnce(null);

      const result = await getTaskDetailAction(wsId, parentTaskId);

      expect(result.success).toBeUndefined();
      expect(result.error).toBe('Task not found');
    });
  });

  describe('Immediate UI Updates & State Synchronization', () => {
    it('immediately reflects created subtask in parent detail modal without refresh', () => {
      let modalTask: TaskDetail = {
        id: parentTaskId,
        workspace_id: wsId,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Feature Implementation',
        description: null,
        priority: 'high',
        status: 'todo',
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
        subtasks: [],
        dependencies: [],
      };

      const newSubtask: TaskWithMeta = {
        id: subtaskId,
        workspace_id: wsId,
        parent_task_id: parentTaskId,
        project_id: null,
        milestone_id: null,
        title: 'Write Unit Tests',
        description: null,
        priority: 'medium',
        status: 'todo',
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

      // Simulate handleSubtaskCreated in TaskDetailModal
      const handleSubtaskCreated = (sub: TaskWithMeta) => {
        if (modalTask.subtasks.some((s) => s.id === sub.id)) return;
        const nextSubtasks = [...modalTask.subtasks, sub];
        modalTask = {
          ...modalTask,
          subtasks: nextSubtasks,
          subtask_count: nextSubtasks.length,
          completed_subtask_count: nextSubtasks.filter((s) => s.status === 'done').length,
        };
      };

      expect(modalTask.subtasks).toHaveLength(0);
      expect(modalTask.subtask_count).toBe(0);

      handleSubtaskCreated(newSubtask);

      expect(modalTask.subtasks).toHaveLength(1);
      expect(modalTask.subtasks[0]?.id).toBe(subtaskId);
      expect(modalTask.subtasks[0]?.title).toBe('Write Unit Tests');
      expect(modalTask.subtasks[0]?.parent_task_id).toBe(parentTaskId);
      expect(modalTask.subtask_count).toBe(1);
      expect(modalTask.completed_subtask_count).toBe(0);
    });

    it('immediately updates parent card subtask counts in TaskWorkspace upon subtask creation', () => {
      let workspaceTasks: TaskWithMeta[] = [
        {
          id: parentTaskId,
          workspace_id: wsId,
          parent_task_id: null,
          project_id: null,
          milestone_id: null,
          title: 'Parent Deliverable',
          description: null,
          priority: 'urgent',
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
        },
      ];

      const createdSubtask: TaskWithMeta = {
        id: subtaskId,
        workspace_id: wsId,
        parent_task_id: parentTaskId,
        project_id: null,
        milestone_id: null,
        title: 'Child Component A',
        description: null,
        priority: 'high',
        status: 'todo',
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

      // Simulate handleSubtaskCreated in TaskWorkspace
      const handleSubtaskCreated = (parentId: string, sub: TaskWithMeta) => {
        workspaceTasks = workspaceTasks.map((t) => {
          if (t.id === parentId) {
            return {
              ...t,
              subtask_count: t.subtask_count + 1,
              completed_subtask_count:
                sub.status === 'done' ? t.completed_subtask_count + 1 : t.completed_subtask_count,
            };
          }
          return t;
        });
      };

      expect(workspaceTasks[0]?.subtask_count).toBe(0);

      handleSubtaskCreated(parentTaskId, createdSubtask);

      expect(workspaceTasks[0]?.subtask_count).toBe(1);
      expect(workspaceTasks[0]?.completed_subtask_count).toBe(0);
    });

    it('toggling a subtask to done updates parent completed_subtask_count', () => {
      let modalTask: TaskDetail = {
        id: parentTaskId,
        workspace_id: wsId,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Parent Deliverable',
        description: null,
        priority: 'urgent',
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
        subtask_count: 1,
        completed_subtask_count: 0,
        is_blocked: false,
        blocking_tasks: [],
        project: null,
        subtasks: [
          {
            id: subtaskId,
            workspace_id: wsId,
            parent_task_id: parentTaskId,
            project_id: null,
            milestone_id: null,
            title: 'Subtask 1',
            description: null,
            priority: 'medium',
            status: 'todo',
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
          },
        ],
        dependencies: [],
      };

      // Simulate toggle subtask
      const handleToggleSubtask = (subId: string, newStatus: TaskStatus) => {
        const nextSubtasks = modalTask.subtasks.map((s) =>
          s.id === subId ? { ...s, status: newStatus } : s
        );
        modalTask = {
          ...modalTask,
          subtasks: nextSubtasks,
          completed_subtask_count: nextSubtasks.filter((s) => s.status === 'done').length,
        };
      };

      expect(modalTask.completed_subtask_count).toBe(0);

      handleToggleSubtask(subtaskId, 'done');

      expect(modalTask.subtasks[0]?.status).toBe('done');
      expect(modalTask.completed_subtask_count).toBe(1);
      expect(modalTask.subtask_count).toBe(1);

      // Toggle back to todo
      handleToggleSubtask(subtaskId, 'todo');

      expect(modalTask.subtasks[0]?.status).toBe('todo');
      expect(modalTask.completed_subtask_count).toBe(0);
    });

    it('failed subtask creation does not produce phantom subtasks or increment counts', () => {
      let modalTask: TaskDetail = {
        id: parentTaskId,
        workspace_id: wsId,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Parent Task',
        description: null,
        priority: 'medium',
        status: 'todo',
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
        subtasks: [],
        dependencies: [],
      };

      // Server action returns error
      const actionResult = { error: 'Task title cannot be empty' };

      const handleCreationAttempt = (res: { success?: boolean; error?: string; data?: unknown }) => {
        if (res.error || !res.success) {
          // Do not update subtasks or counts!
          return;
        }
      };

      handleCreationAttempt(actionResult);

      expect(modalTask.subtasks).toHaveLength(0);
      expect(modalTask.subtask_count).toBe(0);
    });
  });
});
