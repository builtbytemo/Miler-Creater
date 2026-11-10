import { describe, it, expect } from 'vitest';
import {
  createTaskSchema,
  updateTaskSchema,
  taskFilterSchema,
} from '../src/lib/validation/task';

describe('Task Engine Input Validation (Zod Schemas)', () => {
  describe('createTaskSchema', () => {
    it('accepts valid minimal task input', () => {
      const result = createTaskSchema.safeParse({
        title: 'Review production migration',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.priority).toBe('medium');
        expect(result.data.status).toBe('todo');
        expect(result.data.is_all_day).toBe(false);
      }
    });

    it('accepts full task payload with valid date range', () => {
      const result = createTaskSchema.safeParse({
        title: 'Design Q1 Strategy',
        description: 'Prepare presentation deck',
        priority: 'urgent',
        status: 'in_progress',
        scheduled_start: '2026-11-01T09:00:00Z',
        scheduled_end: '2026-11-01T10:30:00Z',
        due_date: '2026-11-02T17:00:00Z',
        is_all_day: false,
        estimated_duration_minutes: 90,
        project_id: '550e8400-e29b-41d4-a716-446655440000',
        tags: ['strategy', 'presentation'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid date range where scheduled_end is earlier than scheduled_start', () => {
      const result = createTaskSchema.safeParse({
        title: 'Invalid Date Task',
        scheduled_start: '2026-11-01T14:00:00Z',
        scheduled_end: '2026-11-01T13:00:00Z', // 1 hour earlier
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/Scheduled end time cannot be earlier/);
      }
    });

    it('rejects empty or whitespace-only task title', () => {
      expect(createTaskSchema.safeParse({ title: '' }).success).toBe(false);
      expect(createTaskSchema.safeParse({ title: '   ' }).success).toBe(false);
    });

    it('rejects invalid UUIDs for projects and parent tasks', () => {
      const result = createTaskSchema.safeParse({
        title: 'Invalid Project Reference',
        project_id: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('validates embedded recurrence input', () => {
      const result = createTaskSchema.safeParse({
        title: 'Weekly Team Standup',
        scheduled_start: '2026-11-02T08:00:00Z',
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          by_weekday: [1, 3, 5], // Mon, Wed, Fri
          timezone: 'Asia/Cairo',
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects custom frequency and invalid recurrence constraints', () => {
      // Rejects 'custom' frequency
      const customRes = createTaskSchema.safeParse({
        title: 'Custom Task',
        recurrence: {
          frequency: 'custom',
          interval: 1,
        },
      });
      expect(customRes.success).toBe(false);
      expect(customRes.error?.issues[0]?.message).toMatch(/Unsupported recurrence frequency/);

      // Rejects non-positive interval
      const zeroInterval = createTaskSchema.safeParse({
        title: 'Invalid Interval',
        recurrence: {
          frequency: 'daily',
          interval: 0,
        },
      });
      expect(zeroInterval.success).toBe(false);

      // Rejects duplicate weekdays
      const dupeWeekdays = createTaskSchema.safeParse({
        title: 'Dupe Weekdays',
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          by_weekday: [1, 1, 3],
        },
      });
      expect(dupeWeekdays.success).toBe(false);
      expect(dupeWeekdays.error?.issues[0]?.message).toMatch(/duplicate days/);

      // Rejects invalid monthdays (> 31)
      const invalidMonthday = createTaskSchema.safeParse({
        title: 'Invalid Monthday',
        recurrence: {
          frequency: 'monthly',
          interval: 1,
          by_monthday: [32],
        },
      });
      expect(invalidMonthday.success).toBe(false);

      // Rejects mutual exclusivity violation (until_date + count)
      const mutualTerm = createTaskSchema.safeParse({
        title: 'Mutual Term',
        recurrence: {
          frequency: 'daily',
          interval: 1,
          until_date: '2026-12-31T00:00:00Z',
          count: 5,
        },
      });
      expect(mutualTerm.success).toBe(false);
      expect(mutualTerm.error?.issues[0]?.message).toMatch(/Cannot specify both until_date and count/);

      // Rejects invalid timezone identifier
      const invalidTz = createTaskSchema.safeParse({
        title: 'Invalid TZ',
        recurrence: {
          frequency: 'daily',
          interval: 1,
          timezone: 'Jupiter/Europa',
        },
      });
      expect(invalidTz.success).toBe(false);
    });
  });

  describe('updateTaskSchema', () => {
    it('accepts partial updates', () => {
      const result = updateTaskSchema.safeParse({
        status: 'done',
      });
      expect(result.success).toBe(true);
    });

    it('enforces schedule end >= start on updates', () => {
      const result = updateTaskSchema.safeParse({
        scheduled_start: '2026-11-05T10:00:00Z',
        scheduled_end: '2026-11-05T09:00:00Z',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('taskFilterSchema', () => {
    it('validates filter parameters', () => {
      const result = taskFilterSchema.safeParse({
        status: ['todo', 'in_progress'],
        priority: 'high',
        search: 'proposal',
        project_id: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.success).toBe(true);
    });
  });
});
