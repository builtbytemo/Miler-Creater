import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, TaskPriority, TaskStatus } from '@/types/database';
import {
  calculateNextOccurrence,
  calculateNextUpcomingSlot,
  projectOccurrencesInRange,
  validateRecurrenceRule,
  formatRecurrenceSummary,
} from '@/lib/temporal/recurrence';
import { formatInTimeZone } from '@/lib/temporal/timezone';
import {
  createTask,
  completeTask,
  getTaskById,
  updateRecurrenceRule,
  stopRecurrence,
  type TaskWithMeta,
} from '@/lib/services/task-service';
import { getUnifiedSchedule } from '@/lib/services/scheduling-service';
import { dispatchTool } from '@/lib/mcp/dispatcher';
import { parseFriendlyCommand } from '../cli/commands.mjs';
import type { AIExecutionContext } from '@/lib/mcp/types';
import { createTaskAction } from '@/lib/actions/task-actions';

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
  notifyDomainEvent: vi.fn().mockResolvedValue({ id: 'mock-notif-e2e', status: 'delivered' }),
  getNotifications: vi.fn().mockResolvedValue([]),
  markNotificationAsRead: vi.fn().mockResolvedValue({ id: 'mock-notif-e2e', read_at: new Date().toISOString() }),
  markNotificationAsUnread: vi.fn().mockResolvedValue({ id: 'mock-notif-e2e', read_at: null }),
  markAllNotificationsAsRead: vi.fn().mockResolvedValue(1),
  dismissNotification: vi.fn().mockResolvedValue({ id: 'mock-notif-e2e', status: 'dismissed' }),
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

