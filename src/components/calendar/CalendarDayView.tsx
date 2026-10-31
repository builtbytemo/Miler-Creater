'use client';

import { useState } from 'react';
import {
  Clock,
  Plus,
  CheckSquare,
  Share2,
  AlertCircle,
  Tag,
  Folder,
} from 'lucide-react';
import type { ContentItemWithMeta } from '@/lib/services/content-service';
import type { TaskWithMeta } from '@/lib/services/task-service';
import type { DayRange } from '@/lib/temporal/calendar';
import {
  getCalendarDateKey,
  getItemHourInTimeZone,
  getLocalParts,
} from '@/lib/temporal/calendar';
import { formatInTimeZone, DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';
import { PLATFORM_CONFIG } from '@/components/content/ContentCard';
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

const HOURS_OF_DAY = Array.from({ length: 24 }, (_, i) => i);

function formatHourLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

const TASK_PRIORITY_STYLES: Record<string, string> = {
  urgent: 'bg-red-500/20 text-red-300 border-red-500/40',
  high: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  medium: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  low: 'bg-neutral-800 text-neutral-400 border-neutral-700',
};

const TASK_STATUS_STYLES: Record<string, string> = {
  todo: 'text-neutral-400 bg-neutral-800/80 border-neutral-700',
  in_progress: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
  blocked: 'text-red-300 bg-red-500/10 border-red-500/30',
  done: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30 line-through opacity-70',
  cancelled: 'text-neutral-500 bg-neutral-900 border-neutral-800 line-through opacity-50',
};

export function CalendarDayView({
  dayRange,
  contentItems,
  taskItems,
  userTimeZone = DEFAULT_TIMEZONE,
  onSelectContent,
  onSelectTask,
  onNewAtHour,
  isLoading = false,
}: CalendarDayViewProps) {
  const todayKey = getCalendarDateKey(new Date(), userTimeZone);
  const isToday = dayRange.dateKey === todayKey;

  // Calculate current wall-clock hour & minute for "Now" line
  const nowParts = isToday ? getLocalParts(new Date(), userTimeZone) : null;

  // Filter content items that fall on this day
  const dayContent = contentItems.filter((item) => {
    if (!item.scheduled_at) return false;
    const key = getCalendarDateKey(item.scheduled_at, userTimeZone);
    return key === dayRange.dateKey;
  });

  // Filter tasks that fall on this day (either scheduled_start on this day, or all-day)
  const dayTasks = taskItems.filter((task) => {
    if (!task.scheduled_start) return false;
    const key = getCalendarDateKey(task.scheduled_start, userTimeZone);
    return key === dayRange.dateKey;
  });

  // Bucket items by local hour (0 - 23)
  const contentByHour: Record<number, ContentItemWithMeta[]> = {};
  const tasksByHour: Record<number, TaskWithMeta[]> = {};
  const allDayTasks: TaskWithMeta[] = [];

  for (let h = 0; h < 24; h++) {
    contentByHour[h] = [];
    tasksByHour[h] = [];
  }

  for (const item of dayContent) {
    if (!item.scheduled_at) continue;
    const { hour } = getItemHourInTimeZone(item.scheduled_at, userTimeZone);
    if (contentByHour[hour]) {
      contentByHour[hour].push(item);
    }
  }

  for (const task of dayTasks) {
    if (task.is_all_day) {
      allDayTasks.push(task);
      continue;
    }
    if (!task.scheduled_start) continue;
    const { hour } = getItemHourInTimeZone(task.scheduled_start, userTimeZone);
    if (tasksByHour[hour]) {
      tasksByHour[hour].push(task);
    }
  }

  // Sort chronologically within each hour
  for (let h = 0; h < 24; h++) {
    contentByHour[h].sort((a, b) => {
      const tA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
      const tB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
      return tA - tB;
    });

    tasksByHour[h].sort((a, b) => {
      const tA = a.scheduled_start ? new Date(a.scheduled_start).getTime() : 0;
      const tB = b.scheduled_start ? new Date(b.scheduled_start).getTime() : 0;
      return tA - tB;
    });
  }

  const totalItemsCount = dayContent.length + dayTasks.length;

  return (
    <div className="space-y-4">
      {/* Day Overview Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-neutral-950 border border-neutral-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
              {dayRange.label}
            </h2>
            {isToday && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30 font-mono">
                TODAY
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            Hourly timeline in <span className="font-mono text-neutral-300">{userTimeZone}</span>
          </p>
        </div>

        {/* Item Count Badges */}
        <div className="flex items-center gap-2">
          <div className="px-2.5 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-xs flex items-center gap-1.5 text-neutral-300">
            <Share2 className="w-3.5 h-3.5 text-blue-400" />
            <span>Content:</span>
            <span className="font-mono font-bold text-white">{dayContent.length}</span>
          </div>

          <div className="px-2.5 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-xs flex items-center gap-1.5 text-neutral-300">
            <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
            <span>Tasks:</span>
            <span className="font-mono font-bold text-white">{dayTasks.length}</span>
          </div>

          {onNewAtHour && (
            <button
              type="button"
              onClick={() => onNewAtHour(dayRange.dateKey, 9)}
              className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1 transition-colors shadow-xs"
              title="Schedule an item on this day"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Schedule</span>
            </button>
          )}
        </div>
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="flex items-center justify-center p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400">
          <Clock className="w-4 h-4 mr-2 animate-spin" />
          <span>Loading schedule for {dayRange.label}...</span>
        </div>
      )}

      {/* All-Day Tasks Row (if any exist) */}
      {allDayTasks.length > 0 && (
        <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
          <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-neutral-400">
            All-Day Tasks ({allDayTasks.length})
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {allDayTasks.map((task) => (
              <div
                key={task.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectTask(task)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectTask(task);
                  }
                }}
                className={clsx(
                  'p-2.5 rounded-lg border text-left cursor-pointer transition-all',
                  'bg-neutral-900/90 border-neutral-800 hover:border-neutral-700 hover:shadow-xs'
                )}
              >
                <div className="flex items-center justify-between gap-1 text-[10px] font-mono mb-1">
                  <span className="px-1.5 py-0.2 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                    ALL DAY
                  </span>
                  <span
                    className={clsx(
                      'px-1.5 py-0.2 rounded border capitalize',
                      TASK_PRIORITY_STYLES[task.priority] || 'bg-neutral-800 text-neutral-400'
                    )}
                  >
                    {task.priority}
                  </span>
                </div>
                <div className="text-xs font-semibold text-neutral-200 truncate">{task.title}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 24-Hour Timeline */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 overflow-hidden shadow-xs">
        <div className="divide-y divide-neutral-850">
          {HOURS_OF_DAY.map((hour) => {
            const hourLabel = formatHourLabel(hour);
            const hourContent = contentByHour[hour] || [];
            const hourTasks = tasksByHour[hour] || [];
            const hasItems = hourContent.length > 0 || hourTasks.length > 0;

            const isCurrentHour = isToday && nowParts && nowParts.hour === hour;
            const currentMinutePct = nowParts ? (nowParts.minute / 60) * 100 : 0;

            return (
              <div
                key={hour}
                data-testid={`day-hour-${hour}`}
                className={clsx(
                  'group relative flex min-h-[64px] transition-colors',
                  isCurrentHour ? 'bg-blue-950/15' : 'hover:bg-neutral-900/40'
                )}
              >
                {/* Current Time Indicator ("Now" Line) */}
                {isCurrentHour && (
                  <div
                    style={{ top: `${currentMinutePct}%` }}
                    className="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
                  >
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-red-600 text-white shadow-xs ml-14 shrink-0">
                      NOW
                    </span>
                    <div className="h-0.5 flex-1 bg-red-500/90 shadow-sm shadow-red-500/50" />
                  </div>
                )}

                {/* Left: Hour Label */}
                <div className="w-16 sm:w-20 shrink-0 p-2 sm:p-2.5 text-right font-mono text-xs text-neutral-400 border-r border-neutral-800/80 select-none">
                  <span>{hourLabel}</span>
                </div>

                {/* Right: Hourly Content Slot */}
                <div className="flex-1 p-2 flex flex-col justify-center gap-1.5">
                  {hasItems ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {/* Content Items */}
                      {hourContent.map((item) => {
                        const platformInfo = PLATFORM_CONFIG[item.platform];
                        const displayTime = item.scheduled_at
                          ? formatInTimeZone(item.scheduled_at, userTimeZone, {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true,
                            })
                          : '';

                        return (
                          <div
                            key={item.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => onSelectContent(item)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSelectContent(item);
                              }
                            }}
                            data-testid={`day-content-${item.id}`}
                            className={clsx(
                              'p-2 rounded-lg border text-left cursor-pointer transition-all',
                              'hover:border-neutral-500 hover:shadow-xs focus:outline-none focus:ring-1 focus:ring-blue-500',
                              platformInfo?.badgeClass ||
                                'bg-neutral-900 text-neutral-300 border-neutral-800'
                            )}
                          >
                            <div className="flex items-center justify-between gap-1 mb-1 text-[10px] font-mono">
                              <span className="font-semibold uppercase tracking-wider flex items-center gap-1">
                                <Share2 className="w-3 h-3" />
                                {item.platform}
                              </span>
                              <span className="opacity-90">{displayTime}</span>
                            </div>

                            <div className="text-xs font-semibold truncate text-white">
                              {item.title || item.body || 'Untitled Content'}
                            </div>

                            <div className="flex items-center gap-2 mt-1 text-[10px] text-neutral-400 font-mono">
                              <span className="capitalize">{item.action_type}</span>
                              {item.project && (
                                <span className="flex items-center gap-1 text-neutral-300">
                                  <Folder className="w-2.5 h-2.5" />
                                  {item.project.name}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Task Items */}
                      {hourTasks.map((task) => {
                        const displayTime = task.scheduled_start
                          ? formatInTimeZone(task.scheduled_start, userTimeZone, {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true,
                            })
                          : '';

                        return (
                          <div
                            key={task.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => onSelectTask(task)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSelectTask(task);
                              }
                            }}
                            data-testid={`day-task-${task.id}`}
                            className={clsx(
                              'p-2 rounded-lg border text-left cursor-pointer transition-all',
                              'bg-neutral-900/90 border-neutral-800 hover:border-emerald-500/60 hover:shadow-xs focus:outline-none focus:ring-1 focus:ring-emerald-500'
                            )}
                          >
                            <div className="flex items-center justify-between gap-1 mb-1 text-[10px] font-mono">
                              <span className="font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                                <CheckSquare className="w-3 h-3" />
                                TASK
                              </span>
                              <div className="flex items-center gap-1">
                                <span
                                  className={clsx(
                                    'px-1 py-0.2 rounded border capitalize',
                                    TASK_PRIORITY_STYLES[task.priority] ||
                                      'bg-neutral-800 text-neutral-400'
                                  )}
                                >
                                  {task.priority}
                                </span>
                                <span className="text-neutral-400">{displayTime}</span>
                              </div>
                            </div>

                            <div className="text-xs font-semibold truncate text-white">
                              {task.title}
                            </div>

                            <div className="flex items-center gap-2 mt-1 text-[10px] font-mono">
                              <span
                                className={clsx(
                                  'px-1 py-0.2 rounded border uppercase text-[9px]',
                                  TASK_STATUS_STYLES[task.status] || 'text-neutral-400'
                                )}
                              >
                                {task.status.replace('_', ' ')}
                              </span>

                              {task.project && (
                                <span className="flex items-center gap-1 text-neutral-300">
                                  <Folder className="w-2.5 h-2.5" />
                                  {task.project.name}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Empty Hour Slot Placeholder */
                    <div className="h-full flex items-center">
                      {onNewAtHour && (
                        <button
                          type="button"
                          onClick={() => onNewAtHour(dayRange.dateKey, hour)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-neutral-500 hover:text-white flex items-center gap-1 px-2 py-1 rounded hover:bg-neutral-800/80"
                          title={`Schedule item at ${hourLabel}`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Schedule at {hourLabel}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
