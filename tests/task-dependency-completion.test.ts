import { describe, it, expect, vi } from 'vitest';
import { updateTask, completeTask } from '../src/lib/services/task-service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';

describe('Dependency Restrictions on Task Completion (Service Layer)', () => {
  const wsId = '11111111-1111-1111-1111-111111111111';
  const taskId = '22222222-2222-2222-2222-222222222222';
  const prereqTaskId = '33333333-3333-3333-3333-333333333333';

  function createMockSupabase(options: {
    dependencies?: { depends_on_task_id: string }[];
    incompletePrereqs?: { id: string; title: string; status: string }[];
    currentTask?: Record<string, unknown>;
    updatedTask?: Record<string, unknown>;
  }) {
    const fromMock = vi.fn((table: string) => {
      if (table === 'task_dependencies') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: options.dependencies || [], error: null }),
        };
      }

      if (table === 'tasks') {
        const queryBuilder: Record<string, unknown> = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          single: vi.fn(),
          maybeSingle: vi.fn(),
        };

        // For incompletePrereqs query: .select('id, title, status').in('id', prereqIds).neq('status', 'done')
        (queryBuilder.neq as ReturnType<typeof vi.fn>).mockResolvedValue({
          data: options.incompletePrereqs || [],
          error: null,
        });

        // For fetch current task: .select('*').eq('workspace_id', ...).eq('id', ...).single()
        // Or update task: .update(...).eq(...).eq(...).select(...).single()
        (queryBuilder.single as ReturnType<typeof vi.fn>).mockImplementation(async () => {
          return {
            data: options.updatedTask || options.currentTask || {
              id: taskId,
              workspace_id: wsId,
              title: 'Target Task',
              status: 'done',
              priority: 'medium',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              projects: null,
            },
            error: null,
          };
        });

        return queryBuilder;
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    return { from: fromMock } as unknown as SupabaseClient<Database>;
  }

  describe('updateTask dependency checks', () => {
    it('blocks transitioning to "done" when prerequisite dependencies are incomplete', async () => {
      const mockSupabase = createMockSupabase({
        dependencies: [{ depends_on_task_id: prereqTaskId }],
        incompletePrereqs: [{ id: prereqTaskId, title: 'Prerequisite Task A', status: 'in_progress' }],
      });

      await expect(
        updateTask(mockSupabase, wsId, taskId, { status: 'done' })
      ).rejects.toThrow(/Cannot complete task while prerequisite dependencies are incomplete: Prerequisite Task A/);
    });

    it('allows transitioning to "done" when all prerequisite dependencies are satisfied (none incomplete)', async () => {
      const mockSupabase = createMockSupabase({
        dependencies: [{ depends_on_task_id: prereqTaskId }],
        incompletePrereqs: [], // 0 incomplete prerequisites
      });

      const result = await updateTask(mockSupabase, wsId, taskId, { status: 'done' });
      expect(result.status).toBe('done');
    });

    it('allows transitioning to "in_progress" even if prerequisite dependencies are incomplete', async () => {
      const mockSupabase = createMockSupabase({
        dependencies: [{ depends_on_task_id: prereqTaskId }],
        incompletePrereqs: [{ id: prereqTaskId, title: 'Prerequisite Task A', status: 'in_progress' }],
        updatedTask: {
          id: taskId,
          workspace_id: wsId,
          title: 'Target Task',
          status: 'in_progress',
          priority: 'medium',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          projects: null,
        },
      });

      const result = await updateTask(mockSupabase, wsId, taskId, { status: 'in_progress' });
      expect(result.status).toBe('in_progress');
    });
  });

  describe('completeTask dependency checks', () => {
    it('blocks completeTask when prerequisite dependencies are incomplete', async () => {
      const mockSupabase = createMockSupabase({
        currentTask: {
          id: taskId,
          workspace_id: wsId,
          title: 'Blocked Task',
          status: 'todo',
          recurrence_rule_id: null,
        },
        dependencies: [{ depends_on_task_id: prereqTaskId }],
        incompletePrereqs: [{ id: prereqTaskId, title: 'Draft Spec', status: 'todo' }],
      });

      await expect(completeTask(mockSupabase, wsId, taskId)).rejects.toThrow(
        /Cannot complete task while prerequisite dependencies are incomplete: Draft Spec/
      );
    });

    it('allows completeTask when all prerequisite dependencies are completed', async () => {
      const mockSupabase = createMockSupabase({
        currentTask: {
          id: taskId,
          workspace_id: wsId,
          title: 'Unblocked Task',
          status: 'in_progress',
          recurrence_rule_id: null,
        },
        dependencies: [{ depends_on_task_id: prereqTaskId }],
        incompletePrereqs: [],
        updatedTask: {
          id: taskId,
          workspace_id: wsId,
          title: 'Unblocked Task',
          status: 'done',
          priority: 'medium',
          recurrence_rule_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          projects: null,
        },
      });

      const result = await completeTask(mockSupabase, wsId, taskId);
      expect(result.completedTask.status).toBe('done');
    });
  });
});
