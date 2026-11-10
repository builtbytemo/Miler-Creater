import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, TaskStatus, TaskPriority } from '@/types/database';
import {
  completeTask,
  updateTask,
  skipTaskOccurrence,
  createTask,
} from '@/lib/services/task-service';

interface MockTaskRow {
  id: string;
  workspace_id: string;
  parent_task_id: string | null;
  project_id: string | null;
  milestone_id: string | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  scheduled_start: string | null;
  scheduled_end: string | null;
  due_date: string | null;
  estimated_duration_minutes: number | null;
  is_all_day: boolean;
  completed_at: string | null;
  tags: string[];
  recurrence_rule_id: string | null;
  occurrence_index: number | null;
  created_by: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  created_from?: 'tasks' | 'calendar';
}

interface MockRuleRow {
  id: string;
  workspace_id: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  by_weekday: number[] | null;
  by_monthday: number[] | null;
  until_date: string | null;
  count: number | null;
  timezone: string;
  dtstart: string | null;
  total_occurrences_generated: number;
  created_at: string;
  updated_at: string;
}

interface MockDepRow {
  id: string;
  workspace_id: string;
  task_id: string;
  depends_on_task_id: string;
  dependency_type: string;
}

function createMockDatabase() {
  const tasks = new Map<string, MockTaskRow>();
  const rules = new Map<string, MockRuleRow>();
  const deps = new Map<string, MockDepRow>();

  function createClient(options?: {
    simulateRpcFailure?: boolean;
    simulateRpcMissing?: boolean;
    simulateInsertFailure?: boolean;
    simulateConcurrencyDelay?: boolean;
  }): SupabaseClient<Database> {
    return {
      rpc: vi.fn(async (funcName: string, args: Record<string, unknown>) => {
        if (funcName !== 'complete_task_transactional') {
          return { data: null, error: { code: '42883', message: 'Function not found' } };
        }

        if (options?.simulateRpcMissing) {
          return { data: null, error: { code: 'PGRST202', message: 'Could not find function in schema cache' } };
        }

        if (options?.simulateRpcFailure) {
          return { data: null, error: { code: 'XX000', message: 'Internal transaction rollback simulated' } };
        }

        const taskId = args.p_task_id as string;
        const wsId = args.p_workspace_id as string;
        const task = tasks.get(taskId);

        if (!task || task.workspace_id !== wsId) {
          return { data: null, error: { message: `Task ${taskId} not found in workspace ${wsId}` } };
        }

        // Idempotency: already done
        if (task.status === 'done') {
          let existingActiveId: string | null = null;
          if (task.recurrence_rule_id) {
            for (const t of tasks.values()) {
              if (
                t.workspace_id === wsId &&
                t.recurrence_rule_id === task.recurrence_rule_id &&
                t.id !== task.id &&
                t.status !== 'done' &&
                t.status !== 'cancelled'
              ) {
                existingActiveId = t.id;
                break;
              }
            }
          }
          return {
            data: {
              success: true,
              already_completed: true,
              completed_task_id: task.id,
              next_task_id: existingActiveId,
            },
            error: null,
          };
        }

        if (task.status === 'cancelled') {
          return { data: null, error: { message: `Cannot complete a cancelled task: ${taskId}` } };
        }

        // Check dependencies
        for (const dep of deps.values()) {
          if (dep.workspace_id === wsId && dep.task_id === taskId) {
            const prereq = tasks.get(dep.depends_on_task_id);
            if (prereq && prereq.status !== 'done') {
              return {
                data: null,
                error: {
                  message: `Cannot complete task while prerequisite dependencies are incomplete: ${prereq.title}`,
                },
              };
            }
          }
        }

        // Concurrency guard: check active
        let existingActiveId: string | null = null;
        if (task.recurrence_rule_id) {
          for (const t of tasks.values()) {
            if (
              t.workspace_id === wsId &&
              t.recurrence_rule_id === task.recurrence_rule_id &&
              t.id !== task.id &&
              t.status !== 'done' &&
              t.status !== 'cancelled'
            ) {
              existingActiveId = t.id;
              break;
            }
          }
        }

        const now = (args.p_now as string) || new Date().toISOString();
        task.status = 'done';
        task.completed_at = now;
        task.updated_at = now;

        let nextTaskId: string | null = null;
        if (
          task.recurrence_rule_id &&
          (args.p_next_scheduled_start || args.p_next_due_date) &&
          !existingActiveId
        ) {
          nextTaskId = crypto.randomUUID();
          const nextRow: MockTaskRow = {
            id: nextTaskId,
            workspace_id: wsId,
            parent_task_id: null,
            project_id: task.project_id,
            milestone_id: task.milestone_id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            status: 'todo',
            scheduled_start: (args.p_next_scheduled_start as string) || null,
            scheduled_end: (args.p_next_scheduled_end as string) || null,
            due_date: (args.p_next_due_date as string) || null,
            estimated_duration_minutes: task.estimated_duration_minutes,
            is_all_day: task.is_all_day,
            completed_at: null,
            tags: [...task.tags],
            recurrence_rule_id: task.recurrence_rule_id,
            occurrence_index: (args.p_next_occurrence_index as number) || 2,
            created_by: (args.p_completed_by as string) || task.created_by,
            assigned_to: task.assigned_to,
            created_at: now,
            updated_at: now,
          };
          tasks.set(nextTaskId, nextRow);

          // Subtasks cloning
          for (const sub of tasks.values()) {
            if (sub.workspace_id === wsId && sub.parent_task_id === taskId) {
              const subId = crypto.randomUUID();
              tasks.set(subId, {
                id: subId,
                workspace_id: wsId,
                parent_task_id: nextTaskId,
                project_id: sub.project_id,
                milestone_id: sub.milestone_id,
                title: sub.title,
                description: sub.description,
                priority: sub.priority,
                status: 'todo',
                scheduled_start: null,
                scheduled_end: null,
                due_date: null,
                estimated_duration_minutes: sub.estimated_duration_minutes,
                is_all_day: sub.is_all_day,
                completed_at: null,
                tags: [...sub.tags],
                recurrence_rule_id: null,
                occurrence_index: null,
                created_by: sub.created_by,
                assigned_to: sub.assigned_to,
                created_at: now,
                updated_at: now,
              });
            }
          }

          // Update recurrence_rule total_occurrences_generated
          const rule = rules.get(task.recurrence_rule_id);
          if (rule) {
            rule.total_occurrences_generated = Math.max(
              rule.total_occurrences_generated,
              (args.p_next_occurrence_index as number) || 2
            );
            rule.updated_at = now;
          }
        } else if (existingActiveId) {
          nextTaskId = existingActiveId;
        }

        return {
          data: {
            success: true,
            already_completed: false,
            completed_task_id: task.id,
            next_task_id: nextTaskId,
          },
          error: null,
        };
      }) as unknown as SupabaseClient<Database>['rpc'],

      from: vi.fn((table: string) => {
        const filters: Record<string, unknown> = {};
        const notFilters: Record<string, unknown> = {};

        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn((field: string, val: unknown) => {
            filters[field] = val;
            return chain;
          }),
          neq: vi.fn((field: string, val: unknown) => {
            filters[`_neq_${field}`] = val;
            return chain;
          }),
          in: vi.fn((field: string, vals: unknown[]) => {
            filters[`_in_${field}`] = vals;
            return chain;
          }),
          not: vi.fn((field: string, op: string, val: unknown) => {
            notFilters[field] = { op, val };
            return chain;
          }),
          order: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          update: vi.fn((updates: Record<string, unknown>) => {
            const doUpdate = (f1: string, v1: unknown, f2?: string, v2?: unknown) => {
              const taskId = (f1 === 'id' ? v1 : f2 === 'id' ? v2 : v1) as string;
              const wsId = (f1 === 'workspace_id' ? v1 : f2 === 'workspace_id' ? v2 : null) as string | null;
              const task = tasks.get(taskId);
              if (task && (!wsId || task.workspace_id === wsId)) {
                Object.assign(task, updates, { updated_at: new Date().toISOString() });
              }
              return task;
            };

            return {
              eq: vi.fn((f1: string, v1: unknown) => ({
                eq: vi.fn((f2: string, v2: unknown) => ({
                  select: vi.fn(() => ({
                    single: vi.fn(async () => {
                      const task = doUpdate(f1, v1, f2, v2);
                      if (!task) return { data: null, error: { message: 'Not found' } };
                      return { data: { ...task }, error: null };
                    }),
                  })),
                  then: (resolve: (v: unknown) => void) => {
                    const task = doUpdate(f1, v1, f2, v2);
                    resolve({ data: task ? { ...task } : null, error: null });
                  },
                })),
                select: vi.fn(() => ({
                  single: vi.fn(async () => {
                    const id = v1 as string;
                    if (table === 'recurrence_rules') {
                      const rule = rules.get(id);
                      if (rule) Object.assign(rule, updates);
                      return { data: rule ? { ...rule } : null, error: null };
                    }
                    const task = tasks.get(id);
                    if (task) Object.assign(task, updates);
                    return { data: task ? { ...task } : null, error: null };
                  }),
                })),
                then: (resolve: (v: unknown) => void) => {
                  const id = v1 as string;
                  if (table === 'recurrence_rules') {
                    const rule = rules.get(id);
                    if (rule) Object.assign(rule, updates);
                    resolve({ data: rule ? { ...rule } : null, error: null });
                    return;
                  }
                  const task = tasks.get(id);
                  if (task) Object.assign(task, updates);
                  resolve({ data: task ? { ...task } : null, error: null });
                },
              })),
            };
          }),
          insert: vi.fn((rows: Record<string, unknown> | Record<string, unknown>[]) => {
            const rowList = Array.isArray(rows) ? rows : [rows];
            if (table === 'tasks' && options?.simulateInsertFailure && rowList.some((r) => ((r.occurrence_index as number) || 0) > 1)) {
              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: null,
                    error: { code: '23505', message: 'duplicate key value violates unique constraint uq_active_task_per_recurrence' },
                  })),
                })),
                then: (resolve: (v: unknown) => void) =>
                  resolve({
                    data: null,
                    error: { code: '23505', message: 'duplicate key value violates unique constraint uq_active_task_per_recurrence' },
                  }),
              };
            }

            const inserted: unknown[] = [];
            for (const r of rowList) {
              if (table === 'recurrence_rules') {
                const id = (r.id as string) || crypto.randomUUID();
                const newRule: MockRuleRow = {
                  id,
                  workspace_id: r.workspace_id as string,
                  frequency: r.frequency as 'daily' | 'weekly' | 'monthly' | 'yearly',
                  interval: (r.interval as number) || 1,
                  by_weekday: (r.by_weekday as number[]) || null,
                  by_monthday: (r.by_monthday as number[]) || null,
                  until_date: (r.until_date as string) || null,
                  count: (r.count as number) || null,
                  timezone: (r.timezone as string) || 'Asia/Cairo',
                  dtstart: (r.dtstart as string) || null,
                  total_occurrences_generated: (r.total_occurrences_generated as number) || 1,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                };
                rules.set(id, newRule);
                inserted.push(newRule);
              } else if (table === 'tasks') {
                // Check unique constraint uq_active_task_per_recurrence
                if (r.recurrence_rule_id && r.status !== 'done' && r.status !== 'cancelled') {
                  for (const existing of tasks.values()) {
                    if (
                      existing.workspace_id === r.workspace_id &&
                      existing.recurrence_rule_id === r.recurrence_rule_id &&
                      existing.status !== 'done' &&
                      existing.status !== 'cancelled'
                    ) {
                      return {
                        select: vi.fn(() => ({
                          single: vi.fn(async () => ({
                            data: null,
                            error: { code: '23505', message: 'duplicate key value violates unique constraint uq_active_task_per_recurrence' },
                          })),
                        })),
                        then: (resolve: (v: unknown) => void) =>
                          resolve({
                            data: null,
                            error: { code: '23505', message: 'duplicate key value violates unique constraint uq_active_task_per_recurrence' },
                          }),
                      };
                    }
                  }
                }

                const id = (r.id as string) || crypto.randomUUID();
                const newTask: MockTaskRow = {
                  id,
                  workspace_id: r.workspace_id as string,
                  parent_task_id: (r.parent_task_id as string) || null,
                  project_id: (r.project_id as string) || null,
                  milestone_id: (r.milestone_id as string) || null,
                  title: r.title as string,
                  description: (r.description as string) || null,
                  priority: (r.priority as TaskPriority) || 'medium',
                  status: (r.status as TaskStatus) || 'todo',
                  scheduled_start: (r.scheduled_start as string) || null,
                  scheduled_end: (r.scheduled_end as string) || null,
                  due_date: (r.due_date as string) || null,
                  estimated_duration_minutes: (r.estimated_duration_minutes as number) || null,
                  is_all_day: Boolean(r.is_all_day),
                  completed_at: (r.completed_at as string) || null,
                  tags: (r.tags as string[]) || [],
                  recurrence_rule_id: (r.recurrence_rule_id as string) || null,
                  occurrence_index: (r.occurrence_index as number) || null,
                  created_by: (r.created_by as string) || null,
                  assigned_to: (r.assigned_to as string) || null,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  created_from: (r.created_from as 'tasks' | 'calendar') || 'tasks',
                };
                tasks.set(id, newTask);
                inserted.push(newTask);
              }
            }

            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({ data: inserted[0], error: null })),
              })),
              then: (resolve: (v: unknown) => void) => resolve({ data: inserted, error: null }),
            };
          }),
          single: vi.fn(async () => {
            if (table === 'recurrence_rules') {
              const rule = rules.get(filters['id'] as string);
              return { data: rule ? { ...rule } : null, error: rule ? null : { message: 'Rule not found' } };
            }
            if (table === 'tasks') {
              const task = tasks.get(filters['id'] as string);
              if (!task) return { data: null, error: { message: 'Task not found' } };
              if (filters['workspace_id'] && task.workspace_id !== filters['workspace_id']) {
                return { data: null, error: { message: 'Cross-workspace mismatch' } };
              }
              return { data: { ...task }, error: null };
            }
            return { data: null, error: null };
          }),
          maybeSingle: vi.fn(async () => {
            if (table === 'tasks') {
              for (const t of tasks.values()) {
                if (filters['workspace_id'] && t.workspace_id !== filters['workspace_id']) continue;
                if (filters['recurrence_rule_id'] && t.recurrence_rule_id !== filters['recurrence_rule_id']) continue;
                if (filters['id'] && t.id !== filters['id']) continue;
                if (filters['_neq_id'] && t.id === filters['_neq_id']) continue;
                if (notFilters['status'] && (t.status === 'done' || t.status === 'cancelled')) continue;
                return { data: { ...t }, error: null };
              }
            }
            return { data: null, error: null };
          }),
          then: (resolve: (v: unknown) => void) => {
            if (table === 'task_dependencies') {
              const matched: MockDepRow[] = [];
              for (const d of deps.values()) {
                if (filters['workspace_id'] && d.workspace_id !== filters['workspace_id']) continue;
                if (filters['task_id'] && d.task_id !== filters['task_id']) continue;
                matched.push({ ...d });
              }
              resolve({ data: matched, error: null });
              return;
            }
            if (table === 'tasks') {
              const matched: MockTaskRow[] = [];
              for (const t of tasks.values()) {
                if (filters['workspace_id'] && t.workspace_id !== filters['workspace_id']) continue;
                if (filters['parent_task_id'] && t.parent_task_id !== filters['parent_task_id']) continue;
                if (filters['_in_id'] && !(filters['_in_id'] as string[]).includes(t.id)) continue;
                if (filters['_neq_status'] && t.status === filters['_neq_status']) continue;
                matched.push({ ...t });
              }
              resolve({ data: matched, error: null });
              return;
            }
            resolve({ data: [], error: null });
          },
        };

        return chain;
      }) as unknown as SupabaseClient<Database>['from'],
    } as unknown as SupabaseClient<Database>;
  }

  return {
    tasks,
    rules,
    deps,
    createClient,
  };
}

