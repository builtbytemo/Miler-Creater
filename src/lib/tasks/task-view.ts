import type { TaskWithMeta } from '@/lib/services/task-service';
import { getCalendarDateKey } from '@/lib/temporal/calendar';

export type TaskDateFilter = 'all' | 'today' | 'overdue' | 'unscheduled';
export type TaskSort = 'default' | 'due' | 'priority' | 'newest';
export function matchesTaskDate(
  task: TaskWithMeta,
  filter: TaskDateFilter,
  today: string,
  timeZone: string,
  referenceNowMs?: number
) {
  if (filter === 'all') return true;
  if (filter === 'unscheduled') return !task.scheduled_start && !task.due_date;
  if (task.status === 'done' || task.status === 'cancelled') return false;
  if (filter === 'overdue') {
    if (!task.due_date) return false;
    if (getCalendarDateKey(task.due_date, timeZone) < today) return true;
    if (referenceNowMs !== undefined && Number.isFinite(referenceNowMs)) {
      const dueMs = Date.parse(task.due_date);
      return !Number.isNaN(dueMs) && dueMs < referenceNowMs;
    }
    return false;
  }
  return [task.scheduled_start, task.due_date].some((date) => date && getCalendarDateKey(date, timeZone) === today);
}
export function sortTaskView(tasks: TaskWithMeta[], sort: TaskSort) {
  const result = [...tasks];
  const rank = { urgent: 0, high: 1, medium: 2, low: 3 };
  if (sort === 'priority') result.sort((a, b) => rank[a.priority] - rank[b.priority]);
  if (sort === 'newest') result.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (sort === 'due') result.sort((a, b) => {
    if (!a.due_date) return b.due_date ? 1 : 0;
    if (!b.due_date) return -1;
    return Date.parse(a.due_date) - Date.parse(b.due_date);
  });
  return result;
}
