import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { AIExecutionContext } from '@/lib/mcp/types';
import {
  dispatchTool,
  getRegisteredToolNames,
  getToolDefinition,
  listToolDefinitions,
  TOOL_REGISTRY,
} from '@/lib/mcp/dispatcher';

// Mock domain services
vi.mock('@/lib/services/dashboard-service', () => ({
  getDashboardSummary: vi.fn(),
}));

vi.mock('@/lib/services/task-service', () => ({
  getTasks: vi.fn(),
  getTaskById: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
}));

vi.mock('@/lib/services/content-service', () => ({
  getContentItems: vi.fn(),
  getContentItemById: vi.fn(),
  createContentItem: vi.fn(),
  updateContentItem: vi.fn(),
}));

import { getDashboardSummary } from '@/lib/services/dashboard-service';
import {
  getTasks,
  getTaskById,
  createTask,
  updateTask,
  completeTask,
} from '@/lib/services/task-service';
import {
  getContentItems,
  getContentItemById,
  createContentItem,
  updateContentItem,
} from '@/lib/services/content-service';

describe('Unified AI Tool Dispatcher (Phase 7.3)', () => {
  const mockSupabase = {} as SupabaseClient<Database>;
  const trustedWsId = '123e4567-e89b-12d3-a456-426614174001';
  const trustedUserId = '123e4567-e89b-12d3-a456-426614174002';
  const trustedActorId = '123e4567-e89b-12d3-a456-426614174003';
  const validTaskId = '123e4567-e89b-12d3-a456-426614174000';
  const validContentId = '66666666-7777-4888-9999-000000000000';

  const fullContext: AIExecutionContext = {
    supabase: mockSupabase,
    workspaceId: trustedWsId,
    userId: trustedUserId,
    actorId: trustedActorId,
    scopes: ['task:read', 'task:write', 'content:read', 'content:write'],
    timeZone: 'America/New_York',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Registry Integrity and Authoritative Tool Count', () => {
    it('registers exactly 14 tools', () => {
      const names = getRegisteredToolNames();
      expect(names).toHaveLength(14);
      expect(listToolDefinitions()).toHaveLength(14);
      expect(Object.keys(TOOL_REGISTRY)).toHaveLength(14);
    });

    it('contains exactly 7 read tools and 7 write tools', () => {
      const tools = listToolDefinitions();
      const readTools = tools.filter((t) => t.category === 'read');
      const writeTools = tools.filter((t) => t.category === 'write');

      expect(readTools).toHaveLength(7);
      expect(writeTools).toHaveLength(7);

      expect(readTools.map((t) => t.name)).toEqual([
        'get_workspace_summary',
        'search_tasks',
        'get_task_details',
        'list_overdue_tasks',
        'search_content',
        'get_content_details',
        'list_scheduled_content',
      ]);

      expect(writeTools.map((t) => t.name)).toEqual([
        'create_task',
        'update_task',
        'change_task_status',
        'reschedule_task',
        'create_content_item',
        'update_content_item',
        'reschedule_content',
      ]);
    });

    it('ensures each tool has non-empty description, schema, and requiredScopes', () => {
      for (const tool of listToolDefinitions()) {
        expect(tool.name).toBeTruthy();
        expect(tool.description.length).toBeGreaterThan(15);
        expect(tool.requiredScopes.length).toBeGreaterThan(0);
        expect(tool.schema).toBeDefined();
        expect(typeof tool.execute).toBe('function');
      }
    });

    it('retrieves tools by name with getToolDefinition', () => {
      expect(getToolDefinition('create_task')).toBeDefined();
      expect(getToolDefinition('non_existent')).toBeUndefined();
    });
  });

  describe('Unknown Tools and Input Validation', () => {
    it('returns structured UNKNOWN_TOOL error for unregistered tool names', async () => {
      const res = await dispatchTool('delete_database', {}, fullContext);
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('UNKNOWN_TOOL');
      expect(res.error?.message).toContain('Unknown or unregistered tool');
    });

    it('returns INVALID_ARGUMENTS error when required arguments are missing', async () => {
      const res = await dispatchTool('create_task', {}, fullContext);
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('INVALID_ARGUMENTS');
      expect(createTask).not.toHaveBeenCalled();
    });

    it('returns INVALID_ARGUMENTS error when arguments violate schema constraints', async () => {
      const res = await dispatchTool(
        'create_task',
        {
          title: 'Deep work',
          scheduled_start: '2026-10-30T12:00:00Z',
          scheduled_end: '2026-10-30T10:00:00Z', // invalid: end before start
        },
        fullContext
      );
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('INVALID_ARGUMENTS');
      expect(createTask).not.toHaveBeenCalled();
    });

    it('rejects model-supplied workspace_id or user_id in arguments (strict schema enforcement)', async () => {
      const res = await dispatchTool(
        'create_task',
        {
          title: 'Malicious Task',
          workspace_id: 'ws-attacker-controlled',
        },
        fullContext
      );
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('INVALID_ARGUMENTS');
      expect(createTask).not.toHaveBeenCalled();
    });
  });

  describe('Scope Enforcement and Security Boundaries', () => {
    it('rejects write tools when context lacks write scope (e.g. read-only token)', async () => {
      const readOnlyContext: AIExecutionContext = {
        ...fullContext,
        scopes: ['task:read', 'content:read'],
      };

      const res = await dispatchTool(
        'create_task',
        { title: 'Attempted creation' },
        readOnlyContext
      );

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('FORBIDDEN');
      expect(res.error?.message).toContain('Token lacks required scope(s): task:write');
      expect(createTask).not.toHaveBeenCalled();
    });

    it('rejects read tools when context lacks read scope (e.g. write-only token)', async () => {
      const writeOnlyContext: AIExecutionContext = {
        ...fullContext,
        scopes: ['task:write', 'content:write'],
      };

      const res = await dispatchTool('search_tasks', {}, writeOnlyContext);

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('FORBIDDEN');
      expect(res.error?.message).toContain('Token lacks required scope(s): task:read');
      expect(getTasks).not.toHaveBeenCalled();
    });

    it('rejects cross-domain scope violations (e.g. task:read attempting content:read)', async () => {
      const taskOnlyContext: AIExecutionContext = {
        ...fullContext,
        scopes: ['task:read', 'task:write'],
      };

      const res = await dispatchTool('search_content', {}, taskOnlyContext);

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('FORBIDDEN');
      expect(res.error?.message).toContain('content:read');
      expect(getContentItems).not.toHaveBeenCalled();
    });

    it('rejects get_workspace_summary if either task:read or content:read is missing', async () => {
      const taskOnlyContext: AIExecutionContext = {
        ...fullContext,
        scopes: ['task:read'],
      };

      const res = await dispatchTool('get_workspace_summary', {}, taskOnlyContext);
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('FORBIDDEN');
      expect(res.error?.message).toContain('content:read');
    });
  });

  describe('Read-Only Tools Execution and Parameter Injection', () => {
    it('1. get_workspace_summary executes and passes trusted workspace and user IDs', async () => {
      vi.mocked(getDashboardSummary).mockResolvedValueOnce({
        workspaceId: trustedWsId,
        userId: trustedUserId,
        referenceTime: '2026-10-30T10:00:00Z',
        timeZone: 'America/New_York',
        tasks: { overdueCount: 2, dueTodayCount: 1, pendingSubtasksCount: 0, blockedCount: 0, urgentTasks: [] },
        content: { draftCount: 3, ideaCount: 1, scheduledNext7DaysCount: 4, scheduledNext24HoursCount: 0, byPlatform: {} as any, upcomingItems: [] },
        notifications: { unreadCount: 1, recentUnread: [] },
      });

      const res = await dispatchTool('get_workspace_summary', {}, fullContext);

      expect(res.success).toBe(true);
      expect(getDashboardSummary).toHaveBeenCalledWith(
        mockSupabase,
        trustedWsId,
        trustedUserId,
        { userTimeZone: 'America/New_York' }
      );
    });

    it('2. search_tasks executes, passes trusted workspace ID, and respects limit slice', async () => {
      const fakeTasks = Array.from({ length: 30 }, (_, i) => ({
        id: `t-${i}`,
        title: `Task ${i}`,
        workspace_id: trustedWsId,
      }));
      vi.mocked(getTasks).mockResolvedValueOnce(fakeTasks as any);

      const res = await dispatchTool(
        'search_tasks',
        { search: 'test', status: 'in_progress', limit: 5 },
        fullContext
      );

      expect(res.success).toBe(true);
      expect(getTasks).toHaveBeenCalledWith(
        mockSupabase,
        trustedWsId,
        { search: 'test', status: 'in_progress' }
      );
      expect((res.data as any[]).length).toBe(5);
    });

    it('3. get_task_details executes and scopes lookup to trusted workspace ID', async () => {
      vi.mocked(getTaskById).mockResolvedValueOnce({
        id: validTaskId,
        title: 'Core Task',
        workspace_id: trustedWsId,
      } as any);

      const res = await dispatchTool('get_task_details', { task_id: validTaskId }, fullContext);

      expect(res.success).toBe(true);
      expect(getTaskById).toHaveBeenCalledWith(mockSupabase, trustedWsId, validTaskId);
      expect((res.data as any).id).toBe(validTaskId);
    });

    it('4. list_overdue_tasks executes with incomplete statuses and current timestamp', async () => {
      vi.mocked(getTasks).mockResolvedValueOnce([
        { id: 'overdue-1', title: 'Late Task', workspace_id: trustedWsId },
      ] as any);

      const res = await dispatchTool('list_overdue_tasks', { limit: 10 }, fullContext);

      expect(res.success).toBe(true);
      expect(getTasks).toHaveBeenCalledWith(
        mockSupabase,
        trustedWsId,
        expect.objectContaining({
          status: ['todo', 'in_progress', 'blocked'],
          due_date_to: expect.any(String),
        })
      );
      expect((res.data as any[]).length).toBe(1);
    });

    it('5. search_content executes and passes filters to content-service', async () => {
      vi.mocked(getContentItems).mockResolvedValueOnce([
        { id: 'c-1', platform: 'linkedin', title: 'Post 1', workspace_id: trustedWsId },
      ] as any);

      const res = await dispatchTool(
        'search_content',
        { platform: 'linkedin', status: 'draft', limit: 10 },
        fullContext
      );

      expect(res.success).toBe(true);
      expect(getContentItems).toHaveBeenCalledWith(
        mockSupabase,
        trustedWsId,
        { platform: 'linkedin', status: 'draft' }
      );
    });

    it('6. get_content_details executes with content_id and trusted workspace ID', async () => {
      vi.mocked(getContentItemById).mockResolvedValueOnce({
        id: validContentId,
        platform: 'x',
        title: 'Tweet Draft',
        workspace_id: trustedWsId,
      } as any);

      const res = await dispatchTool('get_content_details', { content_id: validContentId }, fullContext);

      expect(res.success).toBe(true);
      expect(getContentItemById).toHaveBeenCalledWith(mockSupabase, trustedWsId, validContentId);
    });

    it('7. list_scheduled_content executes with is_scheduled: true', async () => {
      vi.mocked(getContentItems).mockResolvedValueOnce([
        { id: 'c-sched', scheduled_at: '2026-10-31T10:00:00Z', workspace_id: trustedWsId },
      ] as any);

      const res = await dispatchTool(
        'list_scheduled_content',
        { platform: 'x', limit: 10 },
        fullContext
      );

      expect(res.success).toBe(true);
      expect(getContentItems).toHaveBeenCalledWith(
        mockSupabase,
        trustedWsId,
        { is_scheduled: true, platform: 'x', scheduled_from: undefined, scheduled_to: undefined }
      );
    });
  });

  describe('Write Tools Execution and Identity Attribution', () => {
    it('8. create_task injects trusted workspace ID and userId as created_by', async () => {
      vi.mocked(createTask).mockResolvedValueOnce({
        id: 'new-t-1',
        title: 'New Strategy',
        workspace_id: trustedWsId,
        created_by: trustedUserId,
      } as any);

      const res = await dispatchTool(
        'create_task',
        {
          title: 'New Strategy',
          priority: 'urgent',
        },
        fullContext
      );

      expect(res.success).toBe(true);
      expect(createTask).toHaveBeenCalledWith(
        mockSupabase,
        trustedWsId,
        expect.objectContaining({
          title: 'New Strategy',
          priority: 'urgent',
          status: 'todo',
          is_all_day: false,
        }),
        trustedUserId
      );
    });

    it('9. update_task unpacks task_id and sends updates to updateTask', async () => {
      vi.mocked(updateTask).mockResolvedValueOnce({
        id: validTaskId,
        title: 'Updated Strategy',
        workspace_id: trustedWsId,
      } as any);

      const res = await dispatchTool(
        'update_task',
        {
          task_id: validTaskId,
          title: 'Updated Strategy',
          priority: 'high',
        },
        fullContext
      );

      expect(res.success).toBe(true);
      expect(updateTask).toHaveBeenCalledWith(
        mockSupabase,
        trustedWsId,
        validTaskId,
        { title: 'Updated Strategy', priority: 'high' }
      );
    });

    it('10. change_task_status routes to completeTask when status is "done"', async () => {
      vi.mocked(completeTask).mockResolvedValueOnce({
        completedTask: { id: validTaskId, status: 'done', completed_at: '2026-10-30T10:00:00Z' } as any,
        nextOccurrence: null,
      });

      const res = await dispatchTool(
        'change_task_status',
        {
          task_id: validTaskId,
          status: 'done',
        },
        fullContext
      );

      expect(res.success).toBe(true);
      expect(completeTask).toHaveBeenCalledWith(mockSupabase, trustedWsId, validTaskId);
      expect(updateTask).not.toHaveBeenCalled();
    });

    it('10b. change_task_status routes to updateTask when status is not "done"', async () => {
      vi.mocked(updateTask).mockResolvedValueOnce({
        id: validTaskId,
        status: 'in_progress',
      } as any);

      const res = await dispatchTool(
        'change_task_status',
        {
          task_id: validTaskId,
          status: 'in_progress',
        },
        fullContext
      );

      expect(res.success).toBe(true);
      expect(updateTask).toHaveBeenCalledWith(
        mockSupabase,
        trustedWsId,
        validTaskId,
        { status: 'in_progress' }
      );
      expect(completeTask).not.toHaveBeenCalled();
    });

    it('11. reschedule_task updates due_date on task', async () => {
      vi.mocked(updateTask).mockResolvedValueOnce({
        id: validTaskId,
        due_date: '2026-11-01T15:00:00Z',
      } as any);

      const res = await dispatchTool(
        'reschedule_task',
        {
          task_id: validTaskId,
          due_date: '2026-11-01T15:00:00Z',
        },
        fullContext
      );

      expect(res.success).toBe(true);
      expect(updateTask).toHaveBeenCalledWith(
        mockSupabase,
        trustedWsId,
        validTaskId,
        { due_date: '2026-11-01T15:00:00Z' }
      );
    });

    it('12. create_content_item injects trusted workspace ID and userId as created_by', async () => {
      vi.mocked(createContentItem).mockResolvedValueOnce({
        id: 'new-c-1',
        platform: 'threads',
        title: 'Threads update',
        workspace_id: trustedWsId,
        created_by: trustedUserId,
      } as any);

      const res = await dispatchTool(
        'create_content_item',
        {
          platform: 'threads',
          title: 'Threads update',
        },
        fullContext
      );

      expect(res.success).toBe(true);
      expect(createContentItem).toHaveBeenCalledWith(
        mockSupabase,
        trustedWsId,
        expect.objectContaining({
          platform: 'threads',
          title: 'Threads update',
          status: 'idea',
          action_type: 'post',
        }),
        trustedUserId
      );
    });

    it('13. update_content_item unpacks content_id and sends updates to updateContentItem', async () => {
      vi.mocked(updateContentItem).mockResolvedValueOnce({
        id: validContentId,
        title: 'Revised Post',
        workspace_id: trustedWsId,
      } as any);

      const res = await dispatchTool(
        'update_content_item',
        {
          content_id: validContentId,
          title: 'Revised Post',
          status: 'draft',
        },
        fullContext
      );

      expect(res.success).toBe(true);
      expect(updateContentItem).toHaveBeenCalledWith(
        mockSupabase,
        trustedWsId,
        validContentId,
        { title: 'Revised Post', status: 'draft' }
      );
    });

    it('14. reschedule_content verifies status and updates scheduled_at', async () => {
      vi.mocked(getContentItemById).mockResolvedValueOnce({
        id: validContentId,
        status: 'draft',
        workspace_id: trustedWsId,
      } as any);

      vi.mocked(updateContentItem).mockResolvedValueOnce({
        id: validContentId,
        status: 'scheduled',
        scheduled_at: '2026-11-05T12:00:00Z',
      } as any);

      const res = await dispatchTool(
        'reschedule_content',
        {
          content_id: validContentId,
          scheduled_at: '2026-11-05T12:00:00Z',
        },
        fullContext
      );

      expect(res.success).toBe(true);
      expect(getContentItemById).toHaveBeenCalledWith(mockSupabase, trustedWsId, validContentId);
      expect(updateContentItem).toHaveBeenCalledWith(
        mockSupabase,
        trustedWsId,
        validContentId,
        { scheduled_at: '2026-11-05T12:00:00Z', status: 'scheduled' }
      );
    });

    it('14b. reschedule_content rejects rescheduling when content is already published or archived', async () => {
      vi.mocked(getContentItemById).mockResolvedValueOnce({
        id: validContentId,
        status: 'published',
        workspace_id: trustedWsId,
      } as any);

      const res = await dispatchTool(
        'reschedule_content',
        {
          content_id: validContentId,
          scheduled_at: '2026-11-05T12:00:00Z',
        },
        fullContext
      );

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('INVALID_OPERATION');
      expect(res.error?.message).toContain('Cannot reschedule content item with terminal status "published"');
      expect(updateContentItem).not.toHaveBeenCalled();
    });
  });

  describe('Error Mapping and Cross-Workspace Sanitization', () => {
    it('maps "not found" service errors to safe NOT_FOUND code without leaking existence', async () => {
      vi.mocked(getTaskById).mockRejectedValueOnce(new Error('Task not found'));

      const res = await dispatchTool('get_task_details', { task_id: validTaskId }, fullContext);

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('NOT_FOUND');
      expect(res.error?.message).toBe('The requested record was not found or is inaccessible in this workspace.');
    });

    it('maps dependency failures to DEPENDENCY_ERROR code', async () => {
      vi.mocked(completeTask).mockRejectedValueOnce(
        new Error('Cannot complete task while prerequisite dependencies are incomplete: Prerequisite Task A')
      );

      const res = await dispatchTool(
        'change_task_status',
        { task_id: validTaskId, status: 'done' },
        fullContext
      );

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('DEPENDENCY_ERROR');
      expect(res.error?.message).toContain('prerequisite dependencies are incomplete');
    });

    it('maps unexpected exceptions to safe EXECUTION_FAILED without leaking stack traces', async () => {
      vi.mocked(createTask).mockRejectedValueOnce(
        new Error('connection to server at "postgres.internal" failed: timeout')
      );

      const res = await dispatchTool('create_task', { title: 'Some task' }, fullContext);

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('EXECUTION_FAILED');
      expect(res.error?.message).toBe('An error occurred while executing the tool operation.');
      // Details contain the error message, but no credentials or connection string should be generated by app
      expect(res.error?.details).toBeDefined();
    });

    it('preserves workspace boundary: service call is always constrained to context.workspaceId', async () => {
      vi.mocked(getTasks).mockResolvedValueOnce([]);

      // Context is bound to Workspace Alpha
      const alphaContext: AIExecutionContext = {
        ...fullContext,
        workspaceId: 'ws-alpha-1111',
      };

      await dispatchTool('search_tasks', { search: 'Project' }, alphaContext);

      expect(getTasks).toHaveBeenCalledWith(
        mockSupabase,
        'ws-alpha-1111',
        expect.anything()
      );
      expect(getTasks).not.toHaveBeenCalledWith(
        mockSupabase,
        'ws-beta-2222',
        expect.anything()
      );
    });
  });
});
