import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, TaskPriority, TaskStatus } from '@/types/database';
import {
  createTask,
  updateTask,
  getTaskById,
  type TaskWithMeta,
} from '@/lib/services/task-service';
import { getUnifiedSchedule } from '@/lib/services/scheduling-service';
import { dispatchTool } from '@/lib/mcp/dispatcher';
import { parseFriendlyCommand } from '../cli/commands.mjs';
import type { AIExecutionContext } from '@/lib/mcp/types';
import {
  createTaskAction,
  completeTaskAction,
  updateRecurrenceRuleAction,
} from '@/lib/actions/task-actions';

// Mock Next.js cache and headers
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// Mock server client
let activeSupabaseClient: SupabaseClient<Database> | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(activeSupabaseClient!)),
}));

// Mock admin client
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  })),
}));

// Mock notification domain event
vi.mock('@/lib/services/notification-service', () => ({
  notifyDomainEvent: vi.fn().mockResolvedValue({ id: 'mock-notif-1', status: 'delivered' }),
  getNotifications: vi.fn().mockResolvedValue([]),
  markNotificationAsRead: vi.fn().mockResolvedValue({ id: 'mock-notif-1', read_at: new Date().toISOString() }),
  markNotificationAsUnread: vi.fn().mockResolvedValue({ id: 'mock-notif-1', read_at: null }),
  markAllNotificationsAsRead: vi.fn().mockResolvedValue(1),
  dismissNotification: vi.fn().mockResolvedValue({ id: 'mock-notif-1', status: 'dismissed' }),
  getNotificationPreferences: vi.fn().mockResolvedValue({ lead_time_minutes: 15 }),
  saveNotificationPreferences: vi.fn().mockResolvedValue({ lead_time_minutes: 15 }),
}));

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

