'use client';

import { useState } from 'react';
import {
  Calendar as CalendarIcon,
  Clock,
  Plus,
  ChevronRight,
  AlertCircle,
  Tag,
  AtSign,
  CheckSquare,
  Share2,
  Folder,
} from 'lucide-react';
import type { ContentItemWithMeta } from '@/lib/services/content-service';
import type { TaskWithMeta } from '@/lib/services/task-service';
import type { WeekRange, CalendarDayInfo } from '@/lib/temporal/calendar';
import { getCalendarDateKey } from '@/lib/temporal/calendar';
import { formatInTimeZone, DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';
import { PLATFORM_CONFIG, STATUS_CONFIG, ACTION_CONFIG } from '@/components/content/ContentCard';
import clsx from 'clsx';

interface CalendarWeekViewProps {
  weekRange: WeekRange;
  items: ContentItemWithMeta[];
  taskItems?: TaskWithMeta[];
  userTimeZone?: string;
  onSelectItem: (item: ContentItemWithMeta) => void;
  onSelectTask?: (task: TaskWithMeta) => void;
  onNewForDay?: (dateKey: string) => void;
  onSelectDay?: (dateKey: string) => void;
  isLoading?: boolean;
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

export function CalendarWeekView({
  weekRange,
  items,
  taskItems = [],
  userTimeZone = DEFAULT_TIMEZONE,
  onSelectItem,
  onSelectTask,
  onNewForDay,
  onSelectDay,
  isLoading = false,
}: CalendarWeekViewProps) {
  // Mobile day selection: defaults to today's dateKey if in the active week, or 'all'
  const todayKey = getCalendarDateKey(new Date(), userTimeZone);
  const [mobileSelectedKey, setMobileSelectedKey] = useState<string>('all');

  // Bucket content items by local dateKey in the user's timezone
  const contentByDateKey: Record<string, ContentItemWithMeta[]> = {};
  const tasksByDateKey: Record<string, TaskWithMeta[]> = {};

  for (const day of weekRange.days) {
    contentByDateKey[day.dateKey] = [];
    tasksByDateKey[day.dateKey] = [];
  }

  for (const item of items) {
    if (!item.scheduled_at) continue;
    const dateKey = getCalendarDateKey(item.scheduled_at, userTimeZone);
    if (contentByDateKey[dateKey]) {
      contentByDateKey[dateKey].push(item);
    }
  }

  for (const task of taskItems) {
    if (!task.scheduled_start) continue;
    const dateKey = getCalendarDateKey(task.scheduled_start, userTimeZone);
    if (tasksByDateKey[dateKey]) {
      tasksByDateKey[dateKey].push(task);
    }
  }

  // Sort each day's items chronologically by UTC timestamp
  for (const dateKey of Object.keys(contentByDateKey)) {
    contentByDateKey[dateKey].sort((a, b) => {
      const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
      const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
      return timeA - timeB;
    });

    tasksByDateKey[dateKey].sort((a, b) => {
      const timeA = a.scheduled_start ? new Date(a.scheduled_start).getTime() : 0;
      const timeB = b.scheduled_start ? new Date(b.scheduled_start).getTime() : 0;
      return timeA - timeB;
    });
  }

  // Determine which days to display on mobile
  const daysToDisplay =
    mobileSelectedKey === 'all'
      ? weekRange.days
      : weekRange.days.filter((d) => d.dateKey === mobileSelectedKey);

  return (
    <div className="space-y-4">
      {/* Mobile Day Selector Tabs */}
      <div className="flex md:hidden items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none text-xs">
        <button
          type="button"
          onClick={() => setMobileSelectedKey('all')}
          className={clsx(
            'px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors shrink-0',
            mobileSelectedKey === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
          )}
        >
          All 7 Days
        </button>

        {weekRange.days.map((day) => {
          const isSelected = mobileSelectedKey === day.dateKey;
          const count =
            (contentByDateKey[day.dateKey]?.length || 0) +
            (tasksByDateKey[day.dateKey]?.length || 0);

          return (
            <button
              key={day.dateKey}
              type="button"
              onClick={() => setMobileSelectedKey(day.dateKey)}
              className={clsx(
                'px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 whitespace-nowrap transition-colors shrink-0 font-mono text-[11px]',
                isSelected
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'bg-neutral-900 border border-neutral-800 text-neutral-300 hover:border-neutral-700'
              )}
            >
              <span>{day.weekdayName}</span>
              <span>{day.day}</span>
              {count > 0 && (
                <span
                  className={clsx(
                    'px-1.5 py-0.2 rounded-full text-[10px]',
                    isSelected ? 'bg-blue-800 text-white' : 'bg-neutral-800 text-neutral-300'
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="flex items-center justify-center p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400">
          <Clock className="w-4 h-4 mr-2 animate-spin" />
          <span>Loading scheduled content for {weekRange.label}...</span>
        </div>
      )}

      {/* Desktop 7-Column Grid / Mobile Filtered Column List */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
        {daysToDisplay.map((day) => {
          const dayContent = contentByDateKey[day.dateKey] || [];
          const dayTasks = tasksByDateKey[day.dateKey] || [];
          const totalDayCount = dayContent.length + dayTasks.length;
          const isToday = day.dateKey === todayKey;

          return (
            <div
              key={day.dateKey}
              data-testid={`calendar-day-${day.dateKey}`}
              className={clsx(
                'flex flex-col rounded-xl border bg-neutral-950/80 transition-colors min-h-[240px]',
                isToday
                  ? 'border-blue-500/50 shadow-sm shadow-blue-500/5'
                  : 'border-neutral-800 hover:border-neutral-700'
              )}
            >
              {/* Day Header */}
              <div
                className={clsx(
                  'px-3 py-2.5 border-b flex items-center justify-between',
                  isToday
                    ? 'border-blue-500/30 bg-blue-500/5 text-blue-300'
                    : 'border-neutral-800 text-neutral-300'
                )}
              >
                <div
                  className="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => onSelectDay?.(day.dateKey)}
                  title={`View ${day.weekdayName}, ${day.day} in Day timeline`}
                >
                  <span className="text-xs font-semibold uppercase tracking-wider">
                    {day.weekdayName}
                  </span>
                  <span
                    className={clsx(
                      'text-xs font-bold font-mono px-1.5 py-0.5 rounded',
                      isToday ? 'bg-blue-600 text-white' : 'text-neutral-400'
                    )}
                  >
                    {day.day}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  {onNewForDay && (
                    <button
                      type="button"
                      onClick={() => onNewForDay(day.dateKey)}
                      className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                      title={`Schedule for ${day.weekdayName} ${day.day}`}
                      data-testid={`week-schedule-${day.dateKey}`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {isToday && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                      Today
                    </span>
                  )}
                  {totalDayCount > 0 && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
                      {totalDayCount}
                    </span>
                  )}
                </div>
              </div>

              {/* Day Items List (Content + Tasks) */}
              <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[520px]">
                {totalDayCount === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center p-4 text-center">
                    <p className="text-[11px] text-neutral-600 dark:text-neutral-500">
                      No planned items
                    </p>
                    {onNewForDay && (
                      <button
                        type="button"
                        onClick={() => onNewForDay(day.dateKey)}
                        className="mt-2 text-[10px] text-neutral-500 hover:text-neutral-300 inline-flex items-center gap-1 px-2 py-1 rounded bg-neutral-900 border border-neutral-800 transition-colors"
                        title={`Plan items for ${day.weekdayName} ${day.day}`}
                      >
                        <Plus className="w-3 h-3" />
                        <span>Schedule</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Content Items */}
                    {dayContent.map((item) => {
                      const platformInfo = PLATFORM_CONFIG[item.platform];
                      const statusInfo = STATUS_CONFIG[item.status];
                      const actionInfo = ACTION_CONFIG[item.action_type];

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
                          onClick={() => onSelectItem(item)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelectItem(item);
                            }
                          }}
                          data-testid={`calendar-item-${item.id}`}
                          className={clsx(
                            'p-2.5 rounded-lg border bg-neutral-900/90 text-left cursor-pointer transition-all',
                            'hover:border-neutral-600 hover:bg-neutral-900 hover:shadow-md',
                            'focus:outline-none focus:ring-1 focus:ring-blue-500',
                            platformInfo?.borderClass || 'border-neutral-800'
                          )}
                        >
                          {/* Time & Platform Header */}
                          <div className="flex items-center justify-between gap-1 mb-1.5">
                            <span className="text-[11px] font-mono font-medium text-blue-400 flex items-center gap-1">
                              <Clock className="w-3 h-3 text-blue-400 shrink-0" />
                              {displayTime}
                            </span>

                            <span
                              className={clsx(
                                'px-1.5 py-0.5 rounded text-[10px] font-medium border truncate max-w-[80px]',
                                platformInfo?.badgeClass || 'bg-neutral-800 text-neutral-300'
                              )}
                            >
                              {platformInfo?.label.split(' ')[0] || item.platform}
                            </span>
                          </div>

                          {/* Title or Body Preview */}
                          <p className="text-xs font-semibold text-neutral-200 line-clamp-2 leading-snug mb-2">
                            {item.title || item.body || 'Untitled Content'}
                          </p>

                          {/* Metadata Badges Footer */}
                          <div className="flex flex-wrap items-center gap-1 text-[10px]">
                            <span className="px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-400 font-mono">
                              {actionInfo?.label || item.action_type}
                            </span>

                            <span
                              className={clsx(
                                'px-1.5 py-0.2 rounded border font-mono',
                                statusInfo?.badgeClass || 'bg-neutral-800 text-neutral-300'
                              )}
                            >
                              {statusInfo?.label || item.status}
                            </span>

                            {item.social_account && (
                              <span className="px-1.5 py-0.2 rounded bg-neutral-800/80 text-neutral-400 flex items-center gap-0.5 truncate max-w-[90px]">
                                <AtSign className="w-2.5 h-2.5" />
                                <span className="truncate">{item.social_account.account_handle}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Task Items */}
                    {dayTasks.map((task) => {
                      const displayTime = task.scheduled_start
                        ? formatInTimeZone(task.scheduled_start, userTimeZone, {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                          })
                        : task.is_all_day
                          ? 'All Day'
                          : '';

                      return (
                        <div
                          key={task.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelectTask?.(task)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelectTask?.(task);
                            }
                          }}
                          data-testid={`calendar-task-${task.id}`}
                          className={clsx(
                            'p-2.5 rounded-lg border bg-neutral-900/90 text-left cursor-pointer transition-all',
                            'hover:border-emerald-500/60 hover:bg-neutral-900 hover:shadow-md',
                            'focus:outline-none focus:ring-1 focus:ring-emerald-500 border-neutral-800'
                          )}
                        >
                          {/* Time & Task Header */}
                          <div className="flex items-center justify-between gap-1 mb-1.5">
                            <span className="text-[11px] font-mono font-medium text-emerald-400 flex items-center gap-1">
                              <CheckSquare className="w-3 h-3 text-emerald-400 shrink-0" />
                              {displayTime}
                            </span>

                            <span
                              className={clsx(
                                'px-1.5 py-0.5 rounded text-[10px] font-medium border capitalize',
                                TASK_PRIORITY_STYLES[task.priority] || 'bg-neutral-800 text-neutral-400'
                              )}
                            >
                              {task.priority}
                            </span>
                          </div>

                          {/* Task Title */}
                          <p className="text-xs font-semibold text-neutral-200 line-clamp-2 leading-snug mb-1.5">
                            {task.title}
                          </p>

                          {/* Task Footer */}
                          <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono">
                            <span
                              className={clsx(
                                'px-1.5 py-0.2 rounded border uppercase text-[9px]',
                                TASK_STATUS_STYLES[task.status] || 'text-neutral-400'
                              )}
                            >
                              {task.status.replace('_', ' ')}
                            </span>

                            {task.project && (
                              <span className="px-1.5 py-0.2 rounded bg-neutral-800/80 text-neutral-300 flex items-center gap-1 truncate max-w-[90px]">
                                <Folder className="w-2.5 h-2.5 text-neutral-400" />
                                <span className="truncate">{task.project.name}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
