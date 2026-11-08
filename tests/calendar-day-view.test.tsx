import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CalendarDayView } from '../src/components/calendar/CalendarDayView';
import { CalendarWeekView } from '../src/components/calendar/CalendarWeekView';
import { CalendarMonthView } from '../src/components/calendar/CalendarMonthView';
import { getDayRange, getWeekRange, getMonthGrid } from '../src/lib/temporal/calendar';
import {
  buildCalendarItemColorMap,
  resolveCalendarItemColor,
} from '../src/lib/calendar/item-colors';
import type { ContentItemWithMeta } from '../src/lib/services/content-service';
import type { TaskWithMeta } from '../src/lib/services/task-service';

function task(overrides: Partial<TaskWithMeta>): TaskWithMeta {
  return {
    id: 'one',
    title: 'Write the brief',
    scheduled_start: '2026-11-05T07:30:00Z',
    scheduled_end: '2026-11-05T09:00:00Z',
    is_all_day: false,
    status: 'todo',
    priority: 'medium',
    ...overrides,
  } as TaskWithMeta;
}

function renderDay(tasks: TaskWithMeta[], content: ContentItemWithMeta[] = []) {
  return renderToStaticMarkup(
    <CalendarDayView
      dayRange={getDayRange('2026-11-05T12:00:00Z', 'Africa/Cairo')}
      taskItems={tasks}
      contentItems={content}
      userTimeZone="Africa/Cairo"
      onSelectTask={() => {}}
      onSelectContent={() => {}}
      onScheduleAtHour={() => {}}
      onScheduleAtTime={() => {}}
    />
  );
}

