import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, TaskStatus, TaskPriority } from '@/types/database';
import {
  generateOccurrencesInRange,
  projectOccurrencesInRange,
  type RecurrenceRuleParams,
} from '@/lib/temporal/recurrence';
import {
  getTasks,
} from '@/lib/services/task-service';
import { getUnifiedSchedule } from '@/lib/services/scheduling-service';
import {
  getStableCalendarItemIdentity,
  resolveCalendarItemColor,
  buildCalendarItemColorMap,
} from '@/lib/calendar/item-colors';

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

interface MockProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  color: string | null;
  status: string;
}

function createCalendarMockDatabase() {
  const tasks = new Map<string, MockTaskRow>();
  const rules = new Map<string, MockRuleRow>();
  const projects = new Map<string, MockProjectRow>();
  let insertCount = 0;
  let updateCount = 0;
  let deleteCount = 0;

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
            insertCount += Array.isArray(rows) ? rows.length : 1;
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({ data: null, error: null })),
              })),
            };
          }),
          update: vi.fn(() => {
            updateCount++;
            return {
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({ data: null, error: null })),
                })),
              })),
            };
          }),
          delete: vi.fn(() => {
            deleteCount++;
            return {
              eq: vi.fn(() => ({
                then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
              })),
            };
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

          if (table === 'projects') {
            return Array.from(projects.values()).filter((p) => {
              if (filters.workspace_id && p.workspace_id !== filters.workspace_id) return false;
              if (filters.id && p.id !== filters.id) return false;
              if (filters.status && p.status !== filters.status) return false;
              return true;
            });
          }

          if (table === 'tasks') {
            return Array.from(tasks.values())
              .filter((t) => {
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
                if (filters._in_id) {
                  const allowed = filters._in_id as string[];
                  if (!allowed.includes(t.id)) return false;
                }
                if (filters.status && t.status !== filters.status) return false;
                if (filters.project_id && t.project_id !== filters.project_id) return false;

                // Date range filters
                if (filters._gte_scheduled_start && t.scheduled_start) {
                  if (t.scheduled_start < (filters._gte_scheduled_start as string)) return false;
                }
                if (filters._lte_scheduled_start && t.scheduled_start) {
                  if (t.scheduled_start > (filters._lte_scheduled_start as string)) return false;
                }

                return true;
              })
              .map((t) => {
                const proj = t.project_id ? projects.get(t.project_id) : null;
                return {
                  ...t,
                  projects: proj ? { id: proj.id, name: proj.name, color: proj.color } : null,
                  project: proj ? { id: proj.id, name: proj.name, color: proj.color } : null,
                };
              });
          }

          if (table === 'task_dependencies' || table === 'content_items') {
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
    projects,
    createClient,
    getMutationCounts: () => ({ insertCount, updateCount, deleteCount }),
  };
}

describe('Stage 4: Virtual Calendar Projection System', () => {
  const WS_ID = '00000000-0000-0000-0000-000000000001';
  const OTHER_WS_ID = '99999999-9999-9999-9999-999999999999';

  describe('1. Canonical Recurrence Engine Projection (generateOccurrencesInRange & projectOccurrencesInRange)', () => {
    it('projects weekly Monday recurrence across 4+ weeks even when the initial occurrence is incomplete', () => {
      // 2026-03-02 is a Monday
      const initialStart = new Date('2026-03-02T09:00:00.000Z');
      const rule: RecurrenceRuleParams = {
        frequency: 'weekly',
        interval: 1,
        by_weekday: [1], // Monday
        timezone: 'UTC',
        dtstart: initialStart,
      };

      // Range: March 1, 2026 to March 31, 2026
      const rangeStart = new Date('2026-03-01T00:00:00.000Z');
      const rangeEnd = new Date('2026-03-31T23:59:59.999Z');

      const occurrences = generateOccurrencesInRange(rule, initialStart, rangeStart, rangeEnd);
      const detailed = projectOccurrencesInRange(rule, initialStart, rangeStart, rangeEnd);

      // Mondays in March 2026: March 2, 9, 16, 23, 30 -> exactly 5 occurrences
      expect(occurrences).toHaveLength(5);
      expect(detailed).toHaveLength(5);

      expect(occurrences[0].toISOString()).toBe('2026-03-02T09:00:00.000Z');
      expect(occurrences[1].toISOString()).toBe('2026-03-09T09:00:00.000Z');
      expect(occurrences[2].toISOString()).toBe('2026-03-16T09:00:00.000Z');
      expect(occurrences[3].toISOString()).toBe('2026-03-23T09:00:00.000Z');
      expect(occurrences[4].toISOString()).toBe('2026-03-30T09:00:00.000Z');

      // Occurrence indices must be sequential 1..5
      expect(detailed.map((d) => d.occurrenceIndex)).toEqual([1, 2, 3, 4, 5]);
    });

    it('projects future occurrences accurately with custom initialOccurrenceIndex and anchorDate', () => {
      const anchorDate = new Date('2026-03-02T09:00:00.000Z');
      const rule: RecurrenceRuleParams = {
        frequency: 'weekly',
        interval: 1,
        by_weekday: [1],
        timezone: 'UTC',
        dtstart: anchorDate,
      };

      // Active task is occurrence #2 on March 9
      const activeTaskStart = new Date('2026-03-09T09:00:00.000Z');
      // Range: March 15 to March 31
      const rangeStart = new Date('2026-03-15T00:00:00.000Z');
      const rangeEnd = new Date('2026-03-31T23:59:59.999Z');

      const detailed = projectOccurrencesInRange(
        rule,
        activeTaskStart,
        rangeStart,
        rangeEnd,
        100,
        {
          initialOccurrenceIndex: 2,
          anchorDate,
        }
      );

      // March 16 (index 3), March 23 (index 4), March 30 (index 5)
      expect(detailed).toHaveLength(3);
      expect(detailed[0].occurrenceIndex).toBe(3);
      expect(detailed[0].date.toISOString()).toBe('2026-03-16T09:00:00.000Z');
      expect(detailed[1].occurrenceIndex).toBe(4);
      expect(detailed[1].date.toISOString()).toBe('2026-03-23T09:00:00.000Z');
      expect(detailed[2].occurrenceIndex).toBe(5);
      expect(detailed[2].date.toISOString()).toBe('2026-03-30T09:00:00.000Z');
    });

    it('projects daily recurrence with arbitrary positive intervals (every 3 days)', () => {
      const initialStart = new Date('2026-04-01T10:00:00.000Z');
      const rule: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 3,
        timezone: 'UTC',
        dtstart: initialStart,
      };

      const occurrences = generateOccurrencesInRange(
        rule,
        initialStart,
        '2026-04-01T00:00:00.000Z',
        '2026-04-15T23:59:59.999Z'
      );

      // April 1, 4, 7, 10, 13
      expect(occurrences).toHaveLength(5);
      expect(occurrences.map((d) => d.toISOString())).toEqual([
        '2026-04-01T10:00:00.000Z',
        '2026-04-04T10:00:00.000Z',
        '2026-04-07T10:00:00.000Z',
        '2026-04-10T10:00:00.000Z',
        '2026-04-13T10:00:00.000Z',
      ]);
    });

    it('projects multiple weekdays (Mon, Wed, Fri) and biweekly interval without day drift', () => {
      // 2026-05-04 is Monday
      const initialStart = new Date('2026-05-04T14:00:00.000Z');
      const rule: RecurrenceRuleParams = {
        frequency: 'weekly',
        interval: 2, // Biweekly
        by_weekday: [1, 3, 5], // Mon, Wed, Fri
        timezone: 'UTC',
        dtstart: initialStart,
      };

      const occurrences = generateOccurrencesInRange(
        rule,
        initialStart,
        '2026-05-01T00:00:00.000Z',
        '2026-05-31T23:59:59.999Z'
      );

      // Week 1 (May 4..8): Mon May 4, Wed May 6, Fri May 8
      // Week 2 (May 11..15): SKIPPED (biweekly)
      // Week 3 (May 18..22): Mon May 18, Wed May 20, Fri May 22
      // Week 4 (May 25..29): SKIPPED (biweekly)
      expect(occurrences).toHaveLength(6);
      expect(occurrences.map((d) => d.toISOString())).toEqual([
        '2026-05-04T14:00:00.000Z',
        '2026-05-06T14:00:00.000Z',
        '2026-05-08T14:00:00.000Z',
        '2026-05-18T14:00:00.000Z',
        '2026-05-20T14:00:00.000Z',
        '2026-05-22T14:00:00.000Z',
      ]);
    });

    it('projects monthly recurrence without date drift for end-of-month dates (Jan 31)', () => {
      const initialStart = new Date('2026-01-31T12:00:00.000Z');
      const rule: RecurrenceRuleParams = {
        frequency: 'monthly',
        interval: 1,
        by_monthday: [31],
        timezone: 'UTC',
        dtstart: initialStart,
      };

      const occurrences = generateOccurrencesInRange(
        rule,
        initialStart,
        '2026-01-01T00:00:00.000Z',
        '2026-05-31T23:59:59.999Z'
      );

      // Jan 31 -> Feb 28 -> Mar 31 -> Apr 30 -> May 31
      expect(occurrences).toHaveLength(5);
      expect(occurrences[0].toISOString()).toBe('2026-01-31T12:00:00.000Z');
      expect(occurrences[1].toISOString()).toBe('2026-02-28T12:00:00.000Z');
      expect(occurrences[2].toISOString()).toBe('2026-03-31T12:00:00.000Z');
      expect(occurrences[3].toISOString()).toBe('2026-04-30T12:00:00.000Z');
      expect(occurrences[4].toISOString()).toBe('2026-05-31T12:00:00.000Z');
    });

    it('projects yearly recurrence with leap-year handling (Feb 29)', () => {
      const initialStart = new Date('2028-02-29T10:00:00.000Z'); // 2028 is a leap year
      const rule: RecurrenceRuleParams = {
        frequency: 'yearly',
        interval: 1,
        timezone: 'UTC',
        dtstart: initialStart,
      };

      const occurrences = generateOccurrencesInRange(
        rule,
        initialStart,
        '2028-01-01T00:00:00.000Z',
        '2032-12-31T23:59:59.999Z'
      );

      // 2028: Feb 29 (leap)
      // 2029: Feb 28
      // 2030: Feb 28
      // 2031: Feb 28
      // 2032: Feb 29 (leap)
      expect(occurrences).toHaveLength(5);
      expect(occurrences[0].toISOString()).toBe('2028-02-29T10:00:00.000Z');
      expect(occurrences[1].toISOString()).toBe('2029-02-28T10:00:00.000Z');
      expect(occurrences[2].toISOString()).toBe('2030-02-28T10:00:00.000Z');
      expect(occurrences[3].toISOString()).toBe('2031-02-28T10:00:00.000Z');
      expect(occurrences[4].toISOString()).toBe('2032-02-29T10:00:00.000Z');
    });

    it('enforces recurrence count termination boundary strictly', () => {
      const initialStart = new Date('2026-06-01T09:00:00.000Z'); // Monday
      const rule: RecurrenceRuleParams = {
        frequency: 'weekly',
        interval: 1,
        count: 3, // Total 3 occurrences scheduled in series
        timezone: 'UTC',
        dtstart: initialStart,
      };

      const occurrences = generateOccurrencesInRange(
        rule,
        initialStart,
        '2026-06-01T00:00:00.000Z',
        '2026-08-31T23:59:59.999Z'
      );

      // Must produce June 1, June 8, June 15 only (count = 3)
      expect(occurrences).toHaveLength(3);
      expect(occurrences.map((d) => d.toISOString())).toEqual([
        '2026-06-01T09:00:00.000Z',
        '2026-06-08T09:00:00.000Z',
        '2026-06-15T09:00:00.000Z',
      ]);
    });

    it('enforces recurrence until_date termination boundary strictly in timezone', () => {
      const initialStart = new Date('2026-07-01T08:00:00.000Z');
      const rule: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 1,
        until_date: '2026-07-04',
        timezone: 'UTC',
        dtstart: initialStart,
      };

      const occurrences = generateOccurrencesInRange(
        rule,
        initialStart,
        '2026-07-01T00:00:00.000Z',
        '2026-07-31T23:59:59.999Z'
      );

      // July 1, 2, 3, 4 (until end of July 4 UTC)
      expect(occurrences).toHaveLength(4);
      expect(occurrences.map((d) => d.toISOString().split('T')[0])).toEqual([
        '2026-07-01',
        '2026-07-02',
        '2026-07-03',
        '2026-07-04',
      ]);
    });

    it('preserves local wall-clock time across Egypt daylight saving time transitions', () => {
      // Egypt DST starts on the last Friday of April (April 24, 2026 at 00:00 -> 01:00)
      // Weekly task on Thursdays at 09:00 AM Africa/Cairo
      const initialStart = new Date('2026-04-16T07:00:00.000Z'); // 09:00 Cairo is UTC+2 (standard)
      const rule: RecurrenceRuleParams = {
        frequency: 'weekly',
        interval: 1,
        by_weekday: [4], // Thursday
        timezone: 'Africa/Cairo',
        dtstart: initialStart,
      };

      const occurrences = generateOccurrencesInRange(
        rule,
        initialStart,
        '2026-04-15T00:00:00.000Z',
        '2026-05-15T23:59:59.999Z'
      );

      // April 16: UTC+2 -> 07:00 UTC = 09:00 Cairo
      // April 23: UTC+2 -> 07:00 UTC = 09:00 Cairo
      // April 30: UTC+3 (DST active) -> 06:00 UTC = 09:00 Cairo
      // May 7:    UTC+3 (DST active) -> 06:00 UTC = 09:00 Cairo
      // May 14:   UTC+3 (DST active) -> 06:00 UTC = 09:00 Cairo
      expect(occurrences).toHaveLength(5);
      expect(occurrences[0].toISOString()).toBe('2026-04-16T07:00:00.000Z');
      expect(occurrences[1].toISOString()).toBe('2026-04-23T07:00:00.000Z');
      expect(occurrences[2].toISOString()).toBe('2026-04-30T06:00:00.000Z');
      expect(occurrences[3].toISOString()).toBe('2026-05-07T06:00:00.000Z');
      expect(occurrences[4].toISOString()).toBe('2026-05-14T06:00:00.000Z');
    });
  });

  describe('2. Service-Level Virtual Task Projection (projectVirtualTaskOccurrences & getTasks)', () => {
    let db: ReturnType<typeof createCalendarMockDatabase>;

    beforeEach(() => {
      db = createCalendarMockDatabase();
    });

    it('projects future virtual tasks for weekly recurring series without requiring completion of the initial task', async () => {
      const client = db.createClient();
      const ruleId = crypto.randomUUID();
      const taskId = crypto.randomUUID();

      // Rule: Weekly on Monday
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

      // Active task: Occurrence #1 on Monday March 2, incomplete (status: 'todo')
      db.tasks.set(taskId, {
        id: taskId,
        workspace_id: WS_ID,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Weekly Monday Strategy Sync',
        description: 'Review weekly sprints and milestones',
        priority: 'high',
        status: 'todo',
        scheduled_start: '2026-03-02T09:00:00.000Z',
        scheduled_end: '2026-03-02T10:00:00.000Z',
        due_date: '2026-03-02T12:00:00.000Z',
        estimated_duration_minutes: 60,
        is_all_day: false,
        completed_at: null,
        tags: ['sync', 'strategy'],
        recurrence_rule_id: ruleId,
        occurrence_index: 1,
        created_by: null,
        assigned_to: null,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
        created_from: 'calendar',
      });

      // Fetch tasks for all of March 2026
      const result = await getTasks(client, WS_ID, {
        scheduled_from: '2026-03-01T00:00:00.000Z',
        scheduled_to: '2026-03-31T23:59:59.999Z',
      });

      // Total items should be 5: 1 concrete (Mar 2) + 4 virtual (Mar 9, 16, 23, 30)
      expect(result).toHaveLength(5);

      const concrete = result[0];
      expect(concrete.id).toBe(taskId);
      expect(concrete.is_virtual).toBeUndefined();
      expect(concrete.scheduled_start).toBe('2026-03-02T09:00:00.000Z');

      const virtuals = result.slice(1);
      expect(virtuals).toHaveLength(4);

      // Verify virtual task attributes
      for (let i = 0; i < virtuals.length; i++) {
        const vt = virtuals[i];
        expect(vt.is_virtual).toBe(true);
        expect(vt.status).toBe('todo');
        expect(vt.title).toBe('Weekly Monday Strategy Sync');
        expect(vt.description).toBe('Review weekly sprints and milestones');
        expect(vt.priority).toBe('high');
        expect(vt.estimated_duration_minutes).toBe(60);
        expect(vt.recurrence_rule_id).toBe(ruleId);
        expect(vt.original_task_id).toBe(taskId);
        expect(vt.occurrence_index).toBe(i + 2); // 2, 3, 4, 5
        expect(vt.id).toMatch(/^virtual:/);
      }

      expect(virtuals[0].scheduled_start).toBe('2026-03-09T09:00:00.000Z');
      expect(virtuals[0].scheduled_end).toBe('2026-03-09T10:00:00.000Z');
      expect(virtuals[1].scheduled_start).toBe('2026-03-16T09:00:00.000Z');
      expect(virtuals[2].scheduled_start).toBe('2026-03-23T09:00:00.000Z');
      expect(virtuals[3].scheduled_start).toBe('2026-03-30T09:00:00.000Z');
    });

    it('gives stored occurrences precedence over virtual slots to eliminate duplicate items', async () => {
      const client = db.createClient();
      const ruleId = crypto.randomUUID();
      const task1Id = crypto.randomUUID();
      const task2Id = crypto.randomUUID();

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

      // Task 1: Completed on Mar 2
      db.tasks.set(task1Id, {
        id: task1Id,
        workspace_id: WS_ID,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Weekly Monday Sync',
        description: null,
        priority: 'medium',
        status: 'done',
        scheduled_start: '2026-03-02T09:00:00.000Z',
        scheduled_end: '2026-03-02T10:00:00.000Z',
        due_date: null,
        estimated_duration_minutes: 60,
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

      // Task 2: Active on Mar 9
      db.tasks.set(task2Id, {
        id: task2Id,
        workspace_id: WS_ID,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Weekly Monday Sync',
        description: null,
        priority: 'medium',
        status: 'todo',
        scheduled_start: '2026-03-09T09:00:00.000Z',
        scheduled_end: '2026-03-09T10:00:00.000Z',
        due_date: null,
        estimated_duration_minutes: 60,
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

      const result = await getTasks(client, WS_ID, {
        scheduled_from: '2026-03-01T00:00:00.000Z',
        scheduled_to: '2026-03-31T23:59:59.999Z',
      });

      // Total items: 5 slots (2 stored tasks + 3 virtual tasks)
      expect(result).toHaveLength(5);

      // Stored tasks for slot 1 and slot 2
      expect(result[0].id).toBe(task1Id);
      expect(result[0].occurrence_index).toBe(1);
      expect(result[0].is_virtual).toBeUndefined();

      expect(result[1].id).toBe(task2Id);
      expect(result[1].occurrence_index).toBe(2);
      expect(result[1].is_virtual).toBeUndefined();

      // Virtual slots for 3, 4, 5
      expect(result[2].occurrence_index).toBe(3);
      expect(result[2].is_virtual).toBe(true);
      expect(result[2].scheduled_start).toBe('2026-03-16T09:00:00.000Z');

      expect(result[3].occurrence_index).toBe(4);
      expect(result[3].is_virtual).toBe(true);
      expect(result[3].scheduled_start).toBe('2026-03-23T09:00:00.000Z');

      expect(result[4].occurrence_index).toBe(5);
      expect(result[4].is_virtual).toBe(true);
      expect(result[4].scheduled_start).toBe('2026-03-30T09:00:00.000Z');

      // No slot is duplicated
      const dates = result.map((t) => t.scheduled_start);
      const uniqueDates = new Set(dates);
      expect(uniqueDates.size).toBe(5);
    });

    it('projects series into future months even when the active task is overdue or far in the past', async () => {
      const client = db.createClient();
      const ruleId = crypto.randomUUID();
      const overdueTaskId = crypto.randomUUID();

      // Series started in January 2026
      db.rules.set(ruleId, {
        id: ruleId,
        workspace_id: WS_ID,
        frequency: 'weekly',
        interval: 1,
        by_weekday: [1], // Monday
        by_monthday: null,
        until_date: null,
        count: null,
        timezone: 'UTC',
        dtstart: '2026-01-05T09:00:00.000Z',
        total_occurrences_generated: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      });

      // Incomplete active task from January (overdue)
      db.tasks.set(overdueTaskId, {
        id: overdueTaskId,
        workspace_id: WS_ID,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Overdue Recurring Weekly Task',
        description: null,
        priority: 'urgent',
        status: 'todo',
        scheduled_start: '2026-01-05T09:00:00.000Z',
        scheduled_end: '2026-01-05T10:00:00.000Z',
        due_date: '2026-01-05T17:00:00.000Z',
        estimated_duration_minutes: 60,
        is_all_day: false,
        completed_at: null,
        tags: [],
        recurrence_rule_id: ruleId,
        occurrence_index: 1,
        created_by: null,
        assigned_to: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      });

      // User navigates to April 2026 calendar view
      const aprilTasks = await getTasks(client, WS_ID, {
        scheduled_from: '2026-04-01T00:00:00.000Z',
        scheduled_to: '2026-04-30T23:59:59.999Z',
      });

      // April 2026 Mondays: April 6, 13, 20, 27 -> 4 occurrences
      expect(aprilTasks).toHaveLength(4);
      for (const t of aprilTasks) {
        expect(t.is_virtual).toBe(true);
        expect(t.status).toBe('todo');
        expect(t.title).toBe('Overdue Recurring Weekly Task');
        expect(t.priority).toBe('urgent');
      }

      expect(aprilTasks.map((t) => t.scheduled_start)).toEqual([
        '2026-04-06T09:00:00.000Z',
        '2026-04-13T09:00:00.000Z',
        '2026-04-20T09:00:00.000Z',
        '2026-04-27T09:00:00.000Z',
      ]);
    });

    it('preserves series color stability between concrete and virtual occurrences', async () => {
      const client = db.createClient();
      const ruleId = crypto.randomUUID();
      const concreteTaskId = crypto.randomUUID();

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
        dtstart: '2026-08-01T09:00:00.000Z',
        total_occurrences_generated: 1,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      });

      const concreteTask: MockTaskRow = {
        id: concreteTaskId,
        workspace_id: WS_ID,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Daily Standup',
        description: null,
        priority: 'medium',
        status: 'todo',
        scheduled_start: '2026-08-01T09:00:00.000Z',
        scheduled_end: '2026-08-01T09:30:00.000Z',
        due_date: null,
        estimated_duration_minutes: 30,
        is_all_day: false,
        completed_at: null,
        tags: [],
        recurrence_rule_id: ruleId,
        occurrence_index: 1,
        created_by: null,
        assigned_to: null,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      };
      db.tasks.set(concreteTaskId, concreteTask);

      const tasks = await getTasks(client, WS_ID, {
        scheduled_from: '2026-08-01T00:00:00.000Z',
        scheduled_to: '2026-08-05T23:59:59.999Z',
      });

      expect(tasks).toHaveLength(5);
      const [firstConcrete, ...virtualOccurrences] = tasks;

      // Identity check
      const concreteIdentity = getStableCalendarItemIdentity('task', firstConcrete);
      expect(concreteIdentity).toBe(`task:recurrence:${ruleId}`);

      for (const vt of virtualOccurrences) {
        const virtualIdentity = getStableCalendarItemIdentity('task', vt);
        expect(virtualIdentity).toBe(concreteIdentity);
      }

      // Color mapping check
      const colorMap = buildCalendarItemColorMap(tasks, [], 'UTC');
      const concreteColor = resolveCalendarItemColor('task', firstConcrete, colorMap);

      for (const vt of virtualOccurrences) {
        const vtColor = resolveCalendarItemColor('task', vt, colorMap);
        expect(vtColor.name).toBe(concreteColor.name);
        expect(vtColor.colorClass).toBe(concreteColor.colorClass);
      }
    });

    it('enforces workspace isolation so recurring series from other workspaces never leak', async () => {
      const client = db.createClient();
      const ws1RuleId = crypto.randomUUID();
      const ws2RuleId = crypto.randomUUID();

      // Rule in Workspace 1
      db.rules.set(ws1RuleId, {
        id: ws1RuleId,
        workspace_id: WS_ID,
        frequency: 'daily',
        interval: 1,
        by_weekday: null,
        by_monthday: null,
        until_date: null,
        count: null,
        timezone: 'UTC',
        dtstart: '2026-09-01T10:00:00.000Z',
        total_occurrences_generated: 1,
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
      });
      db.tasks.set('task-ws-1', {
        id: 'task-ws-1',
        workspace_id: WS_ID,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Workspace 1 Task',
        description: null,
        priority: 'low',
        status: 'todo',
        scheduled_start: '2026-09-01T10:00:00.000Z',
        scheduled_end: null,
        due_date: null,
        estimated_duration_minutes: 30,
        is_all_day: false,
        completed_at: null,
        tags: [],
        recurrence_rule_id: ws1RuleId,
        occurrence_index: 1,
        created_by: null,
        assigned_to: null,
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
      });

      // Rule in Other Workspace
      db.rules.set(ws2RuleId, {
        id: ws2RuleId,
        workspace_id: OTHER_WS_ID,
        frequency: 'daily',
        interval: 1,
        by_weekday: null,
        by_monthday: null,
        until_date: null,
        count: null,
        timezone: 'UTC',
        dtstart: '2026-09-01T10:00:00.000Z',
        total_occurrences_generated: 1,
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
      });
      db.tasks.set('task-ws-2', {
        id: 'task-ws-2',
        workspace_id: OTHER_WS_ID,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Secret Other Workspace Task',
        description: null,
        priority: 'urgent',
        status: 'todo',
        scheduled_start: '2026-09-01T10:00:00.000Z',
        scheduled_end: null,
        due_date: null,
        estimated_duration_minutes: 30,
        is_all_day: false,
        completed_at: null,
        tags: [],
        recurrence_rule_id: ws2RuleId,
        occurrence_index: 1,
        created_by: null,
        assigned_to: null,
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
      });

      const ws1Tasks = await getTasks(client, WS_ID, {
        scheduled_from: '2026-09-01T00:00:00.000Z',
        scheduled_to: '2026-09-03T23:59:59.999Z',
      });

      expect(ws1Tasks.length).toBeGreaterThan(0);
      for (const t of ws1Tasks) {
        expect(t.workspace_id).toBe(WS_ID);
        expect(t.title).toBe('Workspace 1 Task');
        expect(t.recurrence_rule_id).toBe(ws1RuleId);
      }
    });

    it('ensures calendar projection is entirely read-only and causes zero database mutations', async () => {
      const client = db.createClient();
      const ruleId = crypto.randomUUID();
      const taskId = crypto.randomUUID();

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
        dtstart: '2026-10-05T09:00:00.000Z',
        total_occurrences_generated: 1,
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
      });
      db.tasks.set(taskId, {
        id: taskId,
        workspace_id: WS_ID,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Weekly Sync',
        description: null,
        priority: 'medium',
        status: 'todo',
        scheduled_start: '2026-10-05T09:00:00.000Z',
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
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
      });

      // Verify zero mutations before query
      expect(db.getMutationCounts()).toEqual({
        insertCount: 0,
        updateCount: 0,
        deleteCount: 0,
      });

      // Query month range with multiple virtual occurrences
      await getTasks(client, WS_ID, {
        scheduled_from: '2026-10-01T00:00:00.000Z',
        scheduled_to: '2026-10-31T23:59:59.999Z',
      });

      // Must remain 0 mutations after query
      expect(db.getMutationCounts()).toEqual({
        insertCount: 0,
        updateCount: 0,
        deleteCount: 0,
      });

      // Database map size remains unchanged
      expect(db.tasks.size).toBe(1);
    });
  });

  describe('3. Unified Scheduling Service Integration (getUnifiedSchedule)', () => {
    let db: ReturnType<typeof createCalendarMockDatabase>;

    beforeEach(() => {
      db = createCalendarMockDatabase();
    });

    it('returns virtual recurring occurrences in getUnifiedSchedule alongside concrete events', async () => {
      const client = db.createClient();
      const ruleId = crypto.randomUUID();
      const taskId = crypto.randomUUID();

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
        dtstart: '2026-11-02T09:00:00.000Z',
        total_occurrences_generated: 1,
        created_at: '2026-11-01T00:00:00.000Z',
        updated_at: '2026-11-01T00:00:00.000Z',
      });

      db.tasks.set(taskId, {
        id: taskId,
        workspace_id: WS_ID,
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Weekly Planning',
        description: null,
        priority: 'high',
        status: 'todo',
        scheduled_start: '2026-11-02T09:00:00.000Z',
        scheduled_end: '2026-11-02T10:00:00.000Z',
        due_date: null,
        estimated_duration_minutes: 60,
        is_all_day: false,
        completed_at: null,
        tags: [],
        recurrence_rule_id: ruleId,
        occurrence_index: 1,
        created_by: null,
        assigned_to: null,
        created_at: '2026-11-01T00:00:00.000Z',
        updated_at: '2026-11-01T00:00:00.000Z',
      });

      const schedule = await getUnifiedSchedule(client, WS_ID, {
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: '2026-11-30T23:59:59.999Z',
        userTimeZone: 'UTC',
        itemTypes: ['task'],
      });

      // Mondays in Nov 2026: Nov 2, 9, 16, 23, 30 -> 5 items
      expect(schedule.events).toHaveLength(5);

      const [firstEvent, ...virtualEvents] = schedule.events;
      expect(firstEvent.id).toBe(taskId);
      expect(firstEvent.isVirtual).toBeUndefined();

      expect(virtualEvents).toHaveLength(4);
      for (const ve of virtualEvents) {
        expect(ve.isVirtual).toBe(true);
        expect(ve.itemType).toBe('task');
        expect(ve.title).toBe('Weekly Planning');
        expect(ve.recurrenceRuleId).toBe(ruleId);
        expect(ve.originalTaskId).toBe(taskId);
        expect(ve.id).toMatch(/^virtual:/);
      }
    });
  });
});
