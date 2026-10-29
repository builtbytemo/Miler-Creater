import { describe, it, expect, vi } from 'vitest';
import { getTaskById } from '../src/lib/services/task-service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';

describe('getTaskById Service Layer Subtask Query & Hierarchy', () => {
  const wsId = '11111111-1111-1111-1111-111111111111';
  const parentId = '22222222-2222-2222-2222-222222222222';
  const childId1 = '33333333-3333-3333-3333-333333333333';
  const childId2 = '44444444-4444-4444-4444-444444444444';
  const grandChildId = '55555555-5555-5555-5555-555555555555';

  function createMockSupabase(options: {
    parentTask: Record<string, unknown>;
    childTasks: Record<string, unknown>[];
    nestedTasks?: Record<string, unknown>[];
    dependencies?: Record<string, unknown>[];
  }) {
    const fromMock = vi.fn((table: string) => {
      if (table === 'tasks') {
        const queryBuilder: Record<string, unknown> = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({
            data: options.parentTask,
            error: null,
          })),
        };

        // When querying for subtasks: select('*').eq('workspace_id', ...).eq('parent_task_id', taskId).order(...)
        // When querying for nested subtasks: select('id, parent_task_id, status').in('parent_task_id', subtaskIds)
        queryBuilder.order = vi.fn().mockImplementation(async () => ({
          data: options.childTasks,
          error: null,
        }));

        queryBuilder.in = vi.fn().mockImplementation(async () => ({
          data: options.nestedTasks || [],
          error: null,
        }));

        return queryBuilder;
      }

      if (table === 'task_dependencies') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: options.dependencies || [], error: null }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    return { from: fromMock } as unknown as SupabaseClient<Database>;
  }

  it('fetches parent task and all child deliverables with accurate completed/total counts', async () => {
    const mockSupabase = createMockSupabase({
      parentTask: {
        id: parentId,
        workspace_id: wsId,
        title: 'Master Task',
        status: 'in_progress',
        priority: 'high',
        created_at: '2026-10-28T10:00:00Z',
        updated_at: '2026-10-28T10:00:00Z',
        projects: null,
      },
      childTasks: [
        {
          id: childId1,
          workspace_id: wsId,
          parent_task_id: parentId,
          title: 'Subtask 1',
          status: 'done',
          priority: 'medium',
          created_at: '2026-10-28T10:05:00Z',
          updated_at: '2026-10-28T10:15:00Z',
        },
        {
          id: childId2,
          workspace_id: wsId,
          parent_task_id: parentId,
          title: 'Subtask 2',
          status: 'todo',
          priority: 'medium',
          created_at: '2026-10-28T10:10:00Z',
          updated_at: '2026-10-28T10:10:00Z',
        },
      ],
      nestedTasks: [
        {
          id: grandChildId,
          parent_task_id: childId2,
          status: 'todo',
        },
      ],
      dependencies: [],
    });

    const result = await getTaskById(mockSupabase, wsId, parentId);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(parentId);
    expect(result?.subtask_count).toBe(2);
    expect(result?.completed_subtask_count).toBe(1);
    expect(result?.subtasks).toHaveLength(2);

    expect(result?.subtasks[0]?.id).toBe(childId1);
    expect(result?.subtasks[0]?.title).toBe('Subtask 1');
    expect(result?.subtasks[0]?.status).toBe('done');

    expect(result?.subtasks[1]?.id).toBe(childId2);
    expect(result?.subtasks[1]?.title).toBe('Subtask 2');
    expect(result?.subtasks[1]?.status).toBe('todo');
    // Nested grandchild counted on childId2
    expect(result?.subtasks[1]?.subtask_count).toBe(1);
    expect(result?.subtasks[1]?.completed_subtask_count).toBe(0);
  });
});
