import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, TaskStatus, TaskPriority } from '@/types/database';
import {
  formatRecurrenceSummary,
} from '@/lib/temporal/recurrence';
import {
  createTask,
  updateTask,
  getTaskById,
  updateRecurrenceRule,
  stopRecurrence,
  makeTaskRecurring,
  getTasks,
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

function createUxMockDatabase() {
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
          not: vi.fn(() => chain),
          ilike: vi.fn(() => chain),
          gte: vi.fn((field: string, val: unknown) => {
            filters[`_gte_${field}`] = val;
            return chain;
          }),
          lte: vi.fn((field: string, val: unknown) => {
            filters[`_lte_${field}`] = val;
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

              // Date range filters
              if (filters._gte_scheduled_start && t.scheduled_start) {
                if (t.scheduled_start < (filters._gte_scheduled_start as string)) return false;
              }
              if (filters._lte_scheduled_start && t.scheduled_start) {
                if (t.scheduled_start > (filters._lte_scheduled_start as string)) return false;
              }

              return true;
            });
          }

          if (table === 'task_dependencies' || table === 'projects') {
            return [];
          }

          return [];
        }

        return chain;
      }) as unknown as SupabaseClient<Database>['from'],
    } as unknown as SupabaseClient<Database>;
  }

  return {
    tasks,
    rules,
    createClient,
  };
}

