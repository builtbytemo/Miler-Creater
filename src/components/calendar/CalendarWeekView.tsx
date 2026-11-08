'use client';

import { useMemo, useState } from 'react';
import {
  AtSign,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  Plus,
  Share2,
} from 'lucide-react';
import type { ContentItemWithMeta } from '@/lib/services/content-service';
import type { TaskWithMeta } from '@/lib/services/task-service';
import { getCalendarDateKey, type CalendarDayInfo } from '@/lib/temporal/calendar';
import { formatInTimeZone } from '@/lib/temporal/timezone';
import { ACTION_CONFIG } from '@/components/content/ContentCard';
import {
  buildCalendarItemColorMap,
  resolveCalendarItemColor,
  type CalendarItemColorMap,
} from '@/lib/calendar/item-colors';
import type { TaskPriority, SocialPlatform } from '@/types/database';

interface CalendarWeekViewProps {
  weekDays: CalendarDayInfo[];
  items: ContentItemWithMeta[];
  tasks?: TaskWithMeta[];
  userTimeZone: string;
  itemColorMap?: CalendarItemColorMap;
  onOpenDetail: (item: ContentItemWithMeta) => void;
  onOpenTaskDetail?: (task: TaskWithMeta) => void;
  onSelectDay?: (date: Date) => void;
  onScheduleOnDate?: (dateKey: string) => void;
}

const VISIBLE_ITEMS_PER_DAY = 4;

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

const PRIORITY_BADGE_MAP: Record<TaskPriority, { label: string; badgeClass: string }> = {
  urgent: { label: 'Urgent', badgeClass: 'badge-danger' },
  high: { label: 'High', badgeClass: 'badge-warning' },
  medium: { label: 'Med', badgeClass: 'badge-info' },
  low: { label: 'Low', badgeClass: 'badge-neutral' },
};

const PLATFORM_SHORT_MAP: Record<SocialPlatform, { label: string; badgeClass: string }> = {
  x: {
    label: 'X',
    badgeClass: 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border-[var(--border-strong)]',
  },
  linkedin: {
    label: 'LinkedIn',
    badgeClass: 'badge-info',
  },
  reddit: {
    label: 'Reddit',
    badgeClass: 'badge-warning',
  },
  threads: {
    label: 'Threads',
    badgeClass: 'badge-neutral',
  },
};

