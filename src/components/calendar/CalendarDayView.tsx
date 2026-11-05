'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Clock, Plus, Share2 } from 'lucide-react';
import type { ContentItemWithMeta } from '@/lib/services/content-service';
import type { TaskWithMeta } from '@/lib/services/task-service';
import type { DayRange } from '@/lib/temporal/calendar';
import { getCalendarDateKey, getItemHourInTimeZone, getLocalParts } from '@/lib/temporal/calendar';
import { formatInTimeZone, DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';
import clsx from 'clsx';

interface CalendarDayViewProps {
  dayRange: DayRange;
  contentItems: ContentItemWithMeta[];
  taskItems: TaskWithMeta[];
  userTimeZone?: string;
  onSelectContent: (item: ContentItemWithMeta) => void;
  onSelectTask: (task: TaskWithMeta) => void;
  onNewAtHour?: (dateKey: string, hour: number) => void;
  isLoading?: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 72;
function hourLabel(hour: number) {
  return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function CalendarDayView({
  dayRange, contentItems, taskItems, userTimeZone = DEFAULT_TIMEZONE,
  onSelectContent, onSelectTask, onNewAtHour, isLoading = false,
}: CalendarDayViewProps) {
  const [now, setNow] = useState(() => new Date());
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_HEIGHT;
  }, [dayRange.dateKey]);

  const isToday = getCalendarDateKey(now, userTimeZone) === dayRange.dateKey;
  const nowParts = getLocalParts(now, userTimeZone);
  const dayTasks = taskItems.filter((task) => task.scheduled_start &&
    getCalendarDateKey(task.scheduled_start, userTimeZone) === dayRange.dateKey)
    .sort((a, b) => Number(b.is_all_day) - Number(a.is_all_day) ||
      Date.parse(a.scheduled_start!) - Date.parse(b.scheduled_start!));
  const dayContent = contentItems.filter((item) => item.scheduled_at &&
    getCalendarDateKey(item.scheduled_at, userTimeZone) === dayRange.dateKey);
  const assignedTasks = dayTasks.filter((task) => task.created_from !== 'calendar');
  const assignedContent = dayContent.filter((item) => item.created_from !== 'calendar');
  const calendarAllDay = dayTasks.filter((task) => task.created_from === 'calendar' && task.is_all_day);
  const completed = assignedTasks.filter((task) => task.status === 'done').length;
  const timeLabel = (date: string) => formatInTimeZone(date, userTimeZone, {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const minuteOfDay = (date: string) => {
    const { hour, minute } = getItemHourInTimeZone(date, userTimeZone);
    return hour * 60 + minute;
  };
  const events = [
    ...dayContent.filter((item) => item.created_from === 'calendar').map((item) => {
      const start = minuteOfDay(item.scheduled_at!);
      return { id: `content-${item.id}`, title: item.title || item.body || 'Untitled content',
        start, end: Math.min(1440, start + Math.max(15, item.duration_minutes || 30)),
        time: timeLabel(item.scheduled_at!), select: () => onSelectContent(item) };
    }),
    ...dayTasks.filter((task) => task.created_from === 'calendar' && !task.is_all_day).map((task) => {
      const start = minuteOfDay(task.scheduled_start!);
      const end = task.scheduled_end
        ? getCalendarDateKey(task.scheduled_end, userTimeZone) > dayRange.dateKey
          ? 1440 : minuteOfDay(task.scheduled_end)
        : start + (task.estimated_duration_minutes || 30);
      return { id: `task-${task.id}`, title: task.title, start,
        end: Math.min(1440, Math.max(start + 15, end)),
        time: timeLabel(task.scheduled_start!), select: () => onSelectTask(task) };
    }),
  ].sort((a, b) => a.start - b.start || b.end - a.end);

  // Share the width only among events in the same overlapping group.
  const positioned: (typeof events[number] & { lane: number; lanes: number })[] = [];
  let group: typeof positioned = [];
  let groupEnd = 0;
  let laneEnds: number[] = [];
  const finishGroup = () => {
    for (const event of group) event.lanes = laneEnds.length;
    positioned.push(...group);
    group = [];
    laneEnds = [];
  };
  for (const event of events) {
    if (group.length && event.start >= groupEnd) finishGroup();
    let lane = laneEnds.findIndex((end) => end <= event.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = event.end;
    group.push({ ...event, lane, lanes: 1 });
    groupEnd = group.length === 1 ? event.end : Math.max(groupEnd, event.end);
  }
  finishGroup();

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950" aria-busy={isLoading}>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800 p-5">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-400">Day visualizer {isToday && '· Today'}</p>
          <h2 className="text-xl font-semibold tracking-tight text-white">{dayRange.label}</h2>
          <p className="mt-1 text-xs text-neutral-500">{userTimeZone} · {dayTasks.length} tasks · {dayContent.length} content</p>
        </div>
        {onNewAtHour && <button type="button" onClick={() => onNewAtHour(dayRange.dateKey, 9)} className="flex items-center gap-2 rounded-lg bg-emerald-400 px-3 py-2 text-xs font-semibold text-neutral-950 hover:bg-emerald-300"><Plus className="h-4 w-4" />Schedule</button>}
      </header>
      {isLoading && <p role="status" className="flex items-center gap-2 border-b border-neutral-800 p-3 text-xs text-emerald-300"><Clock className="h-3 w-3 animate-spin" />Loading schedule…</p>}
      <div className="grid lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside aria-label="Tasks and content assigned to this day" className="border-b border-neutral-800 lg:border-r lg:border-b-0">
          <div className="border-b border-neutral-800/70 p-5">
            <div className="flex justify-between text-sm"><h3 className="font-medium text-white">Assigned to this day</h3><span className="font-mono text-xs text-neutral-500">{completed}/{assignedTasks.length} tasks</span></div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-neutral-800"><div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${assignedTasks.length ? completed / assignedTasks.length * 100 : 0}%` }} /></div>
          </div>
          <div className="max-h-[360px] overflow-y-auto p-3 lg:max-h-[660px]">
            {assignedTasks.length === 0 && assignedContent.length === 0 && <p className="p-3 text-sm leading-relaxed text-neutral-500">No tasks or content assigned to this day.</p>}
            {assignedTasks.map((task) => <button key={task.id} type="button" onClick={() => onSelectTask(task)} data-testid={`day-task-list-${task.id}`} className="mb-1 flex w-full gap-3 rounded-xl p-3 text-left transition-colors hover:bg-neutral-900 focus-visible:outline-emerald-400">
              {task.status === 'done' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-neutral-600" />}
              <div className="min-w-0 flex-1">
                <p className={clsx('break-words text-sm font-medium', task.status === 'done' || task.status === 'cancelled' ? 'text-neutral-500 line-through' : 'text-neutral-200')}>{task.title}</p>
                <p className="mt-1 text-xs text-neutral-500">{task.is_all_day ? 'All day' : timeLabel(task.scheduled_start!)}{task.project && ` · ${task.project.name}`}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] capitalize"><span className={clsx('rounded px-1.5 py-0.5', task.priority === 'urgent' ? 'bg-red-500/10 text-red-400' : task.priority === 'high' ? 'bg-amber-500/10 text-amber-400' : 'bg-neutral-800 text-neutral-400')}>{task.priority}</span><span className="py-0.5 text-neutral-500">{task.status.replaceAll('_', ' ')}</span></div>
              </div>
            </button>)}
            {assignedContent.map((item) => <button key={item.id} type="button" onClick={() => onSelectContent(item)} data-testid={`day-content-list-${item.id}`} className="mb-1 flex w-full gap-3 rounded-xl p-3 text-left transition-colors hover:bg-neutral-900 focus-visible:outline-blue-400">
              <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
              <div className="min-w-0"><p className="break-words text-sm font-medium text-neutral-200">{item.title || item.body || 'Untitled content'}</p><p className="mt-1 text-xs text-neutral-500">{timeLabel(item.scheduled_at!)} · {item.platform}</p><p className="mt-2 text-[10px] capitalize text-neutral-500">{item.status}</p></div>
            </button>)}
          </div>
        </aside>
        <section aria-label="Day timeline" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 px-5 py-4 text-xs">
            <h3 className="font-medium text-neutral-200">Calendar entries</h3>
            <div className="flex gap-4 text-neutral-500"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-400" />Calendar</span></div>
          </div>
          {calendarAllDay.length > 0 && <div className="flex flex-wrap gap-2 border-b border-neutral-800 p-3"><span className="text-xs text-neutral-500">All day</span>{calendarAllDay.map((task) => <button key={task.id} type="button" onClick={() => onSelectTask(task)} className="rounded bg-blue-950 px-2 py-1 text-xs text-blue-200">{task.title}</button>)}</div>}
          <div ref={scrollRef} className="h-[660px] overflow-y-auto overscroll-contain" tabIndex={0} aria-label="24 hour schedule">
            <div className="relative" style={{ height: 24 * HOUR_HEIGHT }}>
              {HOURS.map((hour) => <div key={hour} data-testid={`day-hour-${hour}`} className="absolute inset-x-0 flex border-t border-neutral-800/60" style={{ top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }}>
                <span className="w-16 shrink-0 pt-2 pr-3 text-right font-mono text-[10px] text-neutral-500">{hourLabel(hour)}</span>
                <div className="flex-1 border-l border-neutral-800/60">{onNewAtHour && <button type="button" aria-label={`Schedule item at ${hourLabel(hour)}`} onClick={() => onNewAtHour(dayRange.dateKey, hour)} className="h-full w-full text-left text-neutral-600 transition-colors hover:bg-neutral-900/70 focus-visible:bg-neutral-900 focus-visible:outline-emerald-500"><Plus className="ml-2 h-3 w-3" /></button>}</div>
              </div>)}
              <div className="pointer-events-none absolute top-0 right-3 left-[72px] h-full">
                {positioned.map((event) => <button key={event.id} type="button" onClick={event.select} data-testid={`day-${event.id}`} title={`${event.title} · ${event.time}`} className="pointer-events-auto absolute overflow-hidden rounded-md border-l-2 border-blue-400 bg-blue-950 px-2 py-1 text-left text-blue-200 shadow-sm transition-[filter] hover:brightness-125 focus-visible:outline-white" style={{ top: event.start / 60 * HOUR_HEIGHT, height: (event.end - event.start) / 60 * HOUR_HEIGHT - 2, left: `${event.lane / event.lanes * 100}%`, width: `calc(${100 / event.lanes}% - 4px)` }}>
                  <div className="truncate text-xs font-medium"><Share2 className="mr-1 inline h-3 w-3" />{event.title}</div>
                  <p className="truncate text-[10px] opacity-60">{event.time}</p>
                </button>)}
              </div>
              {isToday && <div className="pointer-events-none absolute right-0 left-14 z-10 flex items-center" style={{ top: (nowParts.hour + nowParts.minute / 60) * HOUR_HEIGHT }}><span className="rounded bg-red-400 px-1 text-[9px] font-semibold text-neutral-950">NOW</span><div className="h-px flex-1 bg-red-400" /></div>}
            </div>
          </div>
          <p className="border-t border-neutral-800 px-4 py-2 text-[10px] text-neutral-500">Click a block for details · Select an empty hour to schedule</p>
        </section>
      </div>
    </div>
  );
}
