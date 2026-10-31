'use client';

import { Calendar as CalendarIcon, Clock, Plus, AlertCircle, CheckSquare, Share2 } from 'lucide-react';
import type { ContentItemWithMeta } from '@/lib/services/content-service';
import type { TaskWithMeta } from '@/lib/services/task-service';
import type { MonthGrid, CalendarGridCell } from '@/lib/temporal/calendar';
import { getCalendarDateKey } from '@/lib/temporal/calendar';
import { formatInTimeZone, DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';
import { PLATFORM_CONFIG } from '@/components/content/ContentCard';
import clsx from 'clsx';

interface CalendarMonthViewProps {
  monthGrid: MonthGrid;
  items: ContentItemWithMeta[];
  taskItems?: TaskWithMeta[];
  userTimeZone?: string;
  onSelectItem: (item: ContentItemWithMeta) => void;
  onSelectTask?: (task: TaskWithMeta) => void;
  onSelectDate: (date: Date) => void;
  onNewForDate?: (dateKey: string) => void;
  isLoading?: boolean;
}

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarMonthView({
  monthGrid,
  items,
  taskItems = [],
  userTimeZone = DEFAULT_TIMEZONE,
  onSelectItem,
  onSelectTask,
  onSelectDate,
  onNewForDate,
  isLoading = false,
}: CalendarMonthViewProps) {
  const todayKey = getCalendarDateKey(new Date(), userTimeZone);

  // Bucket scheduled content items by local dateKey
  const contentByDateKey: Record<string, ContentItemWithMeta[]> = {};
  const tasksByDateKey: Record<string, TaskWithMeta[]> = {};

  for (const cell of monthGrid.cells) {
    contentByDateKey[cell.dateKey] = [];
    tasksByDateKey[cell.dateKey] = [];
  }

  for (const item of items) {
    if (!item.scheduled_at) continue;
    const key = getCalendarDateKey(item.scheduled_at, userTimeZone);
    if (contentByDateKey[key]) {
      contentByDateKey[key].push(item);
    }
  }

  for (const task of taskItems) {
    if (!task.scheduled_start) continue;
    const key = getCalendarDateKey(task.scheduled_start, userTimeZone);
    if (tasksByDateKey[key]) {
      tasksByDateKey[key].push(task);
    }
  }

  // Sort each cell's items chronologically
  for (const key of Object.keys(contentByDateKey)) {
    contentByDateKey[key].sort((a, b) => {
      const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
      const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
      return timeA - timeB;
    });

    tasksByDateKey[key].sort((a, b) => {
      const timeA = a.scheduled_start ? new Date(a.scheduled_start).getTime() : 0;
      const timeB = b.scheduled_start ? new Date(b.scheduled_start).getTime() : 0;
      return timeA - timeB;
    });
  }

  return (
    <div className="space-y-4">
      {/* Loading Overlay */}
      {isLoading && (
        <div className="flex items-center justify-center p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400">
          <Clock className="w-4 h-4 mr-2 animate-spin" />
          <span>Loading scheduled items for {monthGrid.label}...</span>
        </div>
      )}

      {/* Main Month Grid Container */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 overflow-hidden shadow-xs">
        {/* Weekday Column Headers (Mon - Sun) */}
        <div className="grid grid-cols-7 border-b border-neutral-800 bg-neutral-900/60 text-center">
          {WEEKDAY_HEADERS.map((weekday, idx) => (
            <div
              key={weekday}
              className={clsx(
                'py-2.5 text-xs font-mono font-semibold tracking-wider uppercase',
                idx === 5 || idx === 6 ? 'text-neutral-500' : 'text-neutral-400',
                idx > 0 && 'border-l border-neutral-800/80'
              )}
            >
              <span className="hidden sm:inline">{weekday}</span>
              <span className="sm:hidden">{weekday.charAt(0)}</span>
            </div>
          ))}
        </div>

        {/* Month Day Cells */}
        <div className="grid grid-cols-7 divide-y divide-neutral-800/80">
          {monthGrid.cells.map((cell, idx) => {
            const isToday = cell.dateKey === todayKey;
            const isWeekend = cell.weekday === 6 || cell.weekday === 7;
            const dayContent = contentByDateKey[cell.dateKey] || [];
            const dayTasks = tasksByDateKey[cell.dateKey] || [];
            const totalCount = dayContent.length + dayTasks.length;

            // Combine items up to 3 previews, with overflow indicator
            const visibleContent = dayContent.slice(0, 2);
            const visibleTasks = dayTasks.slice(0, 2);
            const overflowCount = Math.max(0, totalCount - (visibleContent.length + visibleTasks.length));

            return (
              <div
                key={cell.dateKey}
                data-testid={`month-cell-${cell.dateKey}`}
                onClick={() => onSelectDate(cell.startOfDay)}
                className={clsx(
                  'group min-h-[100px] sm:min-h-[120px] p-1.5 sm:p-2 flex flex-col transition-colors cursor-pointer select-none',
                  idx % 7 > 0 && 'border-l border-neutral-800/80',
                  cell.isCurrentMonth
                    ? isWeekend
                      ? 'bg-neutral-950/40 hover:bg-neutral-900/60'
                      : 'bg-neutral-950 hover:bg-neutral-900/60'
                    : 'bg-neutral-900/30 opacity-45 hover:opacity-75',
                  isToday && 'ring-1 ring-inset ring-blue-500/60 bg-blue-500/5'
                )}
                title={`Click to view week of ${cell.weekdayName}, ${cell.month}/${cell.day}`}
              >
                {/* Cell Header: Day Number & Today Highlight */}
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={clsx(
                      'text-xs font-mono font-semibold px-1.5 py-0.5 rounded transition-colors',
                      isToday
                        ? 'bg-blue-600 text-white font-bold'
                        : cell.isCurrentMonth
                          ? 'text-neutral-300 group-hover:text-white'
                          : 'text-neutral-600'
                    )}
                  >
                    {cell.day}
                  </span>

                  <div className="flex items-center gap-1">
                    {onNewForDate && cell.isCurrentMonth && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNewForDate(cell.dateKey);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-opacity"
                        title={`Schedule for ${cell.dateKey}`}
                        data-testid={`month-schedule-${cell.dateKey}`}
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    )}
                    {totalCount > 0 && (
                      <span className="hidden sm:inline-block text-[10px] font-mono px-1 rounded bg-neutral-800/80 text-neutral-400">
                        {totalCount}
                      </span>
                    )}
                  </div>
                </div>

                {/* Scheduled Items List for Day (Content + Tasks) */}
                <div className="flex-1 space-y-1 overflow-hidden">
                  {/* Content Item Pills */}
                  {visibleContent.map((item) => {
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
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectItem(item);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            e.preventDefault();
                            onSelectItem(item);
                          }
                        }}
                        data-testid={`month-item-${item.id}`}
                        className={clsx(
                          'p-1 sm:p-1.5 rounded-md border text-left cursor-pointer transition-all truncate text-[10px] sm:text-[11px] leading-tight',
                          'hover:border-neutral-500 hover:shadow-xs focus:outline-none focus:ring-1 focus:ring-blue-500',
                          platformInfo?.badgeClass || 'bg-neutral-800 text-neutral-300 border-neutral-700'
                        )}
                        title={`Content: ${displayTime} - ${item.title || item.body}`}
                      >
                        <div className="flex items-center gap-1 truncate">
                          <span className="font-mono text-[9px] shrink-0 opacity-80">
                            {displayTime}
                          </span>
                          <span className="font-semibold truncate">
                            {item.title || item.body || 'Untitled'}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Task Item Pills */}
                  {visibleTasks.map((task) => {
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
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectTask?.(task);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            e.preventDefault();
                            onSelectTask?.(task);
                          }
                        }}
                        data-testid={`month-task-${task.id}`}
                        className={clsx(
                          'p-1 sm:p-1.5 rounded-md border text-left cursor-pointer transition-all truncate text-[10px] sm:text-[11px] leading-tight',
                          'bg-neutral-900 border-neutral-800 text-neutral-300 hover:border-emerald-500/60 hover:shadow-xs focus:outline-none focus:ring-1 focus:ring-emerald-500'
                        )}
                        title={`Task: ${displayTime} - ${task.title}`}
                      >
                        <div className="flex items-center gap-1 truncate">
                          <CheckSquare className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                          <span className="font-mono text-[9px] shrink-0 text-emerald-400">
                            {displayTime}
                          </span>
                          <span className="font-medium truncate text-neutral-200">
                            {task.title}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Overflow Badge */}
                  {overflowCount > 0 && (
                    <div className="text-[10px] font-mono font-medium text-neutral-400 px-1 hover:text-neutral-200">
                      +{overflowCount} more
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