describe('Recurring Task Atomic Completion and Lifecycle Suite (Stage 3)', () => {
  const ws1 = '11111111-1111-1111-1111-111111111111';
  const ws2 = '22222222-2222-2222-2222-222222222222';
  const userId = 'usr-stage3';

  let db: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    db = createMockDatabase();
  });

  describe('1. Authoritative Completion Routing & Bypass Prevention', () => {
    it('routes updateTask with status: "done" through completeTask to generate next occurrence', async () => {
      const client = db.createClient();

      // Create recurring task
      const created = await createTask(
        client,
        ws1,
        {
          title: 'Daily Standup',
          priority: 'high',
          status: 'todo',
          scheduled_start: '2026-11-15T07:00:00Z',
          scheduled_end: '2026-11-15T07:30:00Z',
          recurrence: {
            frequency: 'daily',
            interval: 1,
            timezone: 'Asia/Cairo',
          },
        },
        userId
      );

      expect(created.recurrence_rule_id).not.toBeNull();

      // Complete via updateTask instead of completeTask
      const updated = await updateTask(client, ws1, created.id, {
        status: 'done',
        title: 'Daily Standup (Finished)',
      });

      expect(updated.status).toBe('done');
      expect(updated.completed_at).not.toBeNull();

      // Verify next occurrence was generated
      const activeOccurrences = Array.from(db.tasks.values()).filter(
        (t) => t.recurrence_rule_id === created.recurrence_rule_id && t.status !== 'done'
      );

      expect(activeOccurrences).toHaveLength(1);
      const nextOcc = activeOccurrences[0];
      expect(nextOcc.status).toBe('todo');
      expect(nextOcc.occurrence_index).toBe(2);
      expect(nextOcc.title).toBe('Daily Standup (Finished)');
    });
  });

  describe('2. Concurrency, Idempotency & Duplicate Prevention', () => {
    it('prevents duplicate active occurrences when two simultaneous completion requests occur', async () => {
      const client = db.createClient();

      const created = await createTask(
        client,
        ws1,
        {
          title: 'Weekly Sync',
          priority: 'medium',
          status: 'todo',
          scheduled_start: '2026-11-20T10:00:00Z',
          recurrence: {
            frequency: 'weekly',
            interval: 1,
            timezone: 'Asia/Cairo',
          },
        },
        userId
      );

      // Execute two simultaneous completion calls
      const [res1, res2] = await Promise.all([
        completeTask(client, ws1, created.id, userId),
        completeTask(client, ws1, created.id, userId),
      ]);

      expect(res1.completedTask.status).toBe('done');
      expect(res2.completedTask.status).toBe('done');

      // Both must agree on the next occurrence ID without duplicating
      expect(res1.nextOccurrence?.id).toBe(res2.nextOccurrence?.id);

      const allActive = Array.from(db.tasks.values()).filter(
        (t) => t.recurrence_rule_id === created.recurrence_rule_id && t.status !== 'done'
      );
      expect(allActive).toHaveLength(1);
    });

    it('is idempotent on repeated completion requests and retries after network interruptions', async () => {
      const client = db.createClient();

      const created = await createTask(
        client,
        ws1,
        {
          title: 'Monthly Invoicing',
          priority: 'high',
          status: 'todo',
          due_date: '2026-11-30T17:00:00Z',
          recurrence: {
            frequency: 'monthly',
            interval: 1,
            timezone: 'Asia/Cairo',
          },
        },
        userId
      );

      // First completion call
      const firstRes = await completeTask(client, ws1, created.id, userId);
      expect(firstRes.completedTask.status).toBe('done');
      expect(firstRes.nextOccurrence).not.toBeNull();
      const spawnedId = firstRes.nextOccurrence!.id;

      // Repeated retry (e.g. client timeout or network retry)
      const retryRes = await completeTask(client, ws1, created.id, userId);
      expect(retryRes.completedTask.status).toBe('done');
      expect(retryRes.nextOccurrence?.id).toBe(spawnedId);

      // Third retry
      const thirdRes = await completeTask(client, ws1, created.id, userId);
      expect(thirdRes.nextOccurrence?.id).toBe(spawnedId);

      const occurrences = Array.from(db.tasks.values()).filter(
        (t) => t.recurrence_rule_id === created.recurrence_rule_id
      );
      // Exactly 1 completed task and 1 active task
      expect(occurrences).toHaveLength(2);
    });
  });

  describe('3. Transaction Safety & Fallback Resilience', () => {
    it('gracefully falls back to atomic application execution when RPC is unavailable (PGRST202)', async () => {
      const clientWithRpcMissing = db.createClient({ simulateRpcMissing: true });

      const created = await createTask(
        clientWithRpcMissing,
        ws1,
        {
          title: 'Daily Review',
          priority: 'low',
          status: 'todo',
          scheduled_start: '2026-11-12T08:00:00Z',
          recurrence: {
            frequency: 'daily',
            interval: 1,
            timezone: 'Asia/Cairo',
          },
        },
        userId
      );

      const res = await completeTask(clientWithRpcMissing, ws1, created.id, userId);
      expect(res.completedTask.status).toBe('done');
      expect(res.nextOccurrence).not.toBeNull();
      expect(res.nextOccurrence?.status).toBe('todo');
    });

    it('safely catches unique index collision (23505) and returns existing active occurrence without error', async () => {
      const clientWithConflict = db.createClient({
        simulateRpcMissing: true,
        simulateInsertFailure: true,
      });

      const created = await createTask(
        clientWithConflict,
        ws1,
        {
          title: 'Conflict Task',
          priority: 'low',
          status: 'todo',
          scheduled_start: '2026-11-12T08:00:00Z',
          recurrence: {
            frequency: 'daily',
            interval: 1,
            timezone: 'Asia/Cairo',
          },
        },
        userId
      );

      // When an active occurrence already exists in DB
      const preExistingId = crypto.randomUUID();
      const existingActive: MockTaskRow = {
        id: preExistingId,
        workspace_id: ws1,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Conflict Task',
        description: null,
        priority: 'low',
        status: 'todo',
        scheduled_start: '2026-11-13T08:00:00Z',
        scheduled_end: null,
        due_date: null,
        estimated_duration_minutes: null,
        is_all_day: false,
        completed_at: null,
        tags: [],
        recurrence_rule_id: created.recurrence_rule_id,
        occurrence_index: 2,
        created_by: userId,
        assigned_to: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      db.tasks.set(preExistingId, existingActive);

      const res = await completeTask(clientWithConflict, ws1, created.id, userId);
      expect(res.completedTask.status).toBe('done');
      expect(res.nextOccurrence?.id).toBe(preExistingId);
    });
  });

  describe('4. Subtask Template Inheritance', () => {
    it('clones subtasks into fresh incomplete subtasks attached to the new occurrence', async () => {
      const client = db.createClient();

      // Create parent recurring task
      const parent = await createTask(
        client,
        ws1,
        {
          title: 'Sprint Planning',
          priority: 'urgent',
          status: 'todo',
          scheduled_start: '2026-11-16T09:00:00Z',
          recurrence: {
            frequency: 'weekly',
            interval: 2,
            timezone: 'Asia/Cairo',
          },
        },
        userId
      );

      // Create 2 subtasks under parent
      const sub1 = await createTask(
        client,
        ws1,
        {
          title: 'Review backlog',
          priority: 'medium',
          status: 'done', // Already done on current occurrence
          parent_task_id: parent.id,
        },
        userId
      );

      const sub2 = await createTask(
        client,
        ws1,
        {
          title: 'Assign story points',
          priority: 'high',
          status: 'todo',
          parent_task_id: parent.id,
        },
        userId
      );

      expect(sub1.id).toBeDefined();
      expect(sub2.id).toBeDefined();

      // Complete the parent recurring task
      const res = await completeTask(client, ws1, parent.id, userId);
      expect(res.nextOccurrence).not.toBeNull();
      const nextParentId = res.nextOccurrence!.id;

      // Query subtasks attached to next occurrence
      const nextSubtasks = Array.from(db.tasks.values()).filter(
        (t) => t.parent_task_id === nextParentId
      );

      expect(nextSubtasks).toHaveLength(2);

      const clonedSub1 = nextSubtasks.find((s) => s.title === 'Review backlog');
      const clonedSub2 = nextSubtasks.find((s) => s.title === 'Assign story points');

      expect(clonedSub1).toBeDefined();
      expect(clonedSub2).toBeDefined();

      // Crucial: subtask status MUST be reset to fresh 'todo' even if previous subtask was 'done'!
      expect(clonedSub1!.status).toBe('todo');
      expect(clonedSub1!.completed_at).toBeNull();
      expect(clonedSub1!.recurrence_rule_id).toBeNull(); // Subtasks must not have recurrence

      expect(clonedSub2!.status).toBe('todo');
      expect(clonedSub2!.completed_at).toBeNull();
      expect(clonedSub2!.recurrence_rule_id).toBeNull();
    });
  });

  describe('5. Prerequisite Dependencies & Cross-Workspace Authorization', () => {
    it('blocks completeTask when prerequisite dependencies are incomplete', async () => {
      const client = db.createClient();

      const prereq = await createTask(
        client,
        ws1,
        {
          title: 'Prerequisite Task',
          status: 'in_progress',
        },
        userId
      );

      const target = await createTask(
        client,
        ws1,
        {
          title: 'Dependent Recurring Task',
          status: 'todo',
          scheduled_start: '2026-11-15T09:00:00Z',
          recurrence: {
            frequency: 'daily',
            interval: 1,
            timezone: 'Asia/Cairo',
          },
        },
        userId
      );

      // Add dependency
      db.deps.set('dep-1', {
        id: 'dep-1',
        workspace_id: ws1,
        task_id: target.id,
        depends_on_task_id: prereq.id,
        dependency_type: 'finish_to_start',
      });

      await expect(completeTask(client, ws1, target.id, userId)).rejects.toThrow(
        /Cannot complete task while prerequisite dependencies are incomplete/
      );
    });

    it('rejects cross-workspace completion requests', async () => {
      const client = db.createClient();

      const taskInWs1 = await createTask(
        client,
        ws1,
        {
          title: 'Workspace 1 Task',
          status: 'todo',
        },
        userId
      );

      // Attempting to complete task from ws2
      await expect(completeTask(client, ws2, taskInWs1.id, userId)).rejects.toThrow(
        /Task not found/
      );
    });
  });

  describe('6. Late Completion, Overdue Skip-Slot & Termination Boundaries', () => {
    it('skips missed slots on overdue completion and decrements remaining count correctly', async () => {
      const client = db.createClient();

      // Daily task scheduled for 10 days ago with count: 5
      const ruleRow: MockRuleRow = {
        id: 'rule-count-5',
        workspace_id: ws1,
        frequency: 'daily',
        interval: 1,
        by_weekday: null,
        by_monthday: null,
        until_date: null,
        count: 5,
        timezone: 'Asia/Cairo',
        dtstart: '2026-11-01T07:00:00Z',
        total_occurrences_generated: 1,
        created_at: '2026-11-01T07:00:00Z',
        updated_at: '2026-11-01T07:00:00Z',
      };
      db.rules.set('rule-count-5', ruleRow);

      const taskRow: MockTaskRow = {
        id: 'task-overdue-1',
        workspace_id: ws1,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Daily Medication',
        description: null,
        priority: 'urgent',
        status: 'todo',
        scheduled_start: '2026-11-01T07:00:00Z',
        scheduled_end: '2026-11-01T07:15:00Z',
        due_date: null,
        estimated_duration_minutes: 15,
        is_all_day: false,
        completed_at: null,
        tags: [],
        recurrence_rule_id: 'rule-count-5',
        occurrence_index: 1,
        created_by: userId,
        assigned_to: null,
        created_at: '2026-11-01T07:00:00Z',
        updated_at: '2026-11-01T07:00:00Z',
      };
      db.tasks.set('task-overdue-1', taskRow);

      // Complete it when count limit was already exhausted by elapsed days
      // (10 days elapsed > count of 5)
      const res = await completeTask(client, ws1, 'task-overdue-1', userId);

      expect(res.completedTask.status).toBe('done');
      // Count was exhausted by skipped slots; no next occurrence should be provisioned
      expect(res.nextOccurrence).toBeNull();
    });

    it('terminates recurrence series without creating next occurrence on final occurrence count', async () => {
      const client = db.createClient();

      const created = await createTask(
        client,
        ws1,
        {
          title: 'Two-occurrence series',
          status: 'todo',
          scheduled_start: '2026-12-01T10:00:00Z',
          recurrence: {
            frequency: 'daily',
            interval: 1,
            count: 2,
            timezone: 'Asia/Cairo',
          },
        },
        userId
      );

      // Complete occurrence 1 -> produces occurrence 2
      const res1 = await completeTask(client, ws1, created.id, userId);
      expect(res1.nextOccurrence).not.toBeNull();
      expect(res1.nextOccurrence!.occurrence_index).toBe(2);

      // Complete occurrence 2 -> final occurrence!
      const res2 = await completeTask(client, ws1, res1.nextOccurrence!.id, userId);
      expect(res2.completedTask.status).toBe('done');
      expect(res2.nextOccurrence).toBeNull(); // Series finished!
    });
  });

  describe('7. Reopening & Skipping Safety Invariants', () => {
    it('reopening a completed task detaches recurrence rule if active occurrence already exists', async () => {
      const client = db.createClient();

      const created = await createTask(
        client,
        ws1,
        {
          title: 'Weekly Report',
          status: 'todo',
          scheduled_start: '2026-11-15T09:00:00Z',
          recurrence: {
            frequency: 'weekly',
            interval: 1,
            timezone: 'Asia/Cairo',
          },
        },
        userId
      );

      // Complete task: creates next active occurrence
      const completeRes = await completeTask(client, ws1, created.id, userId);
      expect(completeRes.nextOccurrence).not.toBeNull();

      // Now user reopens the completed task back to "todo"
      const reopened = await updateTask(client, ws1, created.id, {
        status: 'todo',
      });

      expect(reopened.status).toBe('todo');
      expect(reopened.completed_at).toBeNull();
      // Crucial: recurrence_rule_id must be detached to preserve uq_active_task_per_recurrence!
      expect(reopened.recurrence_rule_id).toBeNull();

      // The next occurrence remains active and keeps its recurrence rule!
      const activeOcc = db.tasks.get(completeRes.nextOccurrence!.id);
      expect(activeOcc?.status).toBe('todo');
      expect(activeOcc?.recurrence_rule_id).toBe(created.recurrence_rule_id);
    });

    it('skipTaskOccurrence cancels current occurrence and advances schedule to next occurrence', async () => {
      const client = db.createClient();

      const created = await createTask(
        client,
        ws1,
        {
          title: 'Biweekly Gardening',
          status: 'todo',
          scheduled_start: '2026-11-14T08:00:00Z',
          recurrence: {
            frequency: 'weekly',
            interval: 2,
            timezone: 'Asia/Cairo',
          },
        },
        userId
      );

      const skipRes = await skipTaskOccurrence(client, ws1, created.id, userId);

      expect(skipRes.cancelledTask.status).toBe('cancelled');
      expect(skipRes.cancelledTask.completed_at).toBeNull();

      expect(skipRes.nextOccurrence).not.toBeNull();
      expect(skipRes.nextOccurrence!.status).toBe('todo');
      expect(skipRes.nextOccurrence!.occurrence_index).toBe(2);
      expect(skipRes.nextOccurrence!.recurrence_rule_id).toBe(created.recurrence_rule_id);
    });
  });
});