describe('Stage 5: Recurrence Management UX & Series Modification', () => {
  const WS_ID = '00000000-0000-0000-0000-000000000001';
  const OTHER_WS_ID = '99999999-9999-9999-9999-999999999999';

  describe('1. Recurrence Summary Formatter (formatRecurrenceSummary)', () => {
    it('formats daily recurrence with single and multiple intervals', () => {
      expect(formatRecurrenceSummary({ frequency: 'daily', interval: 1 })).toBe('Repeats daily');
      expect(formatRecurrenceSummary({ frequency: 'daily', interval: 3 })).toBe('Repeats every 3 days');
    });

    it('formats weekly recurrence with single and multiple weekdays', () => {
      expect(formatRecurrenceSummary({ frequency: 'weekly', interval: 1, by_weekday: [1] })).toBe(
        'Repeats weekly on Monday'
      );
      expect(
        formatRecurrenceSummary({ frequency: 'weekly', interval: 2, by_weekday: [1, 3, 5] })
      ).toBe('Repeats every 2 weeks on Monday, Wednesday, Friday');
    });

    it('formats monthly recurrence with preferred day of month', () => {
      expect(formatRecurrenceSummary({ frequency: 'monthly', interval: 1, by_monthday: [15] })).toBe(
        'Repeats monthly on day 15'
      );
      expect(formatRecurrenceSummary({ frequency: 'monthly', interval: 3, by_monthday: [31] })).toBe(
        'Repeats every 3 months on day 31'
      );
    });

    it('formats yearly recurrence and leap year details', () => {
      expect(formatRecurrenceSummary({ frequency: 'yearly', interval: 1 })).toBe('Repeats yearly');
      expect(formatRecurrenceSummary({ frequency: 'yearly', interval: 2 })).toBe('Repeats every 2 years');
    });

    it('formats termination conditions (count and until_date)', () => {
      expect(
        formatRecurrenceSummary({
          frequency: 'weekly',
          interval: 1,
          by_weekday: [1],
          count: 5,
          total_occurrences_generated: 2,
        })
      ).toBe('Repeats weekly on Monday · 5 occurrences total (2 generated)');

      expect(
        formatRecurrenceSummary({
          frequency: 'daily',
          interval: 1,
          until_date: '2026-12-31T23:59:59.999Z',
        })
      ).toBe('Repeats daily · Ends on 2026-12-31');
    });
  });

  describe('2. Task Creation with Recurrence Controls', () => {
    let db: ReturnType<typeof createUxMockDatabase>;

    beforeEach(() => {
      db = createUxMockDatabase();
    });

    it('creates a daily recurring task with interval and timezone', async () => {
      const client = db.createClient();
      const task = await createTask(client, WS_ID, {
        title: 'Daily Review',
        priority: 'high',
        scheduled_start: '2026-03-01T09:00:00.000Z',
        recurrence: {
          frequency: 'daily',
          interval: 2,
          timezone: 'Africa/Cairo',
        },
      });

      expect(task.title).toBe('Daily Review');
      expect(task.recurrence_rule_id).toBeDefined();
      expect(task.occurrence_index).toBe(1);

      const rule = db.rules.get(task.recurrence_rule_id!);
      expect(rule).toBeDefined();
      expect(rule?.frequency).toBe('daily');
      expect(rule?.interval).toBe(2);
      expect(rule?.timezone).toBe('Africa/Cairo');
      expect(rule?.total_occurrences_generated).toBe(1);
    });

    it('creates a weekly recurring task with selected weekdays', async () => {
      const client = db.createClient();
      const task = await createTask(client, WS_ID, {
        title: 'Team Standup',
        priority: 'medium',
        scheduled_start: '2026-03-02T08:00:00.000Z',
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          by_weekday: [1, 3, 5], // Mon, Wed, Fri
          timezone: 'UTC',
        },
      });

      const rule = db.rules.get(task.recurrence_rule_id!);
      expect(rule?.frequency).toBe('weekly');
      expect(rule?.by_weekday).toEqual([1, 3, 5]);
    });

    it('creates a monthly recurring task with preferred day and count limit', async () => {
      const client = db.createClient();
      const task = await createTask(client, WS_ID, {
        title: 'Monthly Invoicing',
        priority: 'urgent',
        scheduled_start: '2026-03-31T12:00:00.000Z',
        recurrence: {
          frequency: 'monthly',
          interval: 1,
          by_monthday: [31],
          count: 12,
          timezone: 'UTC',
        },
      });

      const rule = db.rules.get(task.recurrence_rule_id!);
      expect(rule?.frequency).toBe('monthly');
      expect(rule?.by_monthday).toEqual([31]);
      expect(rule?.count).toBe(12);
    });

    it('rejects unsupported custom frequency explicitly with validation error', async () => {
      const client = db.createClient();
      await expect(
        createTask(client, WS_ID, {
          title: 'Custom Recurrence Task',
          recurrence: {
            frequency: 'custom',
            interval: 1,
          },
        })
      ).rejects.toThrow("Unsupported recurrence frequency: 'custom'");
    });

    it('rejects specifying both until_date and count termination conditions', async () => {
      const client = db.createClient();
      await expect(
        createTask(client, WS_ID, {
          title: 'Conflicting Termination Task',
          recurrence: {
            frequency: 'daily',
            interval: 1,
            until_date: '2026-12-31T23:59:59.999Z',
            count: 10,
          },
        })
      ).rejects.toThrow('Cannot specify both until_date and count termination conditions');
    });
  });

  describe('3. Task Editing Scope: This Occurrence vs Entire Series', () => {
    let db: ReturnType<typeof createUxMockDatabase>;

    beforeEach(() => {
      db = createUxMockDatabase();
    });

    it('edits ordinary task properties of "This occurrence" without altering the shared recurrence rule', async () => {
      const client = db.createClient();
      const ruleId = crypto.randomUUID();
      const taskId = crypto.randomUUID();

      // Original rule: Weekly on Monday
      db.rules.set(ruleId, {
        id: ruleId,
        workspace_id: WS_ID,
        frequency: 'weekly',
        interval: 1,
        by_weekday: [1],
        by_monthday: null,
        until_date: null,
        count: null,
        timezone: 'UTC',
        dtstart: '2026-03-02T09:00:00.000Z',
        total_occurrences_generated: 1,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      });

      db.tasks.set(taskId, {
        id: taskId,
        workspace_id: WS_ID,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Weekly Monday Strategy',
        description: 'Old notes',
        priority: 'medium',
        status: 'todo',
        scheduled_start: '2026-03-02T09:00:00.000Z',
        scheduled_end: '2026-03-02T10:00:00.000Z',
        due_date: null,
        estimated_duration_minutes: 60,
        is_all_day: false,
        completed_at: null,
        tags: [],
        recurrence_rule_id: ruleId,
        occurrence_index: 1,
        created_by: null,
        assigned_to: null,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      });

      // User edits this occurrence only
      const updated = await updateTask(client, WS_ID, taskId, {
        title: 'Weekly Monday Strategy (Q1 Focus)',
        description: 'Updated sprint focus notes for this week',
        priority: 'urgent',
      });

      expect(updated.title).toBe('Weekly Monday Strategy (Q1 Focus)');
      expect(updated.description).toBe('Updated sprint focus notes for this week');
      expect(updated.priority).toBe('urgent');

      // Shared rule MUST remain untouched
      const rule = db.rules.get(ruleId);
      expect(rule?.frequency).toBe('weekly');
      expect(rule?.interval).toBe(1);
      expect(rule?.by_weekday).toEqual([1]);
    });

    it('edits the recurrence rule of the "Entire series", preserving consumed occurrences and historical completed tasks', async () => {
      const client = db.createClient();
      const ruleId = crypto.randomUUID();
      const completedTask1Id = crypto.randomUUID();
      const activeTask2Id = crypto.randomUUID();

      // Rule has already generated 2 occurrences
      db.rules.set(ruleId, {
        id: ruleId,
        workspace_id: WS_ID,
        frequency: 'weekly',
        interval: 1,
        by_weekday: [1],
        by_monthday: null,
        until_date: null,
        count: null,
        timezone: 'UTC',
        dtstart: '2026-03-02T09:00:00.000Z',
        total_occurrences_generated: 2,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      });

      // Completed historical task 1
      db.tasks.set(completedTask1Id, {
        id: completedTask1Id,
        workspace_id: WS_ID,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Weekly Sync',
        description: null,
        priority: 'medium',
        status: 'done',
        scheduled_start: '2026-03-02T09:00:00.000Z',
        scheduled_end: null,
        due_date: null,
        estimated_duration_minutes: 30,
        is_all_day: false,
        completed_at: '2026-03-02T09:30:00.000Z',
        tags: [],
        recurrence_rule_id: ruleId,
        occurrence_index: 1,
        created_by: null,
        assigned_to: null,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-02T09:30:00.000Z',
      });

      // Active task 2
      db.tasks.set(activeTask2Id, {
        id: activeTask2Id,
        workspace_id: WS_ID,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Weekly Sync',
        description: null,
        priority: 'medium',
        status: 'todo',
        scheduled_start: '2026-03-09T09:00:00.000Z',
        scheduled_end: null,
        due_date: null,
        estimated_duration_minutes: 30,
        is_all_day: false,
        completed_at: null,
        tags: [],
        recurrence_rule_id: ruleId,
        occurrence_index: 2,
        created_by: null,
        assigned_to: null,
        created_at: '2026-03-02T09:30:00.000Z',
        updated_at: '2026-03-02T09:30:00.000Z',
      });

      // User changes recurrence rule: biweekly on Mondays and Wednesdays, ending after 10 occurrences
      const updatedRule = await updateRecurrenceRule(client, WS_ID, ruleId, {
        frequency: 'weekly',
        interval: 2,
        by_weekday: [1, 3], // Mon, Wed
        count: 10,
        timezone: 'UTC',
      });

      expect(updatedRule.interval).toBe(2);
      expect(updatedRule.by_weekday).toEqual([1, 3]);
      expect(updatedRule.count).toBe(10);

      // Consumed occurrences must NOT reset or be lost
      expect(updatedRule.total_occurrences_generated).toBe(2);

      // Completed task 1 MUST remain unchanged in historical state
      const histTask = db.tasks.get(completedTask1Id);
      expect(histTask?.status).toBe('done');
      expect(histTask?.occurrence_index).toBe(1);
      expect(histTask?.completed_at).toBe('2026-03-02T09:30:00.000Z');
      expect(histTask?.scheduled_start).toBe('2026-03-02T09:00:00.000Z');
    });

    it('rejects setting count limit lower than already generated occurrences', async () => {
      const client = db.createClient();
      const ruleId = crypto.randomUUID();

      db.rules.set(ruleId, {
        id: ruleId,
        workspace_id: WS_ID,
        frequency: 'daily',
        interval: 1,
        by_weekday: null,
        by_monthday: null,
        until_date: null,
        count: null,
        timezone: 'UTC',
        dtstart: '2026-03-01T09:00:00.000Z',
        total_occurrences_generated: 4, // 4 already consumed
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      });

      // Attempting to set count to 2 when 4 have already been generated
      await expect(
        updateRecurrenceRule(client, WS_ID, ruleId, {
          frequency: 'daily',
          interval: 1,
          count: 2,
          timezone: 'UTC',
        })
      ).rejects.toThrow('Cannot set recurrence count (2) lower than already generated occurrences (4)');
    });

    it('enforces workspace authorization when updating recurrence rules', async () => {
      const client = db.createClient();
      const ruleId = crypto.randomUUID();

      db.rules.set(ruleId, {
        id: ruleId,
        workspace_id: OTHER_WS_ID, // Belongs to other workspace
        frequency: 'daily',
        interval: 1,
        by_weekday: null,
        by_monthday: null,
        until_date: null,
        count: null,
        timezone: 'UTC',
        dtstart: '2026-03-01T09:00:00.000Z',
        total_occurrences_generated: 1,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      });

      await expect(
        updateRecurrenceRule(client, WS_ID, ruleId, {
          frequency: 'daily',
          interval: 2,
          timezone: 'UTC',
        })
      ).rejects.toThrow(`Recurrence rule ${ruleId} not found in workspace ${WS_ID}`);
    });
  });

  describe('4. Stopping Recurrence Series Safely', () => {
    let db: ReturnType<typeof createUxMockDatabase>;

    beforeEach(() => {
      db = createUxMockDatabase();
    });

    it('stops recurrence: closes future projections and detaches active task while preserving completed history', async () => {
      const client = db.createClient();
      const ruleId = crypto.randomUUID();
      const task1CompletedId = crypto.randomUUID();
      const task2ActiveId = crypto.randomUUID();

      db.rules.set(ruleId, {
        id: ruleId,
        workspace_id: WS_ID,
        frequency: 'weekly',
        interval: 1,
        by_weekday: [1],
        by_monthday: null,
        until_date: null,
        count: null,
        timezone: 'UTC',
        dtstart: '2026-03-02T09:00:00.000Z',
        total_occurrences_generated: 2,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      });

      // Completed occurrence 1
      db.tasks.set(task1CompletedId, {
        id: task1CompletedId,
        workspace_id: WS_ID,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Weekly Standup',
        description: null,
        priority: 'medium',
        status: 'done',
        scheduled_start: '2026-03-02T09:00:00.000Z',
        scheduled_end: null,
        due_date: null,
        estimated_duration_minutes: 30,
        is_all_day: false,
        completed_at: '2026-03-02T09:30:00.000Z',
        tags: [],
        recurrence_rule_id: ruleId,
        occurrence_index: 1,
        created_by: null,
        assigned_to: null,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-02T09:30:00.000Z',
      });

      // Active occurrence 2
      db.tasks.set(task2ActiveId, {
        id: task2ActiveId,
        workspace_id: WS_ID,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Weekly Standup',
        description: null,
        priority: 'medium',
        status: 'todo',
        scheduled_start: '2026-03-09T09:00:00.000Z',
        scheduled_end: null,
        due_date: null,
        estimated_duration_minutes: 30,
        is_all_day: false,
        completed_at: null,
        tags: [],
        recurrence_rule_id: ruleId,
        occurrence_index: 2,
        created_by: null,
        assigned_to: null,
        created_at: '2026-03-02T09:30:00.000Z',
        updated_at: '2026-03-02T09:30:00.000Z',
      });

      // User stops the recurrence series from the active task
      const stopResult = await stopRecurrence(client, WS_ID, ruleId, {
        currentTaskId: task2ActiveId,
      });

      expect(stopResult.success).toBe(true);

      // 1. Recurrence rule has been capped
      const rule = db.rules.get(ruleId);
      expect(rule?.count).toBe(2); // Capped to consumed count
      expect(rule?.until_date).toBeDefined();

      // 2. Active task is detached into a standalone task
      const activeTask = db.tasks.get(task2ActiveId);
      expect(activeTask?.recurrence_rule_id).toBeNull();
      expect(activeTask?.status).toBe('todo'); // Preserved in place

      // 3. Completed task history is 100% preserved
      const completedTask = db.tasks.get(task1CompletedId);
      expect(completedTask?.status).toBe('done');
      expect(completedTask?.completed_at).toBe('2026-03-02T09:30:00.000Z');
      expect(completedTask?.occurrence_index).toBe(1);

      // 4. Future virtual occurrences in April 2026 must be ZERO
      const futureTasks = await getTasks(client, WS_ID, {
        scheduled_from: '2026-04-01T00:00:00.000Z',
        scheduled_to: '2026-04-30T23:59:59.999Z',
      });
      expect(futureTasks).toHaveLength(0);
    });
  });

  describe('5. Converting One-Time Task into Recurring Series (makeTaskRecurring)', () => {
    let db: ReturnType<typeof createUxMockDatabase>;

    beforeEach(() => {
      db = createUxMockDatabase();
    });

    it('attaches a new recurrence rule to a standalone task', async () => {
      const client = db.createClient();
      const taskId = crypto.randomUUID();

      db.tasks.set(taskId, {
        id: taskId,
        workspace_id: WS_ID,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Monthly Bookkeeping',
        description: null,
        priority: 'high',
        status: 'todo',
        scheduled_start: '2026-03-15T10:00:00.000Z',
        scheduled_end: null,
        due_date: null,
        estimated_duration_minutes: 60,
        is_all_day: false,
        completed_at: null,
        tags: [],
        recurrence_rule_id: null, // One-time task
        occurrence_index: null,
        created_by: null,
        assigned_to: null,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      });

      const { task, rule } = await makeTaskRecurring(client, WS_ID, taskId, {
        frequency: 'monthly',
        interval: 1,
        by_monthday: [15],
        timezone: 'UTC',
      });

      expect(rule.frequency).toBe('monthly');
      expect(rule.by_monthday).toEqual([15]);
      expect(task.recurrence_rule_id).toBe(rule.id);
      expect(task.occurrence_index).toBe(1);

      // Task detail fetch returns attached rule
      const detail = await getTaskById(client, WS_ID, taskId);
      expect(detail?.recurrence_rule).toBeDefined();
      expect(detail?.recurrence_rule?.id).toBe(rule.id);
    });

    it('rejects making an already recurring task recurring again', async () => {
      const client = db.createClient();
      const ruleId = crypto.randomUUID();
      const taskId = crypto.randomUUID();

      db.rules.set(ruleId, {
        id: ruleId,
        workspace_id: WS_ID,
        frequency: 'daily',
        interval: 1,
        by_weekday: null,
        by_monthday: null,
        until_date: null,
        count: null,
        timezone: 'UTC',
        dtstart: '2026-03-01T09:00:00.000Z',
        total_occurrences_generated: 1,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      });

      db.tasks.set(taskId, {
        id: taskId,
        workspace_id: WS_ID,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Already Recurring Task',
        description: null,
        priority: 'low',
        status: 'todo',
        scheduled_start: '2026-03-01T09:00:00.000Z',
        scheduled_end: null,
        due_date: null,
        estimated_duration_minutes: 30,
        is_all_day: false,
        completed_at: null,
        tags: [],
        recurrence_rule_id: ruleId,
        occurrence_index: 1,
        created_by: null,
        assigned_to: null,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      });

      await expect(
        makeTaskRecurring(client, WS_ID, taskId, {
          frequency: 'weekly',
          interval: 1,
          timezone: 'UTC',
        })
      ).rejects.toThrow('Task is already part of a recurring series.');
    });
  });
});