function createCrossInterfaceMockDatabase() {
  const tasks = new Map<string, MockTaskRow>();
  const rules = new Map<string, MockRuleRow>();

  function createClient(): SupabaseClient<Database> {
    return {
      from: vi.fn((table: string) => {
        const filters: Record<string, unknown> = {};
        const nullFilters: Record<string, boolean> = {};

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
          is: vi.fn((field: string, val: unknown) => {
            if (val === null) nullFilters[field] = true;
            return chain;
          }),
          not: vi.fn((field: string, op: string, val: unknown) => {
            if (op === 'in' && typeof val === 'string') {
              const cleaned = val.replace(/[()"]/g, '').split(',');
              filters[`_not_in_${field}`] = cleaned;
            }
            return chain;
          }),
          ilike: vi.fn(() => chain),
          gte: vi.fn((field: string, val: unknown) => {
            filters[`_gte_${field}`] = val;
            return chain;
          }),
          lte: vi.fn((field: string, val: unknown) => {
            filters[`_lte_${field}`] = val;
            return chain;
          }),
          gt: vi.fn((field: string, val: unknown) => {
            filters[`_gt_${field}`] = val;
            return chain;
          }),
          order: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          range: vi.fn(() => chain),

          insert: vi.fn((rows: unknown) => {
            const rowList = Array.isArray(rows) ? rows : [rows];
            const inserted: unknown[] = [];

            for (const r of rowList) {
              const record = r as Record<string, unknown>;
              const now = new Date().toISOString();
              const id = (record.id as string) || crypto.randomUUID();

              if (table === 'recurrence_rules') {
                const newRule: MockRuleRow = {
                  id,
                  workspace_id: record.workspace_id as string,
                  frequency: record.frequency as 'daily' | 'weekly' | 'monthly' | 'yearly',
                  interval: (record.interval as number) || 1,
                  by_weekday: (record.by_weekday as number[]) || null,
                  by_monthday: (record.by_monthday as number[]) || null,
                  until_date: (record.until_date as string) || null,
                  count: (record.count as number) || null,
                  timezone: (record.timezone as string) || 'Asia/Cairo',
                  dtstart: (record.dtstart as string) || null,
                  total_occurrences_generated: (record.total_occurrences_generated as number) || 1,
                  created_at: now,
                  updated_at: now,
                };
                rules.set(id, newRule);
                inserted.push(newRule);
              } else if (table === 'tasks') {
                const newTask: MockTaskRow = {
                  id,
                  workspace_id: record.workspace_id as string,
                  parent_task_id: (record.parent_task_id as string) || null,
                  project_id: (record.project_id as string) || null,
                  milestone_id: (record.milestone_id as string) || null,
                  title: record.title as string,
                  description: (record.description as string) || null,
                  priority: (record.priority as TaskPriority) || 'medium',
                  status: (record.status as TaskStatus) || 'todo',
                  scheduled_start: (record.scheduled_start as string) || null,
                  scheduled_end: (record.scheduled_end as string) || null,
                  due_date: (record.due_date as string) || null,
                  estimated_duration_minutes: (record.estimated_duration_minutes as number) || null,
                  is_all_day: Boolean(record.is_all_day),
                  completed_at: (record.completed_at as string) || null,
                  tags: (record.tags as string[]) || [],
                  recurrence_rule_id: (record.recurrence_rule_id as string) || null,
                  occurrence_index: (record.occurrence_index as number) || null,
                  created_by: (record.created_by as string) || null,
                  assigned_to: (record.assigned_to as string) || null,
                  created_at: now,
                  updated_at: now,
                  created_from: (record.created_from as 'tasks' | 'calendar') || 'tasks',
                };
                tasks.set(id, newTask);
                inserted.push(newTask);
              }
            }

            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: inserted[0] || null,
                  error: inserted[0] ? null : { message: 'Insert failed' },
                })),
              })),
            };
          }),

          update: vi.fn((updates: Record<string, unknown>) => {
            const doUpdate = () => {
              const now = new Date().toISOString();
              const updatedRecords: unknown[] = [];

              if (table === 'recurrence_rules') {
                for (const r of rules.values()) {
                  if (filters.id && r.id !== filters.id) continue;
                  if (filters.workspace_id && r.workspace_id !== filters.workspace_id) continue;
                  Object.assign(r, updates, { updated_at: now });
                  updatedRecords.push({ ...r });
                }
              } else if (table === 'tasks') {
                for (const t of tasks.values()) {
                  if (filters.id && t.id !== filters.id) continue;
                  if (filters.workspace_id && t.workspace_id !== filters.workspace_id) continue;
                  if (filters.recurrence_rule_id && t.recurrence_rule_id !== filters.recurrence_rule_id)
                    continue;
                  if (filters._neq_status && t.status === filters._neq_status) continue;
                  Object.assign(t, updates, { updated_at: now });
                  updatedRecords.push({ ...t });
                }
              }

              return updatedRecords;
            };

            const updateChain = {
              eq: vi.fn((field: string, val: unknown) => {
                filters[field] = val;
                return updateChain;
              }),
              neq: vi.fn((field: string, val: unknown) => {
                filters[`_neq_${field}`] = val;
                return updateChain;
              }),
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  const records = doUpdate();
                  return {
                    data: records[0] || null,
                    error: records[0] ? null : { message: 'Not found for update' },
                  };
                }),
              })),
              then: (resolve: (v: unknown) => void) => {
                const records = doUpdate();
                resolve({ data: records, error: null });
              },
            };

            return updateChain;
          }),

          delete: vi.fn(() => {
            const deleteChain = {
              eq: vi.fn((field: string, val: unknown) => {
                filters[field] = val;
                return deleteChain;
              }),
              then: (resolve: (v: unknown) => void) => {
                if (table === 'tasks' && filters.id) {
                  tasks.delete(filters.id as string);
                }
                resolve({ data: null, error: null });
              },
            };
            return deleteChain;
          }),

          maybeSingle: vi.fn(async () => {
            const list = executeFilter();
            return { data: list.length > 0 ? list[0] : null, error: null };
          }),
          single: vi.fn(async () => {
            const list = executeFilter();
            if (list.length === 0) return { data: null, error: { message: 'Not found' } };
            return { data: list[0], error: null };
          }),
          then: (resolve: (v: unknown) => void) => {
            const list = executeFilter();
            resolve({ data: list, error: null });
          },
        };

        function executeFilter() {
          if (table === 'recurrence_rules') {
            return Array.from(rules.values()).filter((r) => {
              if (filters.workspace_id && r.workspace_id !== filters.workspace_id) return false;
              if (filters.id && r.id !== filters.id) return false;
              return true;
            });
          }

          if (table === 'tasks') {
            return Array.from(tasks.values()).filter((t) => {
              if (filters.workspace_id && t.workspace_id !== filters.workspace_id) return false;
              if (filters.id && t.id !== filters.id) return false;
              if (filters.recurrence_rule_id && t.recurrence_rule_id !== filters.recurrence_rule_id)
                return false;
              if (nullFilters.parent_task_id && t.parent_task_id !== null) return false;
              if (filters.parent_task_id && t.parent_task_id !== filters.parent_task_id)
                return false;
              if (filters._in_recurrence_rule_id) {
                const allowed = filters._in_recurrence_rule_id as string[];
                if (!t.recurrence_rule_id || !allowed.includes(t.recurrence_rule_id)) return false;
              }
              if (filters.status && t.status !== filters.status) return false;
              if (filters._neq_status && t.status === filters._neq_status) return false;
              if (filters._not_in_status) {
                const excluded = filters._not_in_status as string[];
                if (excluded.includes(t.status)) return false;
              }
              if (filters._gte_scheduled_start) {
                if (!t.scheduled_start || t.scheduled_start < (filters._gte_scheduled_start as string))
                  return false;
              }
              if (filters._lte_scheduled_start) {
                if (!t.scheduled_start || t.scheduled_start > (filters._lte_scheduled_start as string))
                  return false;
              }
              if (nullFilters.completed_at && t.completed_at !== null) return false;
              return true;
            });
          }

          if (table === 'task_dependencies') {
            return [];
          }

          if (table === 'projects' || table === 'milestones') {
            return [];
          }

          return [];
        }

        return chain;
      }) as unknown as SupabaseClient<Database>['from'],
      rpc: vi.fn().mockImplementation(() => {
        // Fall back to application-level atomic execution in tests
        return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Function not found' } });
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-primary', email: 'primary@example.com' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient<Database>;
  }

  return {
    createClient,
    tasks,
    rules,
  };
}

