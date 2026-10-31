import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { createTask, updateTask } from '@/lib/services/task-service';

describe('Task Service Privileged Authorization & Cross-Workspace Integrity (Phase 7.4.1)', () => {
  const ws1 = '123e4567-e89b-12d3-a456-426614174001';
  const ws2 = '123e4567-e89b-12d3-a456-426614174002';
  const userId = '123e4567-e89b-12d3-a456-426614174010';

  // Workspace 1 resources
  const ws1ProjId = '123e4567-e89b-12d3-a456-426614174011';
  const ws1MileId = '123e4567-e89b-12d3-a456-426614174012';
  const ws1TaskId = '123e4567-e89b-12d3-a456-426614174013';

  // Workspace 2 resources (Foreign Workspace)
  const ws2ProjId = '123e4567-e89b-12d3-a456-426614174021';
  const ws2MileId = '123e4567-e89b-12d3-a456-426614174022';
  const ws2TaskId = '123e4567-e89b-12d3-a456-426614174023';

  interface MockDbState {
    projects: Map<string, { id: string; workspace_id: string; name: string }>;
    milestones: Map<string, { id: string; workspace_id: string; project_id: string }>;
    tasks: Map<string, { id: string; workspace_id: string; title: string; status: string }>;
  }

  let db: MockDbState;

  function createMockSupabase(): SupabaseClient<Database> {
    return {
      from: vi.fn((table: string) => {
        if (table === 'projects') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((f1: string, v1: string) => ({
                eq: vi.fn((f2: string, v2: string) => ({
                  maybeSingle: vi.fn(async () => {
                    const id = f1 === 'id' ? v1 : v2;
                    const ws = f1 === 'workspace_id' ? v1 : v2;
                    const p = db.projects.get(id);
                    if (p && p.workspace_id === ws) return { data: p, error: null };
                    return { data: null, error: null };
                  }),
                })),
              })),
            })),
          };
        }

        if (table === 'milestones') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((f1: string, v1: string) => ({
                eq: vi.fn((f2: string, v2: string) => ({
                  maybeSingle: vi.fn(async () => {
                    const id = f1 === 'id' ? v1 : v2;
                    const ws = f1 === 'workspace_id' ? v1 : v2;
                    const m = db.milestones.get(id);
                    if (m && m.workspace_id === ws) return { data: m, error: null };
                    return { data: null, error: null };
                  }),
                })),
              })),
            })),
          };
        }

        if (table === 'tasks') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((f1: string, v1: string) => ({
                eq: vi.fn((f2: string, v2: string) => ({
                  maybeSingle: vi.fn(async () => {
                    const id = f1 === 'id' ? v1 : v2;
                    const ws = f1 === 'workspace_id' ? v1 : v2;
                    const t = db.tasks.get(id);
                    if (t && t.workspace_id === ws) return { data: t, error: null };
                    return { data: null, error: null };
                  }),
                })),
              })),
            })),
            insert: vi.fn((payload: any) => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  const created = {
                    id: '123e4567-e89b-12d3-a456-426614174099',
                    ...payload,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    projects: payload.project_id ? { id: payload.project_id, name: 'Proj', color: '#000' } : null,
                  };
                  db.tasks.set(created.id, created);
                  return { data: created, error: null };
                }),
              })),
            })),
            update: vi.fn((updates: any) => ({
              eq: vi.fn((f1: string, v1: string) => ({
                eq: vi.fn((f2: string, v2: string) => ({
                  select: vi.fn(() => ({
                    single: vi.fn(async () => {
                      const id = f1 === 'id' ? v1 : v2;
                      const ws = f1 === 'workspace_id' ? v1 : v2;
                      const existing = db.tasks.get(id);
                      if (!existing || existing.workspace_id !== ws) {
                        return { data: null, error: { message: 'Task not found in workspace' } };
                      }
                      const updated = { ...existing, ...updates, projects: null };
                      db.tasks.set(id, updated);
                      return { data: updated, error: null };
                    }),
                  })),
                })),
              })),
            })),
          };
        }

        return {} as any;
      }),
    } as unknown as SupabaseClient<Database>;
  }

  beforeEach(() => {
    db = {
      projects: new Map([
        [ws1ProjId, { id: ws1ProjId, workspace_id: ws1, name: 'Workspace 1 Project' }],
        [ws2ProjId, { id: ws2ProjId, workspace_id: ws2, name: 'Workspace 2 Project' }],
      ]),
      milestones: new Map([
        [ws1MileId, { id: ws1MileId, workspace_id: ws1, project_id: ws1ProjId }],
        [ws2MileId, { id: ws2MileId, workspace_id: ws2, project_id: ws2ProjId }],
      ]),
      tasks: new Map([
        [ws1TaskId, { id: ws1TaskId, workspace_id: ws1, title: 'WS1 Task', status: 'todo' }],
        [ws2TaskId, { id: ws2TaskId, workspace_id: ws2, title: 'WS2 Task', status: 'todo' }],
      ]),
    };
  });

  describe('createTask foreign key workspace enforcement', () => {
    it('rejects cross-workspace project_id', async () => {
      const client = createMockSupabase();

      await expect(
        createTask(
          client,
          ws1,
          {
            title: 'Unauthorized Project Task',
            priority: 'medium',
            status: 'todo',
            is_all_day: false,
            tags: [],
            project_id: ws2ProjId, // Foreign workspace project!
          },
          userId
        )
      ).rejects.toThrow(/Cross-workspace reference rejected: project/i);
    });

    it('rejects cross-workspace milestone_id', async () => {
      const client = createMockSupabase();

      await expect(
        createTask(
          client,
          ws1,
          {
            title: 'Unauthorized Milestone Task',
            priority: 'medium',
            status: 'todo',
            is_all_day: false,
            tags: [],
            milestone_id: ws2MileId, // Foreign workspace milestone!
          },
          userId
        )
      ).rejects.toThrow(/Cross-workspace reference rejected: milestone/i);
    });

    it('rejects cross-workspace parent_task_id', async () => {
      const client = createMockSupabase();

      await expect(
        createTask(
          client,
          ws1,
          {
            title: 'Unauthorized Subtask',
            priority: 'medium',
            status: 'todo',
            is_all_day: false,
            tags: [],
            parent_task_id: ws2TaskId, // Foreign workspace parent!
          },
          userId
        )
      ).rejects.toThrow(/Cross-workspace reference rejected: parent task/i);
    });

    it('allows valid same-workspace project_id, milestone_id, and parent_task_id', async () => {
      const client = createMockSupabase();

      const created = await createTask(
        client,
        ws1,
        {
          title: 'Authorized Task',
          priority: 'high',
          status: 'todo',
          is_all_day: false,
          tags: [],
          project_id: ws1ProjId,
          milestone_id: ws1MileId,
          parent_task_id: ws1TaskId,
        },
        userId
      );

      expect(created.title).toBe('Authorized Task');
      expect(created.project_id).toBe(ws1ProjId);
      expect(created.milestone_id).toBe(ws1MileId);
      expect(created.parent_task_id).toBe(ws1TaskId);
    });
  });

  describe('updateTask foreign key workspace enforcement', () => {
    it('rejects updating with cross-workspace project_id', async () => {
      const client = createMockSupabase();

      await expect(
        updateTask(client, ws1, ws1TaskId, {
          project_id: ws2ProjId,
        })
      ).rejects.toThrow(/Cross-workspace reference rejected: project/i);
    });

    it('rejects updating with cross-workspace parent_task_id', async () => {
      const client = createMockSupabase();

      await expect(
        updateTask(client, ws1, ws1TaskId, {
          parent_task_id: ws2TaskId,
        })
      ).rejects.toThrow(/Cross-workspace reference rejected: parent task/i);
    });

    it('rejects updating a task to be its own parent', async () => {
      const client = createMockSupabase();

      await expect(
        updateTask(client, ws1, ws1TaskId, {
          parent_task_id: ws1TaskId,
        })
      ).rejects.toThrow(/A task cannot be its own parent/i);
    });

    it('allows updating with valid same-workspace project_id', async () => {
      const client = createMockSupabase();

      const updated = await updateTask(client, ws1, ws1TaskId, {
        project_id: ws1ProjId,
      });

      expect(updated.id).toBe(ws1TaskId);
      expect(updated.project_id).toBe(ws1ProjId);
    });
  });
});