describe('Day visualizer (Compact 24h Overview Strip & Chronological Agenda)', () => {
  it('lists workspace-assigned day tasks exclusively in the Assigned panel', () => {
    const html = renderDay([
      task({}),
      task({ id: 'all', title: 'All-day planning', is_all_day: true }),
      task({ id: 'other', title: 'Tomorrow task', scheduled_start: '2026-11-05T23:30:00Z' }),
    ]);
    expect(html).toContain('day-task-list-one');
    expect(html).toContain('day-task-list-all');
    expect(html).not.toContain('data-testid="day-task-one"');
    expect(html.match(/All-day planning/g)).toHaveLength(1);
    expect(html).not.toContain('data-testid="day-task-all"');
    expect(html).not.toContain('Tomorrow task');
  });

  it('routes calendar entries to the chronological agenda and 24h strip, and tab entries to the assigned panel', () => {
    const html = renderDay(
      [
        task({}),
        task({ id: 'calendar', title: 'Calendar appointment', created_from: 'calendar' }),
        task({ id: 'calendar-all', title: 'Calendar all day', created_from: 'calendar', is_all_day: true }),
      ],
      [
        {
          id: 'tab',
          title: 'Content tab entry',
          scheduled_at: '2026-11-05T07:30:00Z',
          created_from: 'content',
        },
        {
          id: 'calendar-post',
          title: 'Calendar post',
          scheduled_at: '2026-11-05T08:00:00Z',
          created_from: 'calendar',
        },
      ] as ContentItemWithMeta[]
    );
    expect(html).toContain('data-testid="day-task-list-one"');
    expect(html).toContain('data-testid="day-content-list-tab"');
    expect(html).not.toContain('data-testid="day-content-tab"');
    expect(html).toContain('data-testid="day-task-calendar"');
    expect(html).not.toContain('data-testid="day-task-list-calendar"');
    expect(html).toContain('data-testid="day-content-calendar-post"');
    expect(html).not.toContain('data-testid="day-content-list-calendar-post"');
    expect(html.match(/Calendar all day/g)).toHaveLength(1);
  });

  it('plots blocks proportionally on the 24-hour strip, shows durations, and flags overlapping events in the agenda', () => {
    const html = renderDay(
      [],
      [
        {
          id: 'one',
          title: 'First post',
          scheduled_at: '2026-11-05T07:30:00Z',
          duration_minutes: 90,
          created_from: 'calendar',
        },
        {
          id: 'two',
          title: 'Second post',
          scheduled_at: '2026-11-05T08:00:00Z',
          duration_minutes: 60,
          created_from: 'calendar',
        },
      ] as ContentItemWithMeta[]
    );
    // Compact 24h overview strip & chronological agenda are rendered instead of a 1728px vertical grid
    expect(html).toContain('data-testid="day-overview-strip"');
    expect(html).toContain('data-testid="day-chronological-agenda"');
    expect(html).not.toContain('height:1728px');

    // Both overlapping blocks are flagged with overlap badges and stacked in separate lanes on the 24h strip
    expect(html).toContain('data-testid="day-overlap-content-one"');
    expect(html).toContain('data-testid="day-overlap-content-two"');
    expect(html).toContain('top:6px;height:20px');
    expect(html).toContain('top:30px;height:20px');
    expect(html).toContain('9:30 AM');
    expect(html).toContain('1h 30m');
  });

  it('surfaces early-morning (12:35 AM) and late-night (11:15 PM) items in the 24-hour overview strip and agenda', () => {
    // In Africa/Cairo (UTC+2 in Nov):
    // 2026-11-04T22:35:00Z = 12:35 AM local on Nov 5
    // 2026-11-05T21:15:00Z = 11:15 PM local on Nov 5
    const html = renderDay(
      [
        task({
          id: 'early-bird',
          title: 'Midnight migration check',
          scheduled_start: '2026-11-04T22:35:00Z',
          scheduled_end: '2026-11-04T23:05:00Z',
          created_from: 'calendar',
        }),
        task({
          id: 'night-owl',
          title: 'Late telemetry verification',
          scheduled_start: '2026-11-05T21:15:00Z',
          scheduled_end: '2026-11-05T21:45:00Z',
          created_from: 'calendar',
        }),
      ],
      []
    );
    expect(html).toContain('data-testid="day-task-early-bird"');
    expect(html).toContain('data-testid="day-jump-task-early-bird"');
    expect(html).toContain('data-testid="day-early-indicator"');
    expect(html).toContain('12:35 AM');

    expect(html).toContain('data-testid="day-task-night-owl"');
    expect(html).toContain('data-testid="day-jump-task-night-owl"');
    expect(html).toContain('data-testid="day-late-indicator"');
    expect(html).toContain('11:15 PM');
  });

  it('renders Week view with uncluttered day headers and an accessible overflow control when a day has > 4 items', () => {
    const week = getWeekRange('2026-11-05T12:00:00Z', 'Africa/Cairo');
    const manyTasks: TaskWithMeta[] = Array.from({ length: 6 }, (_, idx) =>
      task({
        id: `t-${idx + 1}`,
        title: `Long strategic editorial task title number ${idx + 1} for Thursday`,
        scheduled_start: `2026-11-05T${String(7 + idx).padStart(2, '0')}:00:00Z`,
        scheduled_end: `2026-11-05T${String(8 + idx).padStart(2, '0')}:00:00Z`,
        created_from: 'calendar',
      })
    );

    const html = renderToStaticMarkup(
      <CalendarWeekView
        weekDays={week.days}
        items={[]}
        tasks={manyTasks}
        userTimeZone="Africa/Cairo"
        onOpenDetail={() => {}}
        onOpenTaskDetail={() => {}}
        onSelectDay={() => {}}
        onScheduleOnDate={() => {}}
      />
    );

    expect(html).toContain('data-testid="calendar-week-grid"');
    expect(html).toContain('data-testid="week-task-t-1"');
    expect(html).toContain('data-testid="week-task-t-4"');
    // 5th and 6th items are collapsed behind the accessible +2 more items button
    expect(html).not.toContain('data-testid="week-task-t-5"');
    expect(html).toContain('data-testid="week-day-more-2026-11-05"');
    expect(html).toContain('+2 more items');
  });

  it('assigns automatic, stable, distinct colors to overlapping and adjacent items across Day strip, agenda, Week, and Month views', () => {
    const t1 = task({
      id: 'alpha-task',
      title: 'Architecture Review',
      scheduled_start: '2026-11-05T07:00:00Z',
      scheduled_end: '2026-11-05T08:30:00Z',
      created_from: 'calendar',
    });
    const t2 = task({
      id: 'beta-task',
      title: 'Design Critique',
      scheduled_start: '2026-11-05T07:30:00Z',
      scheduled_end: '2026-11-05T09:00:00Z',
      created_from: 'calendar',
    });
    const c1 = {
      id: 'gamma-post',
      title: 'Launch Thread',
      body: 'Shipping v2 today',
      platform: 'x',
      action_type: 'post',
      status: 'scheduled',
      scheduled_at: '2026-11-05T08:00:00Z',
      duration_minutes: 60,
      created_from: 'calendar',
      tags: [],
    } as unknown as ContentItemWithMeta;

    const colorMapForward = buildCalendarItemColorMap([t1, t2], [c1], 'Africa/Cairo');
    const colorMapReversed = buildCalendarItemColorMap([t2, t1], [c1], 'Africa/Cairo');

    const cAlpha = resolveCalendarItemColor('task', t1, colorMapForward);
    const cBeta = resolveCalendarItemColor('task', t2, colorMapForward);
    const cGamma = resolveCalendarItemColor('content', c1, colorMapForward);

    // 1. Overlapping/adjacent items on the same day receive visibly distinct palette indices
    expect(cAlpha.index).not.toBe(cBeta.index);
    expect(cBeta.index).not.toBe(cGamma.index);
    expect(cAlpha.index).not.toBe(cGamma.index);

    // 2. Colors remain 100% invariant to input array order
    expect(resolveCalendarItemColor('task', t1, colorMapReversed).name).toBe(cAlpha.name);
    expect(resolveCalendarItemColor('task', t2, colorMapReversed).name).toBe(cBeta.name);
    expect(resolveCalendarItemColor('content', c1, colorMapReversed).name).toBe(cGamma.name);

    // 3. Same item color is used consistently across 24h overview strip, agenda, Week view, and Month view
    const dayHtml = renderToStaticMarkup(
      <CalendarDayView
        dayRange={getDayRange('2026-11-05T12:00:00Z', 'Africa/Cairo')}
        taskItems={[t1, t2]}
        contentItems={[c1]}
        userTimeZone="Africa/Cairo"
        itemColorMap={colorMapForward}
        onSelectTask={() => {}}
        onSelectContent={() => {}}
      />
    );
    expect(dayHtml).toContain(`data-testid="day-jump-task-alpha-task" data-cal-color="${cAlpha.name}"`);
    expect(dayHtml).toContain(`data-testid="day-task-alpha-task" data-cal-color="${cAlpha.name}"`);
    expect(dayHtml).toContain(`data-testid="day-jump-content-gamma-post" data-cal-color="${cGamma.name}"`);
    expect(dayHtml).toContain(`data-testid="day-content-gamma-post" data-cal-color="${cGamma.name}"`);

    const weekHtml = renderToStaticMarkup(
      <CalendarWeekView
        weekDays={getWeekRange('2026-11-05T12:00:00Z', 'Africa/Cairo').days}
        items={[c1]}
        tasks={[t1, t2]}
        userTimeZone="Africa/Cairo"
        itemColorMap={colorMapForward}
        onOpenDetail={() => {}}
        onOpenTaskDetail={() => {}}
      />
    );
    expect(weekHtml).toContain(`data-testid="week-task-alpha-task" data-cal-color="${cAlpha.name}"`);
    expect(weekHtml).toContain(`data-testid="week-content-gamma-post" data-cal-color="${cGamma.name}"`);

    const monthHtml = renderToStaticMarkup(
      <CalendarMonthView
        monthGrid={getMonthGrid('2026-11-05T12:00:00Z', 'Africa/Cairo')}
        items={[c1]}
        tasks={[t1, t2]}
        userTimeZone="Africa/Cairo"
        itemColorMap={colorMapForward}
        onOpenDetail={() => {}}
        onOpenTaskDetail={() => {}}
        onSelectDate={() => {}}
      />
    );
    expect(monthHtml).toContain(`data-testid="month-task-alpha-task" data-cal-color="${cAlpha.name}"`);
    expect(monthHtml).toContain(`data-testid="month-content-gamma-post" data-cal-color="${cGamma.name}"`);
  });

  it('assigns consistent colors to recurring task occurrences sharing a recurrence_rule_id', () => {
    const occ1 = task({
      id: 'rec-task-1',
      recurrence_rule_id: 'rule-daily-standup',
      title: 'Daily Standup',
      scheduled_start: '2026-11-05T07:00:00Z',
      created_from: 'calendar',
    });
    const occ2 = task({
      id: 'rec-task-2',
      recurrence_rule_id: 'rule-daily-standup',
      title: 'Daily Standup',
      scheduled_start: '2026-11-06T07:00:00Z',
      created_from: 'calendar',
    });

    const colorMap = buildCalendarItemColorMap([occ1, occ2], [], 'Africa/Cairo');
    const color1 = resolveCalendarItemColor('task', occ1, colorMap);
    const color2 = resolveCalendarItemColor('task', occ2, colorMap);

    expect(color1.name).toBe(color2.name);
    expect(color1.colorClass).toBe(color2.colorClass);
  });

  it('shows Tasks-tab tasks with a due_date (and null scheduled_start) in the Assigned to this day area rather than the Calendar agenda', () => {
    const dueOnlyTask = task({
      id: 'tasks-tab-due-only',
      title: 'Add sources for proposal on Moodle',
      scheduled_start: null,
      scheduled_end: null,
      due_date: '2026-11-05T19:02:00Z',
      created_from: 'tasks',
    });

    const html = renderToStaticMarkup(
      <CalendarDayView
        dayRange={getDayRange('2026-11-05T12:00:00Z', 'Africa/Cairo')}
        taskItems={[dueOnlyTask]}
        contentItems={[]}
        userTimeZone="Africa/Cairo"
        onSelectTask={() => {}}
        onSelectContent={() => {}}
      />
    );

    expect(html).toContain('Assigned to this day');
    expect(html).toContain('data-testid="day-task-list-tasks-tab-due-only"');
    expect(html).toContain('Add sources for proposal on Moodle');
    expect(html).toContain('Due 9:02 PM');
    expect(html).not.toContain('data-testid="day-task-tasks-tab-due-only"');
    expect(html).not.toContain('data-testid="day-jump-task-tasks-tab-due-only"');
  });
});
