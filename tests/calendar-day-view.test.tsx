import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CalendarDayView } from '../src/components/calendar/CalendarDayView';
import { getDayRange } from '../src/lib/temporal/calendar';
import type { ContentItemWithMeta } from '../src/lib/services/content-service';
import type { TaskWithMeta } from '../src/lib/services/task-service';

function task(overrides: Partial<TaskWithMeta>): TaskWithMeta {
  return { id: 'one', title: 'Write the brief', scheduled_start: '2026-11-05T07:30:00Z',
    scheduled_end: '2026-11-05T09:00:00Z', is_all_day: false, status: 'todo',
    priority: 'medium', ...overrides } as TaskWithMeta;
}
function render(tasks: TaskWithMeta[], content: ContentItemWithMeta[] = []) {
  return renderToStaticMarkup(<CalendarDayView dayRange={getDayRange('2026-11-05T12:00:00Z', 'Africa/Cairo')}
    taskItems={tasks} contentItems={content} userTimeZone="Africa/Cairo"
    onSelectTask={() => {}} onSelectContent={() => {}} />);
}

describe('Day visualizer', () => {
  it('lists selected day tasks exclusively in the left panel', () => {
    const html = render([task({}), task({ id: 'all', title: 'All-day planning', is_all_day: true }),
      task({ id: 'other', title: 'Tomorrow task', scheduled_start: '2026-11-05T23:30:00Z' })]);
    expect(html).toContain('day-task-list-one');
    expect(html).toContain('day-task-list-all');
    expect(html).not.toContain('data-testid="day-task-one"');
    expect(html.match(/All-day planning/g)).toHaveLength(1);
    expect(html).not.toContain('data-testid="day-task-all"');
    expect(html).not.toContain('Tomorrow task');
  });

  it('routes calendar entries to the timeline and tab entries to the left panel', () => {
    const html = render([
      task({}),
      task({ id: 'calendar', title: 'Calendar appointment', created_from: 'calendar' }),
      task({ id: 'calendar-all', title: 'Calendar all day', created_from: 'calendar', is_all_day: true }),
    ], [
      { id: 'tab', title: 'Content tab entry', scheduled_at: '2026-11-05T07:30:00Z', created_from: 'content' },
      { id: 'calendar-post', title: 'Calendar post', scheduled_at: '2026-11-05T08:00:00Z', created_from: 'calendar' },
    ] as ContentItemWithMeta[]);
    expect(html).toContain('data-testid="day-task-list-one"');
    expect(html).toContain('data-testid="day-content-list-tab"');
    expect(html).not.toContain('data-testid="day-content-tab"');
    expect(html).toContain('data-testid="day-task-calendar"');
    expect(html).not.toContain('data-testid="day-task-list-calendar"');
    expect(html).toContain('data-testid="day-content-calendar-post"');
    expect(html).not.toContain('data-testid="day-content-list-calendar-post"');
    expect(html.match(/Calendar all day/g)).toHaveLength(1);
  });

  it('positions blocks at local minutes, uses duration, and separates overlapping events', () => {
    const html = render([], [
      { id: 'one', title: 'First post', scheduled_at: '2026-11-05T07:30:00Z', duration_minutes: 90, created_from: 'calendar' },
      { id: 'two', title: 'Second post', scheduled_at: '2026-11-05T08:00:00Z', duration_minutes: 60, created_from: 'calendar' },
    ] as ContentItemWithMeta[]);
    // 09:30 Cairo is 684 px from midnight; 90 minutes occupy 108 px less the gap.
    expect(html).toContain('top:684px;height:106px;left:0%;width:calc(50% - 4px)');
    expect(html).toContain('left:50%;width:calc(50% - 4px)');
    expect(html).toContain('9:30 AM');
  });
});