function createE2eMockDatabase() {
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
                // Simulate PostgreSQL unique index uq_tasks_single_active_per_series
                if (record.recurrence_rule_id && record.status !== 'done' && record.status !== 'cancelled') {
                  const existingActive = Array.from(tasks.values()).find(
                    (t) =>
                      t.workspace_id === record.workspace_id &&
                      t.recurrence_rule_id === record.recurrence_rule_id &&
                      t.status !== 'done' &&
                      t.status !== 'cancelled'
                  );
                  if (existingActive) {
                    return {
                      select: vi.fn(() => ({
                        single: vi.fn(async () => ({
                          data: null,
                          error: {
                            code: '23505',
                            message: 'duplicate key value violates unique constraint "uq_tasks_single_active_per_series"',
                          },
                        })),
                      })),
                    };
                  }
                }

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

          if (table === 'task_dependencies') return [];
          if (table === 'projects' || table === 'milestones') return [];
          return [];
        }

        return chain;
      }) as unknown as SupabaseClient<Database>['from'],
      rpc: vi.fn().mockImplementation(() => {
        return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Function not found' } });
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-e2e', email: 'e2e@example.com' } },
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

describe('Stage 7: Comprehensive Verification and Release Readiness', () => {
  const wsId = '33333333-3333-4333-a333-333333333333';
  const userId = 'user-e2e';
  let db: ReturnType<typeof createE2eMockDatabase>;
  let supabase: SupabaseClient<Database>;

  beforeEach(() => {
    db = createE2eMockDatabase();
    supabase = db.createClient();
    activeSupabaseClient = supabase;
  });

  const getMcpContext = (workspaceId = wsId, uid = userId): AIExecutionContext => ({
    workspaceId,
    userId: uid,
    actorId: uid,
    timeZone: 'Asia/Cairo',
    scopes: ['task:read', 'task:write', 'content:read', 'content:write'],
    supabase: db.createClient(),
  });

  // ===========================================================================
  // SECTION 1: REALISTIC USER JOURNEYS (Scenarios A through H)
  // ===========================================================================
  describe('1. User Journeys (Scenarios A through H)', () => {
    // Scenario A: Weekly task on Monday, incomplete, navigate 8 weeks
    it('Scenario A: projects 8 weekly Monday occurrences without database pre-generation', async () => {
      const task = await createTask(supabase, wsId, {
        title: 'Monday Executive Review',
        scheduled_start: '2026-11-02T10:00:00.000Z',
        scheduled_end: '2026-11-02T11:00:00.000Z',
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          by_weekday: [1], // Monday
        },
      });

      expect(task.recurrence_rule_id).toBeDefined();
      expect(db.tasks.size).toBe(1); // Exactly 1 real task row

      // View unified calendar across 8 weeks (Nov 1 to Dec 28)
      const schedule = await getUnifiedSchedule(supabase, wsId, {
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: '2026-12-28T23:59:59.000Z',
      });

      const events = schedule.events.filter((e) => e.title === 'Monday Executive Review');
      // Nov 2 (real), Nov 9, 16, 23, 30, Dec 7, 14, 21, 28 (virtual) = 9 events
      expect(events.length).toBe(9);

      // Verify that database was NOT polluted with pre-generated rows
      expect(db.tasks.size).toBe(1);

      // Verify virtual occurrence identities and attributes
      const virtualEvents = events.filter((e) => e.isVirtual);
      expect(virtualEvents.length).toBe(8);
      for (const ve of virtualEvents) {
        expect(ve.id).toMatch(/^virtual:/);
        expect(ve.recurrenceRuleId).toBe(task.recurrence_rule_id);
      }
    });

    // Scenario B: Complete an occurrence, next real occurrence generated, previous in history, no calendar duplicates
    it('Scenario B: completes occurrence, generates next real occurrence, preserves history with zero duplicates', async () => {
      const task = await createTask(supabase, wsId, {
        title: 'Weekly Standup',
        scheduled_start: '2026-11-16T09:00:00.000Z',
        scheduled_end: '2026-11-16T09:30:00.000Z',
        recurrence: {
          frequency: 'weekly',
          interval: 1,
        },
      });

      // Complete the task
      const completeRes = await completeTask(supabase, wsId, task.id);
      expect(completeRes.completedTask.status).toBe('done');
      expect(completeRes.completedTask.completed_at).toBeDefined();
      expect(completeRes.nextOccurrence).toBeDefined();
      expect(completeRes.nextOccurrence?.status).toBe('todo');
      expect(completeRes.nextOccurrence?.scheduled_start).toBe('2026-11-23T09:00:00.000Z');

      // Verify database state: exactly 2 task records
      expect(db.tasks.size).toBe(2);
      expect(db.tasks.get(task.id)?.status).toBe('done');
      expect(db.tasks.get(completeRes.nextOccurrence!.id)?.status).toBe('todo');

      // Check calendar for the 2-week period
      const schedule = await getUnifiedSchedule(supabase, wsId, {
        startDate: '2026-11-15T00:00:00.000Z',
        endDate: '2026-11-29T23:59:59.000Z',
      });

      const standupEvents = schedule.events.filter((e) => e.title === 'Weekly Standup');
      // Nov 16 (done), Nov 23 (todo, real), Nov 30 (outside range) -> 2 events in range
      expect(standupEvents.length).toBe(2);

      // Verify zero duplicate slots: distinct start times
      const startTimes = standupEvents.map((e) => e.startTime);
      expect(new Set(startTimes).size).toBe(standupEvents.length);
    });

    // Scenario C: Monthly task on the 31st, February clamping and return to 31st
    it('Scenario C: clamps January 31 to February 28/29 and returns to 31st in March', async () => {
      const rule = {
        frequency: 'monthly' as const,
        interval: 1,
        by_monthday: [31],
        timezone: 'Asia/Cairo',
      };

      // 1. Starting Jan 31 in non-leap year (2025)
      const jan31 = '2025-01-31T10:00:00.000Z';
      const febSlot = calculateNextOccurrence(rule, jan31);
      expect(febSlot).toBeDefined();
      expect(febSlot?.toISOString()).toBe('2025-02-28T10:00:00.000Z'); // Clamped to Feb 28

      // Next slot after Feb: must return to 31st in March (NO DATE DRIFT!)
      const marSlot = calculateNextOccurrence(rule, febSlot!, {
        anchorDate: jan31,
      });
      expect(marSlot).toBeDefined();
      expect(marSlot?.toISOString()).toBe('2025-03-31T10:00:00.000Z');

      // Next slot after March: clamps to April 30 (Egypt enters DST UTC+3 in late April, preserving 12:00 local time)
      const aprSlot = calculateNextOccurrence(rule, marSlot!, {
        anchorDate: jan31,
      });
      expect(aprSlot).toBeDefined();
      expect(aprSlot?.toISOString()).toBe('2025-04-30T09:00:00.000Z');
      expect(formatInTimeZone(aprSlot!, 'Asia/Cairo', { hour: '2-digit', minute: '2-digit', hour12: false })).toContain('12:00');

      // Next slot after April: returns to May 31 (still in DST UTC+3, preserving 12:00 local time)
      const maySlot = calculateNextOccurrence(rule, aprSlot!, {
        anchorDate: jan31,
      });
      expect(maySlot).toBeDefined();
      expect(maySlot?.toISOString()).toBe('2025-05-31T09:00:00.000Z');
      expect(formatInTimeZone(maySlot!, 'Asia/Cairo', { hour: '2-digit', minute: '2-digit', hour12: false })).toContain('12:00');

      // 2. Starting Jan 31 in leap year (2024) -> clamps to Feb 29
      const jan31Leap = '2024-01-31T10:00:00.000Z';
      const febLeapSlot = calculateNextOccurrence(rule, jan31Leap);
      expect(febLeapSlot).toBeDefined();
      expect(febLeapSlot?.toISOString()).toBe('2024-02-29T10:00:00.000Z'); // Clamped to Feb 29
    });

    // Scenario D: Count-limited recurrence stops at exact count
    it('Scenario D: count-limited series stops projections and actual generation at exact count', async () => {
      const task = await createTask(supabase, wsId, {
        title: '3-Part Workshop',
        scheduled_start: '2026-11-16T14:00:00.000Z',
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          count: 3,
        },
      });

      // 1. Projections across full year must only project 3 occurrences total (including first)
      const projections = projectOccurrencesInRange(
        {
          frequency: 'weekly',
          interval: 1,
          count: 3,
        },
        task.scheduled_start!,
        '2026-11-01T00:00:00.000Z',
        '2027-11-01T00:00:00.000Z'
      );
      expect(projections.length).toBe(3);
      expect(projections.map((p) => p.occurrenceIndex)).toEqual([1, 2, 3]);

      // 2. Complete Occurrence 1 -> spawns Occurrence 2
      const res1 = await completeTask(supabase, wsId, task.id);
      expect(res1.nextOccurrence?.occurrence_index).toBe(2);

      // Complete Occurrence 2 -> spawns Occurrence 3
      const res2 = await completeTask(supabase, wsId, res1.nextOccurrence!.id);
      expect(res2.nextOccurrence?.occurrence_index).toBe(3);

      // Complete Occurrence 3 -> count limit 3 reached -> NO MORE OCCURRENCES!
      const res3 = await completeTask(supabase, wsId, res2.nextOccurrence!.id);
      expect(res3.completedTask.status).toBe('done');
      expect(res3.nextOccurrence).toBeNull(); // Terminal!
    });

    // Scenario E: Modify existing recurrence rule, future updates, completed history unchanged
    it('Scenario E: modifying recurrence updates future projections while completed history remains intact', async () => {
      // 1. Create weekly task
      const task = await createTask(supabase, wsId, {
        title: 'Status Report',
        scheduled_start: '2026-11-16T09:00:00.000Z',
        recurrence: {
          frequency: 'weekly',
          interval: 1,
        },
      });

      // Complete Occurrence 1
      const completeRes = await completeTask(supabase, wsId, task.id);
      expect(completeRes.nextOccurrence).toBeDefined();

      // 2. Update recurrence rule of entire series from weekly to daily
      await updateRecurrenceRule(supabase, wsId, task.recurrence_rule_id!, {
        frequency: 'daily',
        interval: 1,
      });

      // 3. Completed task in history remains unchanged
      const completedTask = await getTaskById(supabase, wsId, task.id);
      expect(completedTask?.status).toBe('done');
      expect(completedTask?.scheduled_start).toBe('2026-11-16T09:00:00.000Z');

      // 4. Projections for the remaining active series reflect the new daily schedule
      const schedule = await getUnifiedSchedule(supabase, wsId, {
        startDate: '2026-11-23T00:00:00.000Z',
        endDate: '2026-11-27T23:59:59.000Z',
      });
      const activeEvents = schedule.events.filter((e) => e.title === 'Status Report');
      // Daily: Nov 23 (real), Nov 24, 25, 26, 27 (virtual) = 5 events
      expect(activeEvents.length).toBe(5);
    });

    // Scenario F: Stop recurring series, no new instances or previews
    it('Scenario F: stopping recurrence terminates future projections and detaches active task', async () => {
      const task = await createTask(supabase, wsId, {
        title: 'Temporary Daily Check-in',
        scheduled_start: '2026-11-16T08:00:00.000Z',
        recurrence: {
          frequency: 'daily',
          interval: 1,
        },
      });

      // Stop recurrence series
      await stopRecurrence(supabase, wsId, task.recurrence_rule_id!, {
        targetTaskId: task.id,
      });

      // Active task is detached as standalone task
      const reloadedTask = await getTaskById(supabase, wsId, task.id);
      expect(reloadedTask?.recurrence_rule_id).toBeNull();

      // Recurrence rule is capped
      const rule = db.rules.get(task.recurrence_rule_id!);
      expect(rule?.until_date).toBeDefined();

      // Query schedule: zero future virtual occurrences appear
      const schedule = await getUnifiedSchedule(supabase, wsId, {
        startDate: '2026-11-16T00:00:00.000Z',
        endDate: '2026-11-30T23:59:59.000Z',
      });
      const checkinEvents = schedule.events.filter((e) => e.title === 'Temporary Daily Check-in');
      // Only the detached original task appears (Nov 16), zero virtual previews
      expect(checkinEvents.length).toBe(1);
      expect(checkinEvents[0].isVirtual).toBeFalsy();
    });

    // Scenario G: Recurring task with subtasks, fresh incomplete subtasks in next occurrence
    it('Scenario G: clones subtask template in fresh incomplete state on next occurrence', async () => {
      const parent = await createTask(supabase, wsId, {
        title: 'Bi-Weekly Payroll',
        scheduled_start: '2026-11-16T12:00:00.000Z',
        recurrence: {
          frequency: 'weekly',
          interval: 2,
        },
      });

      // Add 3 subtasks with mixed states
      const s1 = await createTask(supabase, wsId, {
        parent_task_id: parent.id,
        title: 'Review time logs',
        status: 'done',
      });
      const s2 = await createTask(supabase, wsId, {
        parent_task_id: parent.id,
        title: 'Calculate tax deductions',
        status: 'in_progress',
      });
      const s3 = await createTask(supabase, wsId, {
        parent_task_id: parent.id,
        title: 'Initiate bank transfers',
        status: 'todo',
      });

      // Complete parent task
      const completeRes = await completeTask(supabase, wsId, parent.id);
      const nextParent = completeRes.nextOccurrence!;
      expect(nextParent).toBeDefined();

      // Original subtasks remain intact
      expect(db.tasks.get(s1.id)?.status).toBe('done');
      expect(db.tasks.get(s2.id)?.status).toBe('in_progress');
      expect(db.tasks.get(s3.id)?.status).toBe('todo');

      // Next parent has fresh copies of all 3 subtasks
      const childTasks = Array.from(db.tasks.values()).filter((t) => t.parent_task_id === nextParent.id);
      expect(childTasks.length).toBe(3);
      for (const ct of childTasks) {
        expect(ct.status).toBe('todo');
        expect(ct.completed_at).toBeNull();
      }
      expect(childTasks.map((c) => c.title).sort()).toEqual([
        'Calculate tax deductions',
        'Initiate bank transfers',
        'Review time logs',
      ]);
    });

    // Scenario H: Cross-interface lifecycle parity (UI, MCP, CLI, Server Actions)
    it('Scenario H: maintains consistent lifecycle across UI, MCP, and CLI pathways', async () => {
      // 1. Create via UI server action
      const form = new FormData();
      form.set('workspace_id', wsId);
      form.set('title', 'Cross-Interface Series');
      form.set('scheduled_start', '2026-11-16T10:00:00.000Z');
      form.set('recurrence_frequency', 'weekly');
      form.set('recurrence_interval', '1');
      const uiCreateRes = await createTaskAction(null, form);
      const task = uiCreateRes.data as TaskWithMeta;

      // 2. Complete via MCP change_task_status
      const mcpContext = getMcpContext(wsId, userId);
      const mcpComplete = await dispatchTool('change_task_status', { task_id: task.id, status: 'done' }, mcpContext);
      expect(mcpComplete.success).toBe(true);
      const nextOcc = (mcpComplete.data as Record<string, unknown>).next_occurrence as TaskWithMeta;
      expect(nextOcc.occurrence_index).toBe(2);

      // 3. Stop recurrence via CLI parsed command
      const cliCommand = parseFriendlyCommand(['tasks', 'update', nextOcc.id, '--stop-recurrence']);
      const cliRes = await dispatchTool(cliCommand!.name, cliCommand!.arguments, mcpContext);
      expect(cliRes.success).toBe(true);

      const reloadedTask = await getTaskById(supabase, wsId, nextOcc.id);
      expect(reloadedTask?.recurrence_rule_id).toBeNull();
    });
  });

  // ===========================================================================
  // SECTION 2: TEMPORAL ENGINE & CALENDAR INTEGRITY
  // ===========================================================================
  describe('2. Temporal Engine & Calendar Integrity', () => {
    // Leap year handling
    it('handles leap year Feb 29 recurring yearly across non-leap and leap years', () => {
      const rule = {
        frequency: 'yearly' as const,
        interval: 1,
        by_monthday: [29],
        timezone: 'Asia/Cairo',
      };

      const feb29_2028 = '2028-02-29T10:00:00.000Z'; // Leap year
      // 2029 (non-leap): clamps to Feb 28
      const slot2029 = calculateNextOccurrence(rule, feb29_2028);
      expect(slot2029?.toISOString()).toBe('2029-02-28T10:00:00.000Z');

      // 2030 (non-leap): clamps to Feb 28
      const slot2030 = calculateNextOccurrence(rule, slot2029!, { anchorDate: feb29_2028 });
      expect(slot2030?.toISOString()).toBe('2030-02-28T10:00:00.000Z');

      // 2032 (leap year): returns to Feb 29!
      const slot2031 = calculateNextOccurrence(rule, slot2030!, { anchorDate: feb29_2028 });
      const slot2032 = calculateNextOccurrence(rule, slot2031!, { anchorDate: feb29_2028 });
      expect(slot2032?.toISOString()).toBe('2032-02-29T10:00:00.000Z');
    });

    // Daylight Saving Time transitions
    it('preserves local wall-clock time across Egypt (Asia/Cairo) DST transitions', () => {
      const rule = {
        frequency: 'daily' as const,
        interval: 1,
        timezone: 'Asia/Cairo',
      };

      // Egypt DST transition in April 2026: clocks move from 00:00 to 01:00 on April 24/25
      const beforeDst = '2026-04-23T07:00:00.000Z'; // 07:00 UTC = 09:00 AM Cairo (UTC+2)
      const afterDst = calculateNextOccurrence(rule, beforeDst);
      expect(afterDst).toBeDefined();

      // Format in Asia/Cairo timezone to verify local wall clock remains 09:00:00
      expect(formatInTimeZone(afterDst!, 'Asia/Cairo', { hour: '2-digit', minute: '2-digit', hour12: false })).toContain('09:00');
    });

    it('preserves local wall-clock time across US (America/New_York) DST transition', () => {
      const rule = {
        frequency: 'daily' as const,
        interval: 1,
        timezone: 'America/New_York',
      };

      // US DST spring transition: Sunday, March 8, 2026
      const mar7 = '2026-03-07T19:00:00.000Z'; // 19:00 UTC = 2:00 PM EST (UTC-5)
      const mar8 = calculateNextOccurrence(rule, mar7);
      const mar9 = calculateNextOccurrence(rule, mar8!);

      const nyFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      expect(nyFormatter.format(mar8!)).toBe('2:00 PM');
      expect(nyFormatter.format(mar9!)).toBe('2:00 PM');
    });

    // Multi-weekday weekly recurrence with interval > 1
    it('schedules correctly across week boundaries for multi-weekday rules with interval > 1', () => {
      const rule = {
        frequency: 'weekly' as const,
        interval: 2, // Every 2 weeks
        by_weekday: [1, 3, 5], // Mon, Wed, Fri
        timezone: 'Asia/Cairo',
      };

      const anchor = '2026-11-02T10:00:00.000Z'; // Monday (Week 1)
      const wedSlot = calculateNextOccurrence(rule, anchor); // Wed Week 1
      expect(wedSlot?.toISOString()).toBe('2026-11-04T10:00:00.000Z');

      const friSlot = calculateNextOccurrence(rule, wedSlot!, { anchorDate: anchor }); // Fri Week 1
      expect(friSlot?.toISOString()).toBe('2026-11-06T10:00:00.000Z');

      // Next slot after Friday must jump over Week 2 to Monday of Week 3 (Nov 16)
      const nextMonSlot = calculateNextOccurrence(rule, friSlot!, { anchorDate: anchor });
      expect(nextMonSlot?.toISOString()).toBe('2026-11-16T10:00:00.000Z');
    });

    // Date-only until_date cutoff
    it('interprets until_date at end-of-day in target timezone', () => {
      const rule = {
        frequency: 'daily' as const,
        interval: 1,
        until_date: '2026-11-30', // Date-only
        timezone: 'Asia/Cairo',
      };

      const nov29 = '2026-11-29T10:00:00.000Z';
      const nov30 = calculateNextOccurrence(rule, nov29);
      expect(nov30).toBeDefined();
      expect(nov30?.toISOString()).toBe('2026-11-30T10:00:00.000Z');

      // Next slot on Dec 1 is after until_date cutoff
      const dec1 = calculateNextOccurrence(rule, nov30!);
      expect(dec1).toBeNull();
    });

    // Late completion with calculateNextUpcomingSlot
    it('advances overdue recurrence cleanly to upcoming future slot without backlog accumulation', () => {
      const rule = {
        frequency: 'daily' as const,
        interval: 1,
        timezone: 'Asia/Cairo',
      };

      const scheduledStart = '2026-11-01T09:00:00.000Z';
      const completionTime = '2026-11-10T12:00:00.000Z'; // Completed 9 days late

      const result = calculateNextUpcomingSlot(rule, scheduledStart, completionTime, {
        occurrenceIndex: 1,
      });

      expect(result).toBeDefined();
      expect(result?.skippedSlots).toBe(9);
      expect(result?.nextOccurrenceIndex).toBe(11);
      expect(result?.nextSlot.toISOString()).toBe('2026-11-11T09:00:00.000Z');
    });

    // Legacy recurrence records with missing optional fields
    it('handles legacy recurrence records gracefully with fallback defaults', () => {
      const legacyRule = {
        frequency: 'daily' as const,
        interval: 1,
        // Missing dtstart, count, until_date, timezone
      };

      const nextSlot = calculateNextOccurrence(legacyRule, '2026-11-10T10:00:00.000Z');
      expect(nextSlot).toBeDefined();
      expect(nextSlot?.toISOString()).toBe('2026-11-11T10:00:00.000Z');
    });

    // Formatter completeness
    it('formats human-readable summary for all cadence combinations', () => {
      expect(formatRecurrenceSummary({ frequency: 'daily', interval: 1 })).toBe('Repeats daily');
      expect(formatRecurrenceSummary({ frequency: 'daily', interval: 3 })).toBe('Repeats every 3 days');
      expect(formatRecurrenceSummary({ frequency: 'weekly', interval: 1, by_weekday: [1, 5] })).toBe(
        'Repeats weekly on Monday, Friday'
      );
      expect(formatRecurrenceSummary({ frequency: 'monthly', interval: 1, by_monthday: [15] })).toBe(
        'Repeats monthly on day 15'
      );
      expect(formatRecurrenceSummary({ frequency: 'yearly', interval: 1 })).toBe('Repeats yearly');
      expect(
        formatRecurrenceSummary({
          frequency: 'daily',
          count: 5,
          total_occurrences_generated: 2,
        })
      ).toBe('Repeats daily · 5 occurrences total (2 generated)');
    });
  });

  // ===========================================================================
  // SECTION 3: TRANSACTIONAL SAFETY & REGRESSION GUARDS
  // ===========================================================================
  describe('3. Transactional Safety & Regression Guards', () => {
    it('handles direct updateTask status: done and prevents duplicate concurrent completions', async () => {
      const task = await createTask(supabase, wsId, {
        title: 'Concurrent Safety Task',
        scheduled_start: '2026-11-16T10:00:00.000Z',
        recurrence: { frequency: 'daily', interval: 1 },
      });

      // Simulate 2 near-simultaneous completions
      const [res1, res2] = await Promise.all([
        completeTask(supabase, wsId, task.id),
        completeTask(supabase, wsId, task.id),
      ]);

      expect(res1.completedTask.status).toBe('done');
      expect(res2.completedTask.status).toBe('done');

      // Both requests resolve safely to the SAME next occurrence without duplicates
      expect(res1.nextOccurrence?.id).toBe(res2.nextOccurrence?.id);
      expect(db.tasks.size).toBe(2);
    });

    it('rejects invalid recurrence configurations at rule validation level', () => {
      expect(() => validateRecurrenceRule({ frequency: 'custom', interval: 1 })).toThrow(
        "Unsupported recurrence frequency: 'custom'"
      );
      expect(() => validateRecurrenceRule({ frequency: 'daily', interval: 0 })).toThrow(
        'Interval must be a positive integer >= 1'
      );
      expect(() =>
        validateRecurrenceRule({ frequency: 'weekly', interval: 1, by_weekday: [1, 1] })
      ).toThrow('by_weekday cannot contain duplicate days');
      expect(() =>
        validateRecurrenceRule({ frequency: 'daily', interval: 1, until_date: '2026-12-01', count: 5 })
      ).toThrow('Cannot specify both until_date and count');
    });
  });
});
