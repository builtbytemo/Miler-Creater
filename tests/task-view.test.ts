import { describe, expect, it } from 'vitest';
import { matchesTaskDate, sortTaskView } from '../src/lib/tasks/task-view';
import type { TaskWithMeta } from '../src/lib/services/task-service';
const task = (overrides: Partial<TaskWithMeta> = {}) => ({ id: 'one', status: 'todo', priority: 'medium', due_date: null, scheduled_start: null, ...overrides }) as TaskWithMeta;

describe('Task date filters and sorting', () => {
  it('uses the workspace timezone across midnight for Today', () => {
    expect(matchesTaskDate(task({ scheduled_start: '2026-11-04T23:30:00Z' }), 'today', '2026-11-05', 'Africa/Cairo')).toBe(true);
    expect(matchesTaskDate(task({ scheduled_start: '2026-11-05T23:30:00Z' }), 'today', '2026-11-05', 'Africa/Cairo')).toBe(false);
  });
  it('excludes completed and cancelled tasks from attention filters', () => {
    for (const status of ['done', 'cancelled'] as const) {
      expect(matchesTaskDate(task({ status, due_date: '2026-11-03T09:00:00Z' }), 'overdue', '2026-11-05', 'Africa/Cairo')).toBe(false);
    }
  });
  it('keeps tasks due today out of Overdue and requires no dates for No date', () => {
    expect(matchesTaskDate(task({ due_date: '2026-11-05T09:00:00Z' }), 'overdue', '2026-11-05', 'Africa/Cairo')).toBe(false);
    expect(matchesTaskDate(task(), 'unscheduled', '2026-11-05', 'Africa/Cairo')).toBe(true);
    expect(matchesTaskDate(task({ due_date: '2026-11-06T09:00:00Z' }), 'unscheduled', '2026-11-05', 'Africa/Cairo')).toBe(false);
  });
  it('sorts missing due dates last and leaves the input order intact', () => {
    const input = [task(), task({ id: 'two', due_date: '2026-11-06T09:00:00Z' })];
    expect(sortTaskView(input, 'due').map((item) => item.id)).toEqual(['two', 'one']);
    expect(input[0].id).toBe('one');
  });
  it('orders urgent tasks before low priority tasks', () => {
    expect(sortTaskView([task({ priority: 'low' }), task({ id: 'urgent', priority: 'urgent' })], 'priority')[0].id).toBe('urgent');
  });
});
