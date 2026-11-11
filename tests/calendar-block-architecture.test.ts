/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { createTaskSchema, updateTaskSchema, taskFilterSchema } from '../src/lib/validation/task';
import { createTask, updateTask, getTasks } from '../src/lib/services/task-service';
import { buildSnapshotForUser } from '../src/lib/briefing/daily/generator';
import { renderEmail } from '../src/lib/briefing/daily/render-email';
import { renderTelegram } from '../src/lib/briefing/daily/render-telegram';
import { DATE, cairo, makeAdmin, task } from './helpers-briefing-content';

const snap = async (w: Parameters<typeof makeAdmin>[0], date = DATE) =>
  buildSnapshotForUser(makeAdmin(w).admin, 'u1', date);
const titles = (xs: Array<{ title: string }>) => xs.map((x) => x.title);

describe('Calendar Block Architecture & Explicit Entry Types', () => {
  describe('1. Validation schemas', () => {
    it('defaults entry_type to "task" when omitted', () => {
      const parsed = createTaskSchema.parse({
        title: 'Complete architecture write-up',
      });
      expect(parsed.entry_type).toBe('task');
    });

    it('accepts explicit "task" and "calendar_block"', () => {
      const parsedTask = createTaskSchema.parse({
        title: 'Review pull request',
        entry_type: 'task',
        created_from: 'tasks',
      });
      expect(parsedTask.entry_type).toBe('task');

      const parsedBlock = createTaskSchema.parse({
        title: 'Gym workout',
        entry_type: 'calendar_block',
        created_from: 'calendar',
        scheduled_start: '2026-11-12T16:00:00.000Z',
        scheduled_end: '2026-11-12T17:00:00.000Z',
      });
      expect(parsedBlock.entry_type).toBe('calendar_block');
    });

    it('rejects invalid entry types', () => {
      expect(() =>
        createTaskSchema.parse({
          title: 'Invalid',
          entry_type: 'meeting' as any,
        })
      ).toThrow();
    });

    it('updateTaskSchema accepts updating entry_type', () => {
      const updateToBlock = updateTaskSchema.parse({
        entry_type: 'calendar_block',
      });
      expect(updateToBlock.entry_type).toBe('calendar_block');

      const updateToTask = updateTaskSchema.parse({
        entry_type: 'task',
      });
      expect(updateToTask.entry_type).toBe('task');
    });

    it('taskFilterSchema accepts filtering by entry_type', () => {
      const filterSingle = taskFilterSchema.parse({
        entry_type: 'calendar_block',
      });
      expect(filterSingle.entry_type).toBe('calendar_block');

      const filterArray = taskFilterSchema.parse({
        entry_type: ['task', 'calendar_block'],
      });
      expect(filterArray.entry_type).toEqual(['task', 'calendar_block']);
    });
  });

  describe('2. Task service persistence & editing', () => {
    it('creates an actionable task with entry_type: "task" from tasks', async () => {
      let insertedPayload: any = null;
      const fakeSupabase: any = {
        from: () => ({
          insert: (payload: any) => {
            insertedPayload = payload;
            return {
              select: () => ({
                single: async () => ({
                  data: {
                    id: 'task-1',
                    workspace_id: 'ws-1',
                    title: payload.title,
                    entry_type: payload.entry_type,
                    created_from: payload.created_from,
                    status: 'todo',
                    priority: 'medium',
                    is_all_day: false,
                    tags: [],
                    subtasks: [],
                    dependencies: [],
                    projects: null,
                  },
                  error: null,
                }),
              }),
            };
          },
          select: () => ({
            eq: () => ({
              order: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        }),
      };

      const res = await createTask(fakeSupabase, 'ws-1', {
        title: 'Actionable to-do',
        created_from: 'tasks',
        entry_type: 'task',
      });

      expect(insertedPayload.entry_type).toBe('task');
      expect(insertedPayload.created_from).toBe('tasks');
      expect(res.title).toBe('Actionable to-do');
    });

    it('creates an actionable task from calendar with entry_type: "task"', async () => {
      let insertedPayload: any = null;
      const fakeSupabase: any = {
        from: () => ({
          insert: (payload: any) => {
            insertedPayload = payload;
            return {
              select: () => ({
                single: async () => ({
                  data: {
                    id: 'task-2',
                    workspace_id: 'ws-1',
                    title: payload.title,
                    entry_type: payload.entry_type,
                    created_from: payload.created_from,
                    status: 'todo',
                    priority: 'medium',
                    is_all_day: false,
                    tags: [],
                    subtasks: [],
                    dependencies: [],
                    projects: null,
                  },
                  error: null,
                }),
              }),
            };
          },
        }),
      };

      const res = await createTask(fakeSupabase, 'ws-1', {
        title: 'Calendar task with deadline',
        created_from: 'calendar',
        entry_type: 'task',
        scheduled_start: '2026-11-12T07:00:00.000Z',
      });

      expect(insertedPayload.entry_type).toBe('task');
      expect(insertedPayload.created_from).toBe('calendar');
      expect(res.title).toBe('Calendar task with deadline');
    });

    it('creates an explicit calendar block with entry_type: "calendar_block"', async () => {
      let insertedPayload: any = null;
      const fakeSupabase: any = {
        from: () => ({
          insert: (payload: any) => {
            insertedPayload = payload;
            return {
              select: () => ({
                single: async () => ({
                  data: {
                    id: 'block-1',
                    workspace_id: 'ws-1',
                    title: payload.title,
                    entry_type: payload.entry_type,
                    created_from: payload.created_from,
                    status: 'todo',
                    priority: 'medium',
                    is_all_day: false,
                    tags: [],
                    subtasks: [],
                    dependencies: [],
                    projects: null,
                  },
                  error: null,
                }),
              }),
            };
          },
        }),
      };

      const res = await createTask(fakeSupabase, 'ws-1', {
        title: 'Gym Session',
        created_from: 'calendar',
        entry_type: 'calendar_block',
        scheduled_start: '2026-11-12T16:00:00.000Z',
        scheduled_end: '2026-11-12T17:00:00.000Z',
      });

      expect(insertedPayload.entry_type).toBe('calendar_block');
      expect(insertedPayload.created_from).toBe('calendar');
      expect(res.title).toBe('Gym Session');
    });

    it('edits entry_type from task to calendar_block and vice versa', async () => {
      let updatedPayload: any = null;
      const fakeSupabase: any = {
        from: () => ({
          update: (payload: any) => {
            updatedPayload = payload;
            return {
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    single: async () => ({
                      data: {
                        id: 'item-1',
                        workspace_id: 'ws-1',
                        title: 'Updated item',
                        entry_type: payload.entry_type,
                        status: 'todo',
                        priority: 'medium',
                        is_all_day: false,
                        tags: [],
                        projects: null,
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          },
          select: () => ({
            eq: () => ({
              order: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        }),
      };

      const updated = await updateTask(fakeSupabase, 'ws-1', 'item-1', {
        entry_type: 'calendar_block',
      });

      expect(updatedPayload.entry_type).toBe('calendar_block');
      expect(updated.entry_type).toBe('calendar_block');
    });

    it('getTasks filters by entry_type', async () => {
      let queriedEntryType: any = null;
      const fakeSupabase: any = {
        from: () => {
          const q: any = {
            select: () => q,
            eq: (col: string, val: any) => {
              if (col === 'entry_type') queriedEntryType = val;
              return q;
            },
            is: () => q,
            in: () => q,
            order: () => q,
            then: (resolve: any) => resolve({ data: [], error: null }),
          };
          return q;
        },
      };

      await getTasks(fakeSupabase, 'ws-1', {
        entry_type: 'calendar_block',
      });
      expect(queriedEntryType).toBe('calendar_block');
    });
  });

  describe('3. Daily Briefing Snapshot & Channel Rendering', () => {
    it('pure calendar blocks appear ONLY in Day Finder and are excluded from Tasks and Telegram', async () => {
      const s = await snap({
        tasks: [
          task({
            title: 'Gym Session',
            entry_type: 'calendar_block',
            created_from: 'calendar',
            scheduled_start: cairo('18:00'),
            scheduled_end: cairo('19:00'),
          }),
          task({
            title: 'Ship Release v2.0',
            entry_type: 'task',
            created_from: 'tasks',
            scheduled_start: cairo('09:00'),
            due_date: cairo('17:00'),
          }),
        ],
      });

      // Tasks: pure calendar block is excluded; only the actionable task appears
      expect(titles(s.tasks)).toEqual(['Ship Release v2.0']);

      // Day Finder: contains only the calendar timeline block (Gym); ordinary tasks stay out of Day Finder
      expect(s.dayFinder.map((b) => b.name)).toEqual(['Gym Session']);

      // Telegram: includes the actionable task and completely excludes the calendar block and Day Finder
      const tg = renderTelegram(s).text;
      expect(tg).toContain('Ship Release v2.0');
      expect(tg).not.toContain('Gym Session');
      expect(tg).not.toContain('Day Finder');

      // Email: renders Architectural Atelier Planner with Tasks and Day Finder
      const email = renderEmail(s);
      expect(email.text).toContain('Ship Release v2.0 | Scheduled 9:00 AM · Due 5:00 PM');
      expect(email.text).toContain('Gym Session | 6:00 PM–7:00 PM');
      expect(email.html).toContain('>01 / </span>Tasks');
      expect(email.html).toContain('>02 / </span>Day Finder');
      expect(email.html).not.toContain('>03 / </span>');
    });

    it('actionable scheduled tasks appear in BOTH Tasks and Day Finder without duplication', async () => {
      const s = await snap({
        tasks: [
          task({
            title: 'Team Architecture Review',
            entry_type: 'task',
            created_from: 'calendar',
            scheduled_start: cairo('10:00'),
            scheduled_end: cairo('11:30'),
            due_date: cairo('17:00'),
          }),
        ],
      });

      // Present in Tasks
      expect(titles(s.tasks)).toEqual(['Team Architecture Review']);
      // Present in Day Finder
      expect(s.dayFinder.map((b) => b.name)).toEqual(['Team Architecture Review']);

      // No intra-section duplicate entries
      expect(s.tasks).toHaveLength(1);
      expect(s.dayFinder).toHaveLength(1);

      // Email lists it in Tasks with scheduled/due info and in Day Finder with start/end time
      const emailText = renderEmail(s).text;
      expect(emailText).toContain('Team Architecture Review | Scheduled 10:00 AM–11:30 AM · Due 5:00 PM');
      expect(emailText).toContain('Team Architecture Review | 10:00 AM–11:30 AM');
    });

    it('legacy calendar records without explicit entry_type default to "task" and remain actionable', async () => {
      const s = await snap({
        tasks: [
          task({
            title: 'Legacy Calendar Task',
            created_from: 'calendar',
            entry_type: null,
            scheduled_start: cairo('14:00'),
            due_date: null,
          }),
          task({
            title: 'Legacy Standard Task',
            created_from: 'tasks',
            entry_type: null,
            due_date: cairo('18:00'),
          }),
        ],
      });

      // Both retain their actionable task status
      expect(titles(s.tasks)).toEqual(['Legacy Calendar Task', 'Legacy Standard Task']);
      // Only the timeline item appears in Day Finder
      expect(s.dayFinder.map((b) => b.name)).toEqual(['Legacy Calendar Task']);
    });

    it('filters tasks and calendar blocks across multiple workspaces with strict authorization', async () => {
      const s = await snap({
        workspaces: [
          { id: 'w1', name: 'Engineering' },
          { id: 'w2', name: 'Personal' },
        ],
        members: [
          { workspace_id: 'w1', user_id: 'u1' },
          { workspace_id: 'w2', user_id: 'u1' },
        ],
        tasks: [
          task({
            workspace_id: 'w1',
            title: 'Sprint Planning',
            created_from: 'calendar',
            entry_type: 'task',
            scheduled_start: cairo('09:00'),
          }),
          task({
            workspace_id: 'w2',
            title: 'Dentist Appointment',
            entry_type: 'calendar_block',
            scheduled_start: cairo('15:00'),
            scheduled_end: cairo('16:00'),
          }),
          task({
            workspace_id: 'w3_unauthorized',
            title: 'Classified Task',
            entry_type: 'task',
            scheduled_start: cairo('11:00'),
          }),
        ],
      });

      // Tasks includes only authorized tasks
      expect(titles(s.tasks)).toEqual(['Sprint Planning']);
      expect(titles(s.tasks)).not.toContain('Classified Task');
      expect(titles(s.tasks)).not.toContain('Dentist Appointment');

      // Day Finder includes authorized timeline blocks
      expect(s.dayFinder.map((b) => b.name)).toEqual(['Sprint Planning', 'Dentist Appointment']);
      expect(s.dayFinder.map((b) => b.name)).not.toContain('Classified Task');
    });
  });
});
