'use client';

import { useMemo } from 'react';
import { CheckSquare, Plus, Share2 } from 'lucide-react';
import type { ContentItemWithMeta } from '@/lib/services/content-service';
import type { TaskWithMeta } from '@/lib/services/task-service';
import { getCalendarDateKey, type MonthGrid } from '@/lib/temporal/calendar';
import { formatInTimeZone } from '@/lib/temporal/timezone';
import {
  buildCalendarItemColorMap,
  resolveCalendarItemColor,
  type CalendarItemColorMap,
} from '@/lib/calendar/item-colors';

interface CalendarMonthViewProps {
  monthGrid: MonthGrid;
  items: ContentItemWithMeta[];
  tasks?: TaskWithMeta[];
  userTimeZone: string;
  itemColorMap?: CalendarItemColorMap;
  onOpenDetail: (item: ContentItemWithMeta) => void;
  onOpenTaskDetail?: (task: TaskWithMeta) => void;
  onSelectDate: (date: Date) => void;
  onScheduleOnDate?: (dateKey: string) => void;
}

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function CalendarMonthView({
  monthGrid,
  items,
  tasks = [],
  userTimeZone,
  itemColorMap,
  onOpenDetail,
  onOpenTaskDetail,
  onSelectDate,
  onScheduleOnDate,
}: CalendarMonthViewProps) {
  const todayDateKey = useMemo(
    () => getCalendarDateKey(new Date(), userTimeZone),
    [userTimeZone]
  );

  const resolvedColorMap = useMemo(
    () => itemColorMap || buildCalendarItemColorMap(tasks, items, userTimeZone),
    [itemColorMap, tasks, items, userTimeZone]
  );

  // Group scheduled items by their local YYYY-MM-DD dateKey in the user's timezone
  const itemsByDateKey = useMemo(() => {
    const map: Record<string, ContentItemWithMeta[]> = {};
    for (const cell of monthGrid.cells) {
      map[cell.dateKey] = [];
    }

    for (const item of items) {
      if (!item.scheduled_at) continue;
      const key = getCalendarDateKey(item.scheduled_at, userTimeZone);
      if (map[key]) {
        map[key].push(item);
      }
    }

    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
        const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        return timeA - timeB;
      });
    }

    return map;
  }, [monthGrid.cells, items, userTimeZone]);

  // Group scheduled tasks by their local YYYY-MM-DD dateKey in the user's timezone
  const tasksByDateKey = useMemo(() => {
    const map: Record<string, TaskWithMeta[]> = {};
    for (const cell of monthGrid.cells) {
      map[cell.dateKey] = [];
    }

    for (const task of tasks) {
      if (!task.scheduled_start) continue;
      const key = getCalendarDateKey(task.scheduled_start, userTimeZone);
      if (map[key]) {
        map[key].push(task);
      }
    }

    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        if (a.is_all_day && !b.is_all_day) return -1;
        if (!a.is_all_day && b.is_all_day) return 1;
        const timeA = a.scheduled_start ? new Date(a.scheduled_start).getTime() : 0;
        const timeB = b.scheduled_start ? new Date(b.scheduled_start).getTime() : 0;
        return timeA - timeB;
      });
    }

    return map;
  }, [monthGrid.cells, tasks, userTimeZone]);

  return (
    <div
      className="surface-card overflow-hidden"
      data-testid="calendar-month-grid"
    >
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          {/* Weekday Column Headers */}
          <div className="grid grid-cols-7 bg-[var(--bg-subtle)]/70 border-b border-[var(--border-subtle)]">
            {WEEKDAY_HEADERS.map((weekday) => (
              <div
                key={weekday}
                className="py-2.5 px-3 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
              >
                {weekday}
              </div>
            ))}
          </div>

          {/* Month Calendar Cells (5 or 6 rows x 7 columns) */}
          <div className="grid grid-cols-7 gap-px bg-[var(--border-subtle)]">
            {monthGrid.cells.map((cell) => {
              const cellItems = itemsByDateKey[cell.dateKey] || [];
              const cellTasks = tasksByDateKey[cell.dateKey] || [];
              const totalCount = cellItems.length + cellTasks.length;
              const isToday = cell.dateKey === todayDateKey;
              const monthShort = SHORT_MONTHS[cell.month - 1] || '';

              type CombinedEntry =
                | { kind: 'task'; task: TaskWithMeta }
                | { kind: 'content'; item: ContentItemWithMeta };

              const combined: CombinedEntry[] = [
                ...cellTasks.map((task): CombinedEntry => ({ kind: 'task', task })),
                ...cellItems.map((item): CombinedEntry => ({ kind: 'content', item })),
              ];

              const visibleEntries = combined.slice(0, 3);
              const overflowCount = combined.length > 3 ? combined.length - 3 : 0;

              return (
                <div
                  key={cell.dateKey}
                  data-testid={`month-cell-${cell.dateKey}`}
                  onClick={() => {
                    if (onScheduleOnDate) {
                      onScheduleOnDate(cell.dateKey);
                    } else {
                      onSelectDate(cell.startOfDay);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (onScheduleOnDate) {
                        onScheduleOnDate(cell.dateKey);
                      } else {
                        onSelectDate(cell.startOfDay);
                      }
                    }
                  }}
                  className={`group min-h-[118px] sm:min-h-[132px] p-2 sm:p-2.5 flex flex-col justify-between transition-colors cursor-pointer text-left focus:outline-none focus:bg-[var(--bg-hover)] ${
                    cell.isCurrentMonth
                      ? isToday
                        ? 'bg-[var(--accent-subtle)]/35 hover:bg-[var(--accent-subtle)]/55'
                        : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)]/60'
                      : 'bg-[var(--bg-subtle)]/45 hover:bg-[var(--bg-hover)]/50 opacity-65'
                  }`}
                >
                  {/* Top Row: Day Number + Quick Schedule Indicator */}
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectDate(cell.startOfDay);
                      }}
                      data-testid={`month-cell-date-${cell.dateKey}`}
                      title={`View ${monthShort} ${cell.day} in Day view`}
                      className={`inline-flex items-center justify-center min-w-[26px] h-[26px] px-1.5 rounded-full text-xs font-bold transition-transform hover:scale-105 ${
                        isToday
                          ? 'bg-[var(--accent)] text-[var(--accent-ink)] shadow-xs'
                          : cell.isCurrentMonth
                            ? 'text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]'
                            : 'text-[var(--text-tertiary)]'
                      }`}
                    >
                      {cell.day === 1 ? `${monthShort} 1` : cell.day}
                    </button>

                    <div className="flex items-center gap-1">
                      <span className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--bg-subtle)] text-[var(--text-secondary)] border border-[var(--border-subtle)] transition-opacity">
                        <Plus className="w-3 h-3" />
                      </span>
                      {totalCount > 0 && (
                        <span className="text-[10px] font-mono font-semibold text-[var(--text-secondary)] px-1.5 py-0.2 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                          {totalCount}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Compact Pills List */}
                  <div className="flex-1 space-y-1 overflow-hidden">
                    {visibleEntries.map((entry) => {
                      if (entry.kind === 'task') {
                        const { task } = entry;
                        const colorToken = resolveCalendarItemColor('task', task, resolvedColorMap);
                        const timeStr =
                          !task.is_all_day && task.scheduled_start
                            ? formatInTimeZone(task.scheduled_start, userTimeZone, {
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true,
                              })
                            : '';

                        return (
                          <button
                            key={`task-${task.id}`}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenTaskDetail?.(task);
                            }}
                            data-testid={`month-task-${task.id}`}
                            data-cal-color={colorToken.name}
                            className={`w-full text-left px-2 py-1 rounded-lg border border-l-2 flex items-center gap-1.5 transition-colors group/pill ${colorToken.colorClass} cal-card-surface`}
                          >
                            <CheckSquare className="w-2.5 h-2.5 text-[var(--text-secondary)] shrink-0" />
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0 cal-swatch-dot"
                              aria-hidden="true"
                            />
                            {timeStr && (
                              <span className="text-[9px] font-mono text-[var(--text-secondary)] shrink-0">
                                {timeStr.replace(':00 ', '').replace(' AM', 'a').replace(' PM', 'p')}
                              </span>
                            )}
                            <span
                              className={`text-[11px] font-medium truncate ${
                                task.status === 'done'
                                  ? 'line-through text-[var(--text-tertiary)]'
                                  : 'text-[var(--text-primary)]'
                              }`}
                            >
                              {task.title}
                            </span>
                          </button>
                        );
                      }

                      const { item } = entry;
                      const colorToken = resolveCalendarItemColor('content', item, resolvedColorMap);
                      const timeStr = item.scheduled_at
                        ? formatInTimeZone(item.scheduled_at, userTimeZone, {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                          })
                        : '';

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenDetail(item);
                          }}
                          data-testid={`month-content-${item.id}`}
                          data-cal-color={colorToken.name}
                          className={`w-full text-left px-2 py-1 rounded-lg border border-l-2 flex items-center gap-1.5 transition-colors group/pill ${colorToken.colorClass} cal-card-surface`}
                        >
                          <Share2 className="w-2.5 h-2.5 text-[var(--text-secondary)] shrink-0" />
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0 cal-swatch-dot"
                            aria-hidden="true"
                          />
                          {timeStr && (
                            <span className="text-[9px] font-mono text-[var(--text-secondary)] shrink-0">
                              {timeStr.replace(':00 ', '').replace(' AM', 'a').replace(' PM', 'p')}
                            </span>
                          )}
                          <span className="text-[11px] font-medium text-[var(--text-primary)] truncate">
                            {item.title || item.body || 'Untitled'}
                          </span>
                        </button>
                      );
                    })}

                    {overflowCount > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectDate(cell.startOfDay);
                        }}
                        className="w-full text-left text-[10px] font-mono font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-2 py-0.5 rounded hover:bg-[var(--bg-subtle)] transition-colors"
                        data-testid={`month-cell-more-${cell.dateKey}`}
                      >
                        +{overflowCount} more · View all
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
