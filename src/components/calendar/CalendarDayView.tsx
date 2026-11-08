'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  CheckSquare,
  Clock,
  Layers,
  Moon,
  Plus,
  Share2,
  Sparkles,
  Sun,
} from 'lucide-react';
import type { ContentItemWithMeta } from '@/lib/services/content-service';
import type { TaskWithMeta } from '@/lib/services/task-service';
import {
  getCalendarDateKey,
  getItemHourInTimeZone,
  type DayRange,
} from '@/lib/temporal/calendar';
import { PLATFORM_CONFIG, STATUS_CONFIG, ACTION_CONFIG } from '@/components/content/ContentCard';
import {
  buildCalendarItemColorMap,
  resolveCalendarItemColor,
  type CalendarItemColorToken,
  type CalendarItemColorMap,
} from '@/lib/calendar/item-colors';
import type { TaskPriority, TaskStatus, SocialPlatform } from '@/types/database';

interface CalendarDayViewProps {
  dayRange: DayRange;
  taskItems?: TaskWithMeta[];
  contentItems?: ContentItemWithMeta[];
  userTimeZone: string;
  itemColorMap?: CalendarItemColorMap;
  onSelectTask: (task: TaskWithMeta) => void;
  onSelectContent: (item: ContentItemWithMeta) => void;
  onScheduleAtHour?: (hour: number) => void;
  onScheduleAtTime?: (timeHHMM: string) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

const PRIORITY_BADGE_MAP: Record<TaskPriority, { label: string; badgeClass: string }> = {
  urgent: { label: 'Urgent', badgeClass: 'badge-danger' },
  high: { label: 'High', badgeClass: 'badge-warning' },
  medium: { label: 'Medium', badgeClass: 'badge-info' },
  low: { label: 'Low', badgeClass: 'badge-neutral' },
};

const TASK_STATUS_LABELS: Record<TaskStatus, { label: string; badgeClass: string }> = {
  todo: { label: 'To Do', badgeClass: 'badge-neutral' },
  in_progress: { label: 'In Progress', badgeClass: 'badge-info' },
  blocked: { label: 'Blocked', badgeClass: 'badge-danger' },
  done: { label: 'Completed', badgeClass: 'badge-success' },
  cancelled: { label: 'Cancelled', badgeClass: 'badge-neutral' },
};

const PLATFORM_PILL_MAP: Record<SocialPlatform, { label: string; pillClass: string }> = {
  x: {
    label: 'X',
    pillClass: 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border-[var(--border-strong)]',
  },
  linkedin: {
    label: 'LinkedIn',
    pillClass: 'badge-info',
  },
  reddit: {
    label: 'Reddit',
    pillClass: 'badge-warning',
  },
  threads: {
    label: 'Threads',
    pillClass: 'badge-neutral',
  },
};

function formatHourShort(hour: number): string {
  if (hour === 0) return '12a';
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return '12p';
  return `${hour - 12}p`;
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return '12:00 AM';
  if (hour < 12) return `${hour}:00 AM`;
  if (hour === 12) return '12:00 PM';
  return `${hour - 12}:00 PM`;
}

function formatMinutes(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0m';
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
  if (hrs > 0) return `${hrs}h`;
  return `${mins}m`;
}

function getPeriodTag(startMinutes: number): { label: string; isOffHours: boolean } {
  if (startMinutes < 7 * 60) return { label: 'Early morning', isOffHours: true };
  if (startMinutes < 12 * 60) return { label: 'Morning', isOffHours: false };
  if (startMinutes < 17 * 60) return { label: 'Afternoon', isOffHours: false };
  if (startMinutes < 20 * 60) return { label: 'Evening', isOffHours: false };
  return { label: 'Late night', isOffHours: true };
}

interface TimelineEvent {
  id: string;
  type: 'task' | 'content';
  title: string;
  subtitle: string;
  statusLabel: string;
  statusBadgeClass: string;
  start: number;
  end: number;
  durationMinutes: number;
  lane: number;
  lanes: number;
  overlapCount: number;
  colorToken: CalendarItemColorToken;
  task?: TaskWithMeta;
  content?: ContentItemWithMeta;
}

function layoutTimelineEvents(
  events: Omit<TimelineEvent, 'lane' | 'lanes' | 'overlapCount'>[]
): TimelineEvent[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const positioned: TimelineEvent[] = [];
  let cluster: TimelineEvent[] = [];
  let clusterEnd = -1;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    for (const ev of cluster) {
      let assigned = laneEnds.findIndex((end) => end <= ev.start);
      if (assigned === -1) {
        assigned = laneEnds.length;
        laneEnds.push(ev.end);
      } else {
        laneEnds[assigned] = ev.end;
      }
      ev.lane = assigned;
    }
    const totalLanes = Math.max(1, laneEnds.length);
    for (const ev of cluster) {
      ev.lanes = totalLanes;
      const concurrent = cluster.filter(
        (other) => other.id !== ev.id && other.start < ev.end && other.end > ev.start
      );
      ev.overlapCount = concurrent.length;
      positioned.push(ev);
    }
    cluster = [];
  };