describe('Stage 6: Cross-Interface Consistency and Integration Hardening', () => {
  const wsA = '11111111-1111-4111-a111-111111111111';
  const wsB = '22222222-2222-4222-a222-222222222222';
  const userA = 'user-owner-a';
  let db: ReturnType<typeof createCrossInterfaceMockDatabase>;
  let supabaseA: SupabaseClient<Database>;

  beforeEach(() => {
    db = createCrossInterfaceMockDatabase();
    supabaseA = db.createClient();
    activeSupabaseClient = supabaseA;
  });

  const getMcpContext = (workspaceId = wsA, userId = userA): AIExecutionContext => ({
    workspaceId,
    userId,
    actorId: userId,
    timeZone: 'Asia/Cairo',
    scopes: ['task:read', 'task:write', 'content:read', 'content:write'],
    supabase: db.createClient(),
  });

  // ---------------------------------------------------------------------------
  // 1. Cross-Interface Consistency: UI Creation -> MCP Completion
  // ---------------------------------------------------------------------------
  describe('1. UI Creation -> MCP Completion', () => {
    it('creates recurring task through UI server action and completes via MCP change_task_status', async () => {
      // 1. Create via UI Server Action
      const formData = new FormData();
      formData.set('workspace_id', wsA);
      formData.set('title', 'Weekly Team Sync');
      formData.set('priority', 'high');
      formData.set('scheduled_start', '2026-11-16T10:00:00.000Z'); // Future Monday
      formData.set('scheduled_end', '2026-11-16T11:00:00.000Z');
      formData.set('recurrence_frequency', 'weekly');
      formData.set('recurrence_interval', '1');
      formData.set('recurrence_by_weekday', '1,3'); // Mon, Wed
      formData.set('recurrence_timezone', 'Asia/Cairo');

      const createRes = await createTaskAction(null, formData);
      expect(createRes.error).toBeUndefined();
      expect(createRes.success).toBe(true);
      const createdTask = createRes.data as TaskWithMeta;
      expect(createdTask.title).toBe('Weekly Team Sync');
      expect(createdTask.recurrence_rule_id).toBeDefined();

      const initialRule = db.rules.get(createdTask.recurrence_rule_id!);
      expect(initialRule).toBeDefined();
      expect(initialRule?.frequency).toBe('weekly');
      expect(initialRule?.by_weekday).toEqual([1, 3]);

      // 2. Complete via MCP change_task_status
      const mcpContext = getMcpContext(wsA, userA);
      const mcpRes = await dispatchTool(
        'change_task_status',
        {
          task_id: createdTask.id,
          status: 'done',
        },
        mcpContext
      );

      expect(mcpRes.success).toBe(true);
      const completedData = mcpRes.data as Record<string, unknown>;
      expect(completedData.status).toBe('done');
      expect(completedData.completed_at).toBeDefined();

      // Verify next occurrence was generated and returned in MCP response
      const nextOcc = (completedData.next_occurrence || completedData.next_task) as TaskWithMeta;
      expect(nextOcc).toBeDefined();
      expect(nextOcc.status).toBe('todo');
      expect(nextOcc.occurrence_index).toBe(2);
      expect(nextOcc.title).toBe('Weekly Team Sync');
      // Next slot after Mon Nov 16 for [1, 3] is Wed Nov 18
      expect(nextOcc.scheduled_start).toBe('2026-11-18T10:00:00.000Z');
      expect(nextOcc.scheduled_end).toBe('2026-11-18T11:00:00.000Z');

      // Verify recurrence rule counter updated
      const updatedRule = db.rules.get(createdTask.recurrence_rule_id!);
      expect(updatedRule?.total_occurrences_generated).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Cross-Interface Consistency: MCP Creation -> UI Completion
  // ---------------------------------------------------------------------------
  describe('2. MCP Creation -> UI Completion', () => {
    it('creates recurring task through MCP create_task and completes via UI completeTaskAction', async () => {
      // 1. Create via MCP create_task
      const mcpContext = getMcpContext(wsA, userA);
      const mcpCreateRes = await dispatchTool(
        'create_task',
        {
          title: 'Daily Standup',
          priority: 'urgent',
          scheduled_start: '2026-11-15T09:00:00.000Z',
          scheduled_end: '2026-11-15T09:30:00.000Z',
          recurrence: {
            frequency: 'daily',
            interval: 1,
            timezone: 'Asia/Cairo',
          },
        },
        mcpContext
      );

      expect(mcpCreateRes.success).toBe(true);
      const createdTask = mcpCreateRes.data as TaskWithMeta;
      expect(createdTask.title).toBe('Daily Standup');
      expect(createdTask.recurrence_rule_id).toBeDefined();

      // 2. Complete via UI completeTaskAction
      const completeRes = await completeTaskAction(wsA, createdTask.id);
      expect(completeRes.error).toBeUndefined();
      expect(completeRes.success).toBe(true);
      expect(completeRes.data).toBeDefined();

      const actionData = completeRes.data as {
        completedTask: TaskWithMeta;
        nextOccurrence: TaskWithMeta | null;
        nextTask: TaskWithMeta | null;
      };
      expect(actionData.completedTask.status).toBe('done');
      expect(actionData.nextOccurrence).toBeDefined();
      expect(actionData.nextOccurrence?.status).toBe('todo');
      expect(actionData.nextOccurrence?.occurrence_index).toBe(2);
      expect(actionData.nextOccurrence?.scheduled_start).toBe('2026-11-16T09:00:00.000Z');
      expect(actionData.nextOccurrence?.scheduled_end).toBe('2026-11-16T09:30:00.000Z');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Cross-Interface Consistency: CLI Commands -> Server Actions
  // ---------------------------------------------------------------------------
  describe('3. CLI Commands -> Server Actions', () => {
    it('translates CLI tasks update --stop-recurrence and halts future occurrences', async () => {
      // 1. Create a recurring task in database
      const task = await createTask(supabaseA, wsA, {
        title: 'Bi-Weekly Retrospective',
        scheduled_start: '2026-11-02T16:00:00.000Z',
        recurrence: {
          frequency: 'weekly',
          interval: 2,
        },
      });
      expect(task.recurrence_rule_id).toBeDefined();

      // 2. Parse CLI command
      const cliParsed = parseFriendlyCommand(['tasks', 'update', task.id, '--stop-recurrence']);
      expect(cliParsed).toEqual({
        name: 'update_task',
        arguments: {
          task_id: task.id,
          stop_recurrence: true,
        },
        isJson: false,
      });

      // 3. Dispatch tool as CLI client would
      const mcpContext = getMcpContext(wsA, userA);
      const updateRes = await dispatchTool(cliParsed!.name, cliParsed!.arguments, mcpContext);
      expect(updateRes.success).toBe(true);

      // Verify task detached and recurrence rule stopped
      const reloadedTask = await getTaskById(supabaseA, wsA, task.id);
      expect(reloadedTask?.recurrence_rule_id).toBeNull();

      const rule = db.rules.get(task.recurrence_rule_id!);
      expect(rule?.until_date).toBeDefined();
      expect(rule?.count).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. MCP update_task Recurrence Modification & Calendar Projections
  // ---------------------------------------------------------------------------
  describe('4. MCP update_task Recurrence Modification & Calendar Projections', () => {
    it('modifies recurrence rule via MCP update_task and dynamically updates calendar projections', async () => {
      // 1. Create weekly task starting Monday Nov 2
      const task = await createTask(supabaseA, wsA, {
        title: 'Sprint Planning',
        scheduled_start: '2026-11-02T10:00:00.000Z',
        scheduled_end: '2026-11-02T11:00:00.000Z',
        recurrence: {
          frequency: 'weekly',
          interval: 1,
        },
      });

      // Initial calendar projection: November 2026 (Nov 1 to Nov 30)
      const initialSchedule = await getUnifiedSchedule(supabaseA, wsA, {
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: '2026-11-30T23:59:59.000Z',
      });
      // 1 persistent task (Nov 2) + 4 virtual tasks (Nov 9, 16, 23, 30) = 5 events
      const initialSprintEvents = initialSchedule.events.filter((e) => e.title === 'Sprint Planning');
      expect(initialSprintEvents.length).toBe(5);

      // 2. Modify recurrence to daily via MCP update_task
      const mcpContext = getMcpContext(wsA, userA);
      const updateRes = await dispatchTool(
        'update_task',
        {
          task_id: task.id,
          recurrence: {
            frequency: 'daily',
            interval: 1,
          },
        },
        mcpContext
      );
      expect(updateRes.success).toBe(true);

      // 3. Verify calendar projection updated dynamically to daily occurrences
      const updatedSchedule = await getUnifiedSchedule(supabaseA, wsA, {
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: '2026-11-07T23:59:59.000Z',
      });
      const updatedSprintEvents = updatedSchedule.events.filter((e) => e.title === 'Sprint Planning');
      // Nov 2 (persisted), Nov 3, 4, 5, 6, 7 (virtual) = 6 events
      expect(updatedSprintEvents.length).toBe(6);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Idempotent Retries and Repeated AI Tool Calls
  // ---------------------------------------------------------------------------
  describe('5. Idempotent Retries and Repeated AI Tool Calls', () => {
    it('guarantees repeated completion calls do not spawn duplicate active occurrences', async () => {
      const task = await createTask(supabaseA, wsA, {
        title: 'Daily Database Backup',
        scheduled_start: '2026-11-01T02:00:00.000Z',
        recurrence: {
          frequency: 'daily',
          interval: 1,
        },
      });

      const mcpContext = getMcpContext(wsA, userA);

      // First completion via MCP
      const firstRes = await dispatchTool(
        'change_task_status',
        { task_id: task.id, status: 'done' },
        mcpContext
      );
      expect(firstRes.success).toBe(true);
      const firstNextOcc = (firstRes.data as Record<string, unknown>).next_occurrence as TaskWithMeta;
      expect(firstNextOcc).toBeDefined();

      const taskCountAfterFirst = db.tasks.size;
      expect(taskCountAfterFirst).toBe(2); // original completed + next occurrence

      // Second completion (duplicate network call or retry) via MCP
      const secondRes = await dispatchTool(
        'change_task_status',
        { task_id: task.id, status: 'done' },
        mcpContext
      );
      expect(secondRes.success).toBe(true);
      const secondData = secondRes.data as Record<string, unknown>;
      expect(secondData.status).toBe('done');
      expect((secondData.next_occurrence as TaskWithMeta)?.id).toBe(firstNextOcc.id);

      // No new tasks created
      expect(db.tasks.size).toBe(2);

      // Third completion via UI server action completeTaskAction
      const thirdRes = await completeTaskAction(wsA, task.id);
      expect(thirdRes.success).toBe(true);
      expect(db.tasks.size).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Subtask Template Inheritance Across Interfaces
  // ---------------------------------------------------------------------------
  describe('6. Subtask Template Inheritance Across Interfaces', () => {
    it('inherits subtask templates in fresh todo state when completed via MCP or UI', async () => {
      // 1. Create parent recurring task
      const parent = await createTask(supabaseA, wsA, {
        title: 'Publish Monthly Newsletter',
        scheduled_start: '2026-11-01T12:00:00.000Z',
        recurrence: {
          frequency: 'monthly',
          interval: 1,
          by_monthday: [1],
        },
      });

      // 2. Create subtasks
      const subtask1 = await createTask(supabaseA, wsA, {
        parent_task_id: parent.id,
        title: 'Draft email copy',
        status: 'done',
      });
      const subtask2 = await createTask(supabaseA, wsA, {
        parent_task_id: parent.id,
        title: 'Review analytics and schedule',
        status: 'todo',
      });

      expect(db.tasks.size).toBe(3);

      // 3. Complete parent via MCP
      const mcpContext = getMcpContext(wsA, userA);
      const completeRes = await dispatchTool(
        'change_task_status',
        { task_id: parent.id, status: 'done' },
        mcpContext
      );
      expect(completeRes.success).toBe(true);

      const nextParent = (completeRes.data as Record<string, unknown>).next_occurrence as TaskWithMeta;
      expect(nextParent).toBeDefined();

      // Verify inherited subtasks for the new occurrence
      const newSubtasks = Array.from(db.tasks.values()).filter(
        (t) => t.parent_task_id === nextParent.id
      );
      expect(newSubtasks.length).toBe(2);
      expect(newSubtasks.map((s) => s.title).sort()).toEqual([
        'Draft email copy',
        'Review analytics and schedule',
      ]);
      // All cloned subtasks MUST be fresh 'todo' tasks
      for (const st of newSubtasks) {
        expect(st.status).toBe('todo');
        expect(st.completed_at).toBeNull();
      }

      // Original subtasks remain unchanged
      expect(db.tasks.get(subtask1.id)?.status).toBe('done');
      expect(db.tasks.get(subtask2.id)?.status).toBe('todo');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Fail-Closed Cross-Workspace Authorization & Error Sanitization
  // ---------------------------------------------------------------------------
  describe('7. Fail-Closed Cross-Workspace Authorization & Error Sanitization', () => {
    it('rejects cross-workspace completion and mutation with sanitized NOT_FOUND error', async () => {
      // Create task in Workspace B
      const taskInB = await createTask(supabaseA, wsB, {
        title: 'Workspace B Secret Task',
        priority: 'urgent',
      });

      // Attempt access from Workspace A via MCP
      const mcpContextA = getMcpContext(wsA, userA);

      // 1. change_task_status across workspaces
      const statusRes = await dispatchTool(
        'change_task_status',
        { task_id: taskInB.id, status: 'done' },
        mcpContextA
      );
      expect(statusRes.success).toBe(false);
      expect(statusRes.error?.code).toBe('NOT_FOUND');
      expect(statusRes.error?.message).toContain('inaccessible');
      expect(statusRes.error?.message).not.toContain('Workspace B Secret Task');

      // 2. update_task across workspaces
      const updateRes = await dispatchTool(
        'update_task',
        { task_id: taskInB.id, title: 'Hacked Title' },
        mcpContextA
      );
      expect(updateRes.success).toBe(false);
      expect(updateRes.error?.code).toBe('NOT_FOUND');

      // 3. UI completeTaskAction across workspaces
      const actionRes = await completeTaskAction(wsA, taskInB.id);
      expect(actionRes.success).toBeFalsy();
      expect(actionRes.error).toBeDefined();

      // 4. Update recurrence rule across workspaces
      const rule = await createTask(supabaseA, wsB, {
        title: 'Task B Recurring',
        recurrence: { frequency: 'daily' },
      });
      const ruleActionRes = await updateRecurrenceRuleAction(wsA, rule.recurrence_rule_id!, {
        frequency: 'weekly',
      });
      expect(ruleActionRes.success).toBeFalsy();
      expect(ruleActionRes.error).toMatch(/not found|inaccessible/);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Invalid Recurrence Input Rejection Across All Interfaces
  // ---------------------------------------------------------------------------
  describe('8. Invalid Recurrence Input Rejection Across All Interfaces', () => {
    it('rejects unsupported custom frequency in MCP create_task', async () => {
      const mcpContext = getMcpContext(wsA, userA);
      const res = await dispatchTool(
        'create_task',
        {
          title: 'Custom Recurrence',
          recurrence: {
            frequency: 'custom',
            interval: 1,
          },
        },
        mcpContext
      );
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('INVALID_ARGUMENTS');
      expect(JSON.stringify(res.error)).toContain("Unsupported recurrence frequency: 'custom'");
    });

    it('rejects conflicting until_date and count in MCP create_calendar_entry', async () => {
      const mcpContext = getMcpContext(wsA, userA);
      const res = await dispatchTool(
        'create_calendar_entry',
        {
          title: 'Conflicting Recurrence',
          scheduled_start: '2026-11-01T10:00:00.000Z',
          recurrence: {
            frequency: 'daily',
            until_date: '2026-12-01T00:00:00.000Z',
            count: 5,
          },
        },
        mcpContext
      );
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('INVALID_ARGUMENTS');
      expect(JSON.stringify(res.error)).toContain('Cannot specify both until_date and count');
    });

    it('rejects invalid intervals in UI createTaskAction', async () => {
      const formData = new FormData();
      formData.set('workspace_id', wsA);
      formData.set('title', 'Invalid Interval Task');
      formData.set('recurrence_frequency', 'daily');
      formData.set('recurrence_interval', '0'); // Invalid! Must be >= 1

      const res = await createTaskAction(null, formData);
      expect(res.success).toBeFalsy();
      expect(res.error).toContain('Interval must be a positive integer >= 1');
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Calendar Projections are Read-Only (Never Persisted to Database)
  // ---------------------------------------------------------------------------
  describe('9. Calendar Projections are Read-Only', () => {
    it('projects virtual occurrences across calendar views without inserting task rows', async () => {
      await createTask(supabaseA, wsA, {
        title: 'Weekly Standup',
        scheduled_start: '2026-11-02T10:00:00.000Z',
        recurrence: {
          frequency: 'weekly',
          interval: 1,
        },
      });

      const initialDbCount = db.tasks.size;
      expect(initialDbCount).toBe(1);

      // Query unified schedule across 60 days
      const schedule = await getUnifiedSchedule(supabaseA, wsA, {
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: '2026-12-31T23:59:59.000Z',
      });

      const standupEvents = schedule.events.filter((e) => e.title === 'Weekly Standup');
      expect(standupEvents.length).toBeGreaterThan(5);

      // Verify virtual items have isVirtual: true
      const virtualOccurrences = standupEvents.filter((e) => e.isVirtual);
      expect(virtualOccurrences.length).toBeGreaterThan(4);
      for (const vo of virtualOccurrences) {
        expect(vo.id).toContain('virtual:');
      }

      // Check database: ZERO extra rows were created!
      expect(db.tasks.size).toBe(initialDbCount);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Status Update Bypass Prevention
  // ---------------------------------------------------------------------------
  describe('10. Status Update Bypass Prevention', () => {
    it('routes updateTask status: done directly through atomic completion', async () => {
      const task = await createTask(supabaseA, wsA, {
        title: 'Daily Report',
        scheduled_start: '2026-11-15T08:00:00.000Z',
        recurrence: {
          frequency: 'daily',
          interval: 1,
        },
      });

      // Direct updateTask call setting status: 'done'
      const updated = await updateTask(supabaseA, wsA, task.id, {
        status: 'done',
      });

      expect(updated.status).toBe('done');
      expect(updated.completed_at).toBeDefined();

      // Must have spawned the next occurrence
      const activeOcc = Array.from(db.tasks.values()).find(
        (t) => t.recurrence_rule_id === task.recurrence_rule_id && t.status === 'todo'
      );
      expect(activeOcc).toBeDefined();
      expect(activeOcc?.occurrence_index).toBe(2);
      expect(activeOcc?.scheduled_start).toBe('2026-11-16T08:00:00.000Z');
    });

    it('blocks status modification via MCP update_task tool', async () => {
      const task = await createTask(supabaseA, wsA, {
        title: 'Standard Task',
      });

      const mcpContext = getMcpContext(wsA, userA);
      const res = await dispatchTool(
        'update_task',
        {
          task_id: task.id,
          status: 'done',
        } as Record<string, unknown>,
        mcpContext
      );

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('INVALID_ARGUMENTS');
    });

    it('advances overdue recurrence series cleanly without backlog accumulation when completed late across interfaces', async () => {
      // Create a daily task scheduled in the past: Nov 1
      const overdueTask = await createTask(supabaseA, wsA, {
        title: 'Overdue Daily Standup',
        scheduled_start: '2026-11-01T09:00:00.000Z',
        scheduled_end: '2026-11-01T09:30:00.000Z',
        recurrence: {
          frequency: 'daily',
          interval: 1,
        },
      });

      // Complete late via MCP on Nov 10
      const mcpContext = getMcpContext(wsA, userA);
      const res = await dispatchTool(
        'change_task_status',
        {
          task_id: overdueTask.id,
          status: 'done',
        },
        mcpContext
      );

      expect(res.success).toBe(true);
      const nextOcc = (res.data as Record<string, unknown>).next_occurrence as TaskWithMeta;
      expect(nextOcc).toBeDefined();

      // Next scheduled start is in the upcoming future (Nov 11)
      const nextStart = new Date(nextOcc.scheduled_start!);
      const now = new Date();
      expect(nextStart.getTime()).toBeGreaterThan(now.getTime());
      // Occurrence index skipped missed daily slots
      expect(nextOcc.occurrence_index).toBeGreaterThan(2);

      // Verify rule total_occurrences_generated advanced to match skipped index
      const rule = db.rules.get(overdueTask.recurrence_rule_id!);
      expect(rule?.total_occurrences_generated).toBe(nextOcc.occurrence_index);
    });

    it('rejects completing virtual occurrence IDs via MCP change_task_status', async () => {
      const mcpContext = getMcpContext(wsA, userA);
      const res = await dispatchTool(
        'change_task_status',
        {
          task_id: 'virtual:recurrence-123:2026-11-15',
          status: 'done',
        },
        mcpContext
      );

      // Fails schema validation because task_id must be a UUID
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('INVALID_ARGUMENTS');
    });
  });
});