export function CalendarWeekView({
  weekDays,
  items,
  tasks = [],
  userTimeZone,
  itemColorMap,
  onOpenDetail,
  onOpenTaskDetail,
  onSelectDay,
  onScheduleOnDate,
}: CalendarWeekViewProps) {
  const [expandedDayKeys, setExpandedDayKeys] = useState<Record<string, boolean>>({});

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
    for (const day of weekDays) {
      map[day.dateKey] = [];
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
  }, [weekDays, items, userTimeZone]);

  // Group scheduled tasks by their local YYYY-MM-DD dateKey in the user's timezone
  const tasksByDateKey = useMemo(() => {
    const map: Record<string, TaskWithMeta[]> = {};
    for (const day of weekDays) {
      map[day.dateKey] = [];
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
  }, [weekDays, tasks, userTimeZone]);

  const toggleExpandDay = (dateKey: string) => {
    setExpandedDayKeys((prev) => ({
      ...prev,
      [dateKey]: !prev[dateKey],
    }));
  };

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-px rounded-2xl bg-[var(--border-subtle)] border border-[var(--border-subtle)] overflow-hidden shadow-xs"
      data-testid="calendar-week-grid"
    >
      {weekDays.map((day) => {
        const dayItems = itemsByDateKey[day.dateKey] || [];
        const dayTasks = tasksByDateKey[day.dateKey] || [];
        const totalCount = dayItems.length + dayTasks.length;
        const isToday = day.dateKey === todayDateKey;
        const monthShort = SHORT_MONTHS[day.month - 1] || '';
        const isExpanded = Boolean(expandedDayKeys[day.dateKey]);

        type CombinedEntry =
          | { kind: 'task'; task: TaskWithMeta }
          | { kind: 'content'; item: ContentItemWithMeta };

        const combinedEntries: CombinedEntry[] = [
          ...dayTasks.map((task): CombinedEntry => ({ kind: 'task', task })),
          ...dayItems.map((item): CombinedEntry => ({ kind: 'content', item })),
        ];

        const visibleEntries = isExpanded
          ? combinedEntries
          : combinedEntries.slice(0, VISIBLE_ITEMS_PER_DAY);
        const hiddenCount =
          combinedEntries.length > VISIBLE_ITEMS_PER_DAY
            ? combinedEntries.length - VISIBLE_ITEMS_PER_DAY
            : 0;

        return (
          <div
            key={day.dateKey}
            data-testid={`week-day-column-${day.dateKey}`}
            className={`flex flex-col min-h-[260px] xl:min-h-[420px] min-w-0 transition-colors ${
              isToday ? 'bg-[var(--bg-surface)]' : 'bg-[var(--bg-surface)]/95'
            }`}
          >
            {/* Uncluttered Day Column Header — No redundant date repetition */}
            <div
              className={`px-3 py-2.5 border-b flex items-center justify-between gap-2 ${
                isToday
                  ? 'bg-[var(--accent-subtle)]/70 border-[var(--border-default)]'
                  : 'bg-[var(--bg-subtle)]/55 border-[var(--border-subtle)]'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectDay?.(day.startOfDay)}
                data-testid={`week-day-header-${day.dateKey}`}
                className="inline-flex items-center gap-1.5 text-left group focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)] rounded-full pr-1 min-w-0"
                title={`Open Day view for ${day.weekdayName}, ${monthShort} ${day.day}`}
              >
                <span
                  className={`text-[11px] font-bold uppercase tracking-wider ${
                    isToday ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  {day.weekdayName}
                </span>
                <span
                  className={`inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full text-xs font-bold transition-transform group-hover:scale-105 shrink-0 ${
                    isToday
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)] shadow-2xs'
                      : 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)] group-hover:border-[var(--border-strong)]'
                  }`}
                >
                  {day.day === 1 ? `${monthShort} 1` : day.day}
                </span>
              </button>

              <div className="flex items-center gap-1 shrink-0">
                {totalCount > 0 && (
                  <span
                    className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                    title={`${totalCount} scheduled ${totalCount === 1 ? 'item' : 'items'}`}
                  >
                    {totalCount}
                  </span>
                )}
                {onScheduleOnDate && (
                  <button
                    type="button"
                    onClick={() => onScheduleOnDate(day.dateKey)}
                    className="w-6 h-6 inline-flex items-center justify-center rounded-full text-[var(--text-secondary)] hover:text-[var(--accent-ink)] hover:bg-[var(--accent)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)]"
                    title={`Schedule on ${day.weekdayName}, ${monthShort} ${day.day}`}
                    aria-label={`Schedule on ${day.weekdayName}, ${monthShort} ${day.day}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Day Items & Tasks Stack */}
            <div className="flex-1 p-2.5 space-y-2">
              {totalCount === 0 ? (
                <div className="h-full min-h-[150px] flex flex-col items-center justify-center text-center p-3 rounded-xl border border-dashed border-[var(--border-subtle)]/80 bg-[var(--bg-subtle)]/20">
                  <p className="text-[11px] text-[var(--text-tertiary)] mb-2">Open day</p>
                  {onScheduleOnDate && (
                    <button
                      type="button"
                      onClick={() => onScheduleOnDate(day.dateKey)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent-ink)] bg-[var(--bg-surface)] hover:bg-[var(--accent)] border border-[var(--border-subtle)] hover:border-transparent transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Schedule</span>
                    </button>
                  )}
                </div>
              ) : (
                <>
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
                          : 'All day';

                      const priorityInfo =
                        PRIORITY_BADGE_MAP[task.priority] || PRIORITY_BADGE_MAP.medium;

                      return (
                        <button
                          key={`task-${task.id}`}
                          type="button"
                          onClick={() => onOpenTaskDetail?.(task)}
                          data-testid={`week-task-${task.id}`}
                          data-cal-color={colorToken.name}
                          title={task.title}
                          className={`w-full text-left p-2.5 rounded-xl border border-l-3 transition-all space-y-1.5 group focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)] ${colorToken.colorClass} cal-card-surface`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-[var(--text-secondary)] truncate">
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0 cal-swatch-dot"
                                aria-hidden="true"
                              />
                              <CheckSquare className="w-3 h-3 shrink-0 text-[var(--text-primary)]" />
                              <span>{timeStr}</span>
                            </span>
                            <span
                              className={`px-1.5 py-0 rounded-full text-[9px] font-semibold border shrink-0 ${priorityInfo.badgeClass}`}
                            >
                              {priorityInfo.label}
                            </span>
                          </div>

                          <p
                            className={`text-xs font-semibold leading-snug line-clamp-2 break-words ${
                              task.status === 'done'
                                ? 'line-through text-[var(--text-tertiary)]'
                                : 'text-[var(--text-primary)] group-hover:underline'
                            }`}
                          >
                            {task.title}
                          </p>

                          {(task.project || task.status === 'done') && (
                            <div className="flex items-center justify-between gap-1 pt-1 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-tertiary)]">
                              {task.project ? (
                                <span className="inline-flex items-center gap-1 truncate">
                                  <span
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{ backgroundColor: task.project.color || '#E2F925' }}
                                  />
                                  <span className="truncate">{task.project.name}</span>
                                </span>
                              ) : (
                                <span>Task</span>
                              )}
                              {task.status === 'done' && (
                                <CheckCircle2 className="w-3 h-3 text-[var(--status-success-text)] shrink-0" />
                              )}
                            </div>
                          )}
                        </button>
                      );
                    }

                    const { item } = entry;
                    const colorToken = resolveCalendarItemColor('content', item, resolvedColorMap);
                    const platformInfo = PLATFORM_SHORT_MAP[item.platform] || {
                      label: item.platform,
                      badgeClass: 'badge-neutral',
                    };
                    const actionInfo = ACTION_CONFIG[item.action_type] || {
                      label: item.action_type,
                    };

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
                        onClick={() => onOpenDetail(item)}
                        data-testid={`week-content-${item.id}`}
                        data-cal-color={colorToken.name}
                        title={item.title || item.body || 'Untitled post'}
                        className={`w-full text-left p-2.5 rounded-xl border border-l-3 transition-all space-y-1.5 group focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)] ${colorToken.colorClass} cal-card-surface`}
                      >
                        {/* Top row: Time & Platform Badge */}
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-[var(--text-secondary)] truncate">
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0 cal-swatch-dot"
                              aria-hidden="true"
                            />
                            <Clock className="w-2.5 h-2.5 shrink-0" />
                            <span>{timeStr || 'Scheduled'}</span>
                          </span>

                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-semibold border shrink-0 ${platformInfo.badgeClass}`}
                          >
                            <Share2 className="w-2.5 h-2.5 shrink-0" />
                            {platformInfo.label}
                          </span>
                        </div>

                        {/* Title or Body Snippet */}
                        <p className="text-xs font-semibold text-[var(--text-primary)] line-clamp-2 leading-snug break-words group-hover:underline">
                          {item.title || item.body || 'Untitled post'}
                        </p>

                        {/* Bottom row: Action type & account */}
                        <div className="flex items-center justify-between gap-1 pt-1 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-tertiary)]">
                          <span>{actionInfo.label}</span>
                          {item.social_account && (
                            <span className="flex items-center gap-0.5 truncate max-w-[90px] font-mono">
                              <AtSign className="w-2.5 h-2.5 shrink-0" />
                              <span className="truncate">
                                {item.social_account.account_handle.replace(/^@/, '')}
                              </span>
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}

                  {/* Accessible Overflow Control when a day has > 4 items */}
                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleExpandDay(day.dateKey)}
                      data-testid={`week-day-more-${day.dateKey}`}
                      aria-expanded={isExpanded}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-subtle)]/70 hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] transition-colors"
                    >
                      <span>
                        {isExpanded
                          ? 'Show fewer'
                          : `+${hiddenCount} more ${hiddenCount === 1 ? 'item' : 'items'}`}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                      )}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