  for (const raw of sorted) {
    const ev: TimelineEvent = { ...raw, lane: 0, lanes: 1, overlapCount: 0 };
    if (cluster.length > 0 && ev.start >= clusterEnd) {
      flushCluster();
      clusterEnd = -1;
    }
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.end);
  }
  flushCluster();
  return positioned;
}

export function CalendarDayView({
  dayRange,
  taskItems = [],
  contentItems = [],
  userTimeZone,
  itemColorMap,
  onSelectTask,
  onSelectContent,
  onScheduleAtHour,
  onScheduleAtTime,
}: CalendarDayViewProps) {
  const [customTime, setCustomTime] = useState('09:00');

  const todayDateKey = useMemo(
    () => getCalendarDateKey(new Date(), userTimeZone),
    [userTimeZone]
  );
  const isToday = dayRange.dateKey === todayDateKey;

  const resolvedColorMap = useMemo(
    () => itemColorMap || buildCalendarItemColorMap(taskItems, contentItems, userTimeZone),
    [itemColorMap, taskItems, contentItems, userTimeZone]
  );

  // Filter items to the exact local dayKey and split between:
  // 1. Calendar-Scheduled Time Blocks & All-Day (created_from === 'calendar') -> Scheduled Agenda & 24h Strip
  // 2. Workspace-Assigned Items (created_from !== 'calendar') -> Assigned to this day Panel
  const { dayListTasks, dayListItems, calendarAllDayTasks, events } = useMemo(() => {
    const listTasks: TaskWithMeta[] = [];
    const listItems: ContentItemWithMeta[] = [];
    const allDayCalendarTasks: TaskWithMeta[] = [];
    const rawEvents: Omit<TimelineEvent, 'lane' | 'lanes' | 'overlapCount'>[] = [];

    for (const task of taskItems) {
      if (task.created_from === 'calendar') {
        if (!task.scheduled_start) continue;
        if (getCalendarDateKey(task.scheduled_start, userTimeZone) !== dayRange.dateKey) continue;

        if (task.is_all_day) {
          allDayCalendarTasks.push(task);
          continue;
        }

        const { hour, minute } = getItemHourInTimeZone(task.scheduled_start, userTimeZone);
        const start = hour * 60 + minute;
        let duration = task.estimated_duration_minutes || 60;
        if (task.scheduled_end) {
          const endMs = new Date(task.scheduled_end).getTime();
          const startMs = new Date(task.scheduled_start).getTime();
          const diffMin = Math.round((endMs - startMs) / 60000);
          if (diffMin > 0) duration = diffMin;
        }
        const end = Math.min(24 * 60, Math.max(start + 30, start + duration));
        const statusInfo = TASK_STATUS_LABELS[task.status] || TASK_STATUS_LABELS.todo;
        const colorToken = resolveCalendarItemColor('task', task, resolvedColorMap);
        rawEvents.push({
          id: `task-${task.id}`,
          type: 'task',
          title: task.title,
          subtitle: `${PRIORITY_BADGE_MAP[task.priority]?.label || task.priority} priority`,
          statusLabel: statusInfo.label,
          statusBadgeClass: statusInfo.badgeClass,
          start,
          end,
          durationMinutes: end - start,
          colorToken,
          task,
        });
      } else {
        const scheduledMatches =
          Boolean(task.scheduled_start) &&
          getCalendarDateKey(task.scheduled_start!, userTimeZone) === dayRange.dateKey;
        const dueMatches =
          Boolean(task.due_date) &&
          getCalendarDateKey(task.due_date!, userTimeZone) === dayRange.dateKey;
        if (!scheduledMatches && !dueMatches) continue;
        listTasks.push(task);
      }
    }

    for (const item of contentItems) {
      if (!item.scheduled_at) continue;
      if (getCalendarDateKey(item.scheduled_at, userTimeZone) !== dayRange.dateKey) continue;

      if (item.created_from === 'calendar') {
        const { hour, minute } = getItemHourInTimeZone(item.scheduled_at, userTimeZone);
        const start = hour * 60 + minute;
        const duration = item.duration_minutes || 45;
        const end = Math.min(24 * 60, Math.max(start + 30, start + duration));
        const platformLabel = PLATFORM_CONFIG[item.platform]?.label || item.platform;
        const statusLabel = STATUS_CONFIG[item.status]?.label || item.status;
        const colorToken = resolveCalendarItemColor('content', item, resolvedColorMap);
        rawEvents.push({
          id: `content-${item.id}`,
          type: 'content',
          title: item.title || item.body || 'Untitled post',
          subtitle: platformLabel,
          statusLabel,
          statusBadgeClass: item.status === 'published' ? 'badge-success' : 'badge-info',
          start,
          end,
          durationMinutes: end - start,
          colorToken,
          content: item,
        });
      } else {
        listItems.push(item);
      }
    }

    return {
      dayListTasks: listTasks,
      dayListItems: listItems,
      calendarAllDayTasks: allDayCalendarTasks,
      events: layoutTimelineEvents(rawEvents),
    };
  }, [contentItems, taskItems, dayRange.dateKey, userTimeZone, resolvedColorMap]);

  // Compute busy hours map (0..23) for the compact 24h strip
  const busyHoursMap = useMemo(() => {
    const counts = new Array<number>(24).fill(0);
    for (const ev of events) {
      const startHour = Math.max(0, Math.floor(ev.start / 60));
      const endHour = Math.min(23, Math.floor(Math.max(ev.start, ev.end - 1) / 60));
      for (let h = startHour; h <= endHour; h++) {
        counts[h]++;
      }
    }
    return counts;
  }, [events]);

  // Compute day summary metrics
  const totalBookedMinutes = useMemo(
    () => events.reduce((acc, ev) => acc + ev.durationMinutes, 0),
    [events]
  );
  const earlyEvents = useMemo(() => events.filter((e) => e.start < 7 * 60), [events]);
  const lateEvents = useMemo(() => events.filter((e) => e.start >= 20 * 60), [events]);
  const overlappingEventsCount = useMemo(
    () => events.filter((e) => e.overlapCount > 0).length,
    [events]
  );
  const maxLanes = useMemo(
    () => Math.max(1, ...events.map((e) => e.lanes)),
    [events]
  );

  // Compute notable gaps between scheduled events (at least 60 minutes)
  const scheduleGaps = useMemo(() => {
    if (events.length < 2) return [];
    const gaps: Array<{ afterEventId: string; start: number; end: number; duration: number }> = [];
    let latestEnd = events[0].end;

    for (let i = 1; i < events.length; i++) {
      const current = events[i];
      if (current.start - latestEnd >= 60) {
        gaps.push({
          afterEventId: events[i - 1].id,
          start: latestEnd,
          end: current.start,
          duration: current.start - latestEnd,
        });
      }
      latestEnd = Math.max(latestEnd, current.end);
    }
    return gaps;
  }, [events]);

  const dayListTotal = dayListTasks.length + dayListItems.length;
  const completedTasksCount =
    dayListTasks.filter((t) => t.status === 'done').length +
    calendarAllDayTasks.filter((t) => t.status === 'done').length +
    events.filter((e) => e.type === 'task' && e.task?.status === 'done').length;
  const totalTasksCount =
    dayListTasks.length +
    calendarAllDayTasks.length +
    events.filter((e) => e.type === 'task').length;

  const handleTriggerScheduleAtTime = (timeStr: string) => {
    const trimmed = timeStr.trim() || '09:00';
    if (onScheduleAtTime) {
      onScheduleAtTime(trimmed);
      return;
    }
    const [hStr] = trimmed.split(':');
    const parsedHour = Number(hStr);
    onScheduleAtHour?.(Number.isFinite(parsedHour) ? Math.min(23, Math.max(0, parsedHour)) : 9);
  };

  return (
    <div className="space-y-5" data-testid="calendar-day-view">
      {/* 1. Day Header & Quick Time-Block Scheduler */}
      <section className="surface-card p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                Daily Brief &amp; Agenda
              </span>
              {isToday && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--accent)] text-[var(--accent-ink)]">
                  <Sparkles className="w-3 h-3" />
                  Today
                </span>
              )}
              <span className="text-[11px] font-mono text-[var(--text-tertiary)] px-2.5 py-0.5 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                {userTimeZone}
              </span>
            </div>

            <h3 className="heading-section text-xl sm:text-2xl text-[var(--text-primary)] tracking-tight">
              {dayRange.label}
            </h3>

            {/* Concise Day Metrics */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--text-secondary)] pt-0.5">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                <strong className="font-semibold text-[var(--text-primary)]">{events.length}</strong>{' '}
                {events.length === 1 ? 'scheduled block' : 'scheduled blocks'}
                {totalBookedMinutes > 0 && (
                  <span className="text-[var(--text-tertiary)] font-mono">
                    ({formatDuration(totalBookedMinutes)})
                  </span>
                )}
              </span>

              <span className="text-[var(--border-strong)]" aria-hidden="true">·</span>

              <span className="inline-flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                <strong className="font-semibold text-[var(--text-primary)]">{dayListTotal}</strong>{' '}
                workspace-assigned
              </span>

              {totalTasksCount > 0 && (
                <>
                  <span className="text-[var(--border-strong)]" aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[var(--status-success-text)]" />
                    <strong className="font-semibold text-[var(--text-primary)]">
                      {completedTasksCount}/{totalTasksCount}
                    </strong>{' '}
                    tasks done
                  </span>
                </>
              )}

              {overlappingEventsCount > 0 && (
                <>
                  <span className="text-[var(--border-strong)]" aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold badge-warning border">
                    <AlertTriangle className="w-3 h-3" />
                    {overlappingEventsCount} overlapping
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Accessible Time Picker & Primary Schedule Action */}
          {(onScheduleAtHour || onScheduleAtTime) && (
            <div className="flex flex-wrap items-center gap-2 shrink-0 bg-[var(--bg-subtle)]/75 p-2 rounded-2xl border border-[var(--border-subtle)]">
              <label htmlFor="day-quick-time-input" className="sr-only">
                Select time to schedule on {dayRange.label}
              </label>
              <div className="flex items-center gap-1.5 pl-2">
                <Clock className="w-3.5 h-3.5 text-[var(--text-tertiary)] shrink-0" />
                <input
                  id="day-quick-time-input"
                  type="time"
                  value={customTime}
                  onChange={(e) => setCustomTime(e.target.value)}
                  aria-label="Select time to schedule"
                  data-testid="day-schedule-time-input"
                  className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl px-2.5 py-1.5 text-xs font-mono font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-strong)]"
                />
              </div>

              <button
                type="button"
                onClick={() => handleTriggerScheduleAtTime(customTime)}
                data-testid="day-quick-schedule-btn"
                className="btn-accent px-4 py-2 text-xs font-semibold"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Schedule block</span>
              </button>
            </div>
          )}
        </div>

        {/* 2. Compact Full-Day 24-Hour Overview Strip (12:00 AM – 11:59 PM) */}
        <div
          className="rounded-2xl bg-[var(--bg-subtle)]/65 border border-[var(--border-subtle)] p-3.5 sm:p-4 space-y-3"
          data-testid="day-overview-strip"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                24-Hour Day Overview
              </span>
              <span className="text-[var(--text-tertiary)]">
                (12:00 AM – 11:59 PM · click any hour or block)
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {earlyEvents.length > 0 && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--accent)] text-[var(--accent-ink)]"
                  data-testid="day-early-indicator"
                >
                  <Moon className="w-3 h-3" />
                  {earlyEvents.length} early ({formatMinutes(earlyEvents[0].start)})
                </span>
              )}
              {lateEvents.length > 0 && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--accent)] text-[var(--accent-ink)]"
                  data-testid="day-late-indicator"
                >
                  <Moon className="w-3 h-3" />
                  {lateEvents.length} late ({formatMinutes(lateEvents[0].start)})
                </span>
              )}
              {events.length === 0 && (
                <span className="text-[11px] text-[var(--text-tertiary)]">
                  Full day open — no time blocks scheduled yet
                </span>
              )}
            </div>
          </div>

          {/* Proportional 24-Hour Visual Track */}
          <div
            className="relative w-full rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden"
            style={{ height: Math.max(44, maxLanes * 26 + 12) }}
          >
            {/* Subtle Daypart Shading: Early (0-7), Core Workday (7-19), Night (19-24) */}
            <div
              className="absolute inset-y-0 left-0 bg-[var(--bg-subtle)]/65 border-r border-dashed border-[var(--border-subtle)] pointer-events-none"
              style={{ width: `${(7 / 24) * 100}%` }}
              title="Early Morning (12:00 AM – 7:00 AM)"
            />
            <div
              className="absolute inset-y-0 right-0 bg-[var(--bg-subtle)]/65 border-l border-dashed border-[var(--border-subtle)] pointer-events-none"
              style={{ width: `${(5 / 24) * 100}%` }}
              title="Night (7:00 PM – 12:00 AM)"
            />

            {/* Quarter-day guide lines (6 AM, 12 PM, 6 PM) */}
            {[6, 12, 18].map((h) => (
              <div
                key={h}
                className="absolute inset-y-0 border-l border-[var(--border-subtle)]/70 pointer-events-none"
                style={{ left: `${(h / 24) * 100}%` }}
              />
            ))}

            {/* Plotted Event Blocks across 24h (0..1440 mins) */}
            {events.map((event) => {
              const leftPct = (event.start / 1440) * 100;
              const rawWidthPct = ((event.end - event.start) / 1440) * 100;
              const widthPct = Math.min(100 - leftPct, Math.max(2.5, rawWidthPct));
              const isTask = event.type === 'task';

              return (
                <button
                  key={`strip-${event.id}`}
                  type="button"
                  data-testid={`day-jump-${event.id}`}
                  data-cal-color={event.colorToken.name}
                  onClick={() => {
                    if (event.task) onSelectTask(event.task);
                    if (event.content) onSelectContent(event.content);
                  }}
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    top: 6 + event.lane * 24,
                    height: 20,
                  }}
                  title={`${formatMinutes(event.start)} – ${formatMinutes(event.end)}: ${event.title}`}
                  aria-label={`${formatMinutes(event.start)} to ${formatMinutes(event.end)}: ${event.title}`}
                  className={`absolute rounded-md px-1.5 text-[10px] font-semibold truncate flex items-center gap-1 border transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)] shadow-2xs ${event.colorToken.colorClass} cal-strip-pill`}
                >
                  {isTask ? (
                    <CheckSquare className="w-2.5 h-2.5 shrink-0 opacity-90" />
                  ) : (
                    <Share2 className="w-2.5 h-2.5 shrink-0 opacity-90" />
                  )}
                  <span className="font-mono text-[9px] shrink-0">
                    {formatMinutes(event.start).replace(':00 ', '').replace(' AM', 'a').replace(' PM', 'p')}
                  </span>
                  <span className="truncate opacity-95">
                    {event.title || (isTask ? 'Task' : event.subtitle)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 24 Compact Interactive Hour Cells (Keyboard & Mouse Accessible) */}
          <div
            className="grid grid-cols-6 sm:grid-cols-12 lg:grid-cols-24 gap-1"
            role="group"
            aria-label="Schedule by hour of day"
          >
            {HOURS.map((hour) => {
              const count = busyHoursMap[hour];
              const isCoreHour = hour >= 8 && hour <= 18;
              return (
                <button
                  key={hour}
                  type="button"
                  data-testid={`day-hour-${hour}`}
                  onClick={() => onScheduleAtHour?.(hour)}
                  aria-label={`Schedule item at ${formatHourLabel(hour)}${count > 0 ? ` (${count} scheduled)` : ''}`}
                  title={`Schedule at ${formatHourLabel(hour)}`}
                  className={`h-7 rounded-lg text-[10px] font-mono transition-colors flex flex-col items-center justify-center border focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)] ${
                    count > 0
                      ? 'bg-[var(--accent-subtle)] border-[var(--accent)] text-[var(--text-primary)] font-bold'
                      : isCoreHour
                        ? 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
                        : 'bg-[var(--bg-subtle)]/50 border-transparent text-[var(--text-tertiary)] hover:bg-[var(--bg-surface)] hover:border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span>{formatHourShort(hour)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* 3. Main Two-Column Daily Planning Layout: Workspace-Assigned (Left) + Scheduled Agenda (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column (lg:col-span-5): Workspace-Assigned Items (from Tasks & Content tabs) */}
        <aside
          aria-label="Tasks and content assigned to this day"
          className="lg:col-span-5 surface-card overflow-hidden flex flex-col"
        >
          <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2 bg-[var(--bg-subtle)]/50">
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                  Assigned to this day
                </h4>
              </div>
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Items added from the Tasks or Content tabs for {dayRange.dayInfo.weekdayName}
              </p>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold font-mono bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)] shrink-0">
              {dayListTotal}
            </span>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            {dayListTotal === 0 ? (
              <div className="py-8 px-4 text-center rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--bg-subtle)]/35 space-y-1.5">
                <p className="text-xs font-semibold text-[var(--text-secondary)]">
                  No workspace-assigned items for {dayRange.dayInfo.weekdayName}
                </p>
                <p className="text-[11px] text-[var(--text-tertiary)] max-w-xs mx-auto leading-relaxed">
                  Tasks and posts given a target or due date in the Tasks or Content tabs appear here, separate from calendar time blocks.
                </p>
              </div>
            ) : (
              <>
                {/* Tasks Assigned Section */}
                {dayListTasks.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)] flex items-center gap-1.5">
                        <CheckSquare className="w-3.5 h-3.5" />
                        Tasks ({dayListTasks.length})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {dayListTasks.map((task) => {
                        const priorityInfo =
                          PRIORITY_BADGE_MAP[task.priority] || PRIORITY_BADGE_MAP.medium;
                        const colorToken = resolveCalendarItemColor('task', task, resolvedColorMap);
                        const scheduledMatchesDay =
                          Boolean(task.scheduled_start) &&
                          getCalendarDateKey(task.scheduled_start!, userTimeZone) === dayRange.dateKey;
                        const timeLabel = task.is_all_day
                          ? 'All day'
                          : scheduledMatchesDay && task.scheduled_start
                            ? (() => {
                                const { hour, minute } = getItemHourInTimeZone(
                                  task.scheduled_start,
                                  userTimeZone
                                );
                                return formatMinutes(hour * 60 + minute);
                              })()
                            : task.due_date
                              ? (() => {
                                  const { hour, minute } = getItemHourInTimeZone(
                                    task.due_date,
                                    userTimeZone
                                  );
                                  return `Due ${formatMinutes(hour * 60 + minute)}`;
                                })()
                              : 'Assigned';

                        return (
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => onSelectTask(task)}
                            data-testid={`day-task-list-${task.id}`}
                            data-cal-color={colorToken.name}
                            className={`w-full text-left p-3.5 rounded-2xl border border-l-4 transition-all space-y-2 group focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)] ${colorToken.colorClass} cal-card-surface`}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0 cal-swatch-dot"
                                  aria-hidden="true"
                                />
                                <CheckCircle2
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    task.status === 'done'
                                      ? 'text-[var(--status-success-text)]'
                                      : 'text-[var(--text-tertiary)]'
                                  }`}
                                />
                                <span>{task.is_all_day ? 'All-Day Task' : 'Assigned Task'}</span>
                                <span className="text-[var(--text-tertiary)]">·</span>
                                <span className="font-mono text-[var(--text-secondary)]">{timeLabel}</span>
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${priorityInfo.badgeClass}`}
                              >
                                {priorityInfo.label}
                              </span>
                            </div>

                            <p
                              className={`text-sm font-semibold leading-snug break-words ${
                                task.status === 'done'
                                  ? 'line-through text-[var(--text-tertiary)]'
                                  : 'text-[var(--text-primary)] group-hover:underline'
                              }`}
                            >
                              {task.title}
                            </p>

                            {task.project && (
                              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: task.project.color || '#E2F925' }}
                                />
                                <span className="truncate">{task.project.name}</span>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Content Assigned Section */}
                {dayListItems.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)] flex items-center gap-1.5">
                        <Share2 className="w-3.5 h-3.5" />
                        Content ({dayListItems.length})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {dayListItems.map((item) => {
                        const platformPill = PLATFORM_PILL_MAP[item.platform] || {
                          label: item.platform,
                          pillClass: 'badge-neutral',
                        };
                        const colorToken = resolveCalendarItemColor('content', item, resolvedColorMap);
                        const statusLabel = STATUS_CONFIG[item.status]?.label || item.status;
                        const actionLabel = ACTION_CONFIG[item.action_type]?.label || item.action_type;
                        const timeLabel = item.scheduled_at
                          ? (() => {
                              const { hour, minute } = getItemHourInTimeZone(
                                item.scheduled_at,
                                userTimeZone
                              );
                              return formatMinutes(hour * 60 + minute);
                            })()
                          : 'Scheduled';

                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => onSelectContent(item)}
                            data-testid={`day-content-list-${item.id}`}
                            data-cal-color={colorToken.name}
                            className={`w-full text-left p-3.5 rounded-2xl border border-l-4 transition-all space-y-2 group focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)] ${colorToken.colorClass} cal-card-surface`}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0 cal-swatch-dot"
                                  aria-hidden="true"
                                />
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${platformPill.pillClass}`}
                                >
                                  {platformPill.label}
                                </span>
                                <span className="text-[10px] font-medium text-[var(--text-secondary)]">
                                  {actionLabel}
                                </span>
                              </div>
                              <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                                {timeLabel}
                              </span>
                            </div>

                            <p className="text-sm font-semibold text-[var(--text-primary)] leading-snug break-words group-hover:underline">
                              {item.title || item.body || 'Untitled post'}
                            </p>

                            <div className="flex items-center justify-between text-[11px] text-[var(--text-tertiary)]">
                              <span>{statusLabel}</span>
                              {item.social_account && (
                                <span className="font-mono truncate max-w-[140px]">
                                  {item.social_account.account_handle}
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </aside>

        {/* Right/Primary Column (lg:col-span-7): Chronological Scheduled Agenda (Calendar items) */}
        <section
          aria-label="Day timeline"
          className="lg:col-span-7 surface-card overflow-hidden flex flex-col"
          data-testid="day-chronological-agenda"
        >
          <div className="px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]/50 flex items-center justify-between gap-3">
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                  Scheduled Agenda
                </h4>
              </div>
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Chronological time blocks scheduled on the calendar for {dayRange.dayInfo.weekdayName}
              </p>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold font-mono bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)] shrink-0">
              {events.length + calendarAllDayTasks.length}
            </span>
          </div>

          <div className="p-4 sm:p-5 space-y-3">
            {calendarAllDayTasks.length > 0 && (
              <div className="space-y-2 pb-2 border-b border-[var(--border-subtle)]">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  All-Day Calendar Items
                </span>
                <div className="flex flex-wrap gap-2">
                  {calendarAllDayTasks.map((task) => {
                    const colorToken = resolveCalendarItemColor('task', task, resolvedColorMap);
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => onSelectTask(task)}
                        data-testid={`day-calendar-allday-${task.id}`}
                        data-cal-color={colorToken.name}
                        className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-l-4 text-xs font-semibold transition-all ${colorToken.colorClass} cal-card-surface`}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0 cal-swatch-dot"
                          aria-hidden="true"
                        />
                        <CheckSquare className="w-3.5 h-3.5 shrink-0" />
                        <span>{task.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {events.length === 0 ? (
              <div className="py-8 px-4 text-center rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--bg-subtle)]/35 space-y-3">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    No time blocks scheduled on the agenda
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
                    Pick a common focus slot below or use the time selector above to block time for a task or social post.
                  </p>
                </div>

                {onScheduleAtHour && (
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    {[
                      { hour: 9, label: '9:00 AM Morning' },
                      { hour: 12, label: '12:00 PM Midday' },
                      { hour: 15, label: '3:00 PM Afternoon' },
                      { hour: 18, label: '6:00 PM Evening' },
                    ].map((slot) => (
                      <button
                        key={slot.hour}
                        type="button"
                        onClick={() => onScheduleAtHour(slot.hour)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[var(--bg-surface)] hover:bg-[var(--accent)] text-[var(--text-primary)] hover:text-[var(--accent-ink)] border border-[var(--border-default)] hover:border-transparent transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        <span>{slot.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              events.map((event) => {
                const isTask = event.type === 'task';
                const isDone = isTask && event.task?.status === 'done';
                const periodTag = getPeriodTag(event.start);
                const gapAfter = scheduleGaps.find((g) => g.afterEventId === event.id);

                return (
                  <div key={event.id} className="space-y-3">
                    <button
                      type="button"
                      data-testid={`day-${event.id}`}
                      data-cal-color={event.colorToken.name}
                      onClick={() => {
                        if (event.task) onSelectTask(event.task);
                        if (event.content) onSelectContent(event.content);
                      }}
                      className={`w-full text-left p-4 rounded-2xl border border-l-4 transition-all group focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)] ${event.colorToken.colorClass} cal-card-surface`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                        {/* Left: Time Window & Duration */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] text-xs font-mono font-semibold text-[var(--text-primary)] border border-[var(--border-subtle)] shadow-2xs">
                            <span
                              className="w-2 h-2 rounded-full shrink-0 cal-swatch-dot"
                              aria-hidden="true"
                            />
                            <Clock className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
                            <span>{formatMinutes(event.start)}</span>
                            <span className="text-[var(--text-tertiary)]">–</span>
                            <span>{formatMinutes(event.end)}</span>
                          </span>

                          <span className="text-[11px] font-mono font-medium text-[var(--text-secondary)]">
                            {formatDuration(event.durationMinutes)}
                          </span>

                          {periodTag.isOffHours && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--accent-subtle)] text-[var(--text-primary)] border border-[var(--accent)]">
                              <Moon className="w-2.5 h-2.5" />
                              {periodTag.label}
                            </span>
                          )}

                          {event.overlapCount > 0 && (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold badge-warning border"
                              data-testid={`day-overlap-${event.id}`}
                            >
                              <AlertTriangle className="w-2.5 h-2.5" />
                              Overlaps ({event.lanes} concurrent)
                            </span>
                          )}
                        </div>

                        {/* Right: Type, Subtitle & Status Badges */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border cal-badge-tint">
                            {isTask ? (
                              <CheckSquare className="w-3 h-3 shrink-0" />
                            ) : (
                              <Share2 className="w-3 h-3 shrink-0" />
                            )}
                            <span>{isTask ? 'Task' : event.subtitle}</span>
                          </span>

                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${event.statusBadgeClass}`}
                          >
                            {event.statusLabel}
                          </span>
                        </div>
                      </div>

                      {/* Title & Details */}
                      <div className="mt-2.5 flex items-end justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <p
                            className={`text-sm sm:text-base font-semibold leading-snug break-words ${
                              isDone
                                ? 'line-through text-[var(--text-tertiary)]'
                                : 'text-[var(--text-primary)] group-hover:underline'
                            }`}
                          >
                            {event.title}
                          </p>
                          <p className="text-xs text-[var(--text-secondary)]">
                            {isTask
                              ? `${event.subtitle}${event.task?.project ? ` · ${event.task.project.name}` : ''}`
                              : `${ACTION_CONFIG[event.content!.action_type]?.label || 'Post'}${
                                  event.content?.social_account
                                    ? ` · ${event.content.social_account.account_handle}`
                                    : ''
                                }`}
                          </p>
                        </div>

                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] shrink-0">
                          <span>Details</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </button>

                    {/* Gap Indicator between agenda blocks */}
                    {gapAfter && (
                      <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-[var(--bg-subtle)]/50 border border-dashed border-[var(--border-subtle)] text-[11px] text-[var(--text-tertiary)]">
                        <span className="inline-flex items-center gap-1.5 font-mono">
                          <Sun className="w-3 h-3 text-[var(--text-tertiary)]" />
                          <span>
                            {formatDuration(gapAfter.duration)} open window ({formatMinutes(gapAfter.start)} –{' '}
                            {formatMinutes(gapAfter.end)})
                          </span>
                        </span>
                        {(onScheduleAtHour || onScheduleAtTime) && (
                          <button
                            type="button"
                            onClick={() => {
                              const gapHour = Math.floor(gapAfter.start / 60);
                              const gapMin = gapAfter.start % 60;
                              handleTriggerScheduleAtTime(
                                `${String(gapHour).padStart(2, '0')}:${String(gapMin).padStart(2, '0')}`
                              );
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold text-[var(--text-primary)] bg-[var(--bg-surface)] hover:bg-[var(--accent)] hover:text-[var(--accent-ink)] border border-[var(--border-subtle)] transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Schedule in gap</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
