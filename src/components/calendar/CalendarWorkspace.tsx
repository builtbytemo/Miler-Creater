'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Inbox,
  Globe,
  RefreshCw,
  AlertCircle,
  Filter,
  LayoutGrid,
  Columns,
  Clock,
  CheckSquare,
  Share2,
  X,
  Layers,
} from 'lucide-react';
import type { ContentItemWithMeta, SocialAccountRow } from '@/lib/services/content-service';
import type { TaskDetail, TaskWithMeta } from '@/lib/services/task-service';
import type { SocialPlatform, ContentStatus, TaskPriority } from '@/types/database';
import {
  getWeekRange,
  getNextWeekRange,
  getPrevWeekRange,
  getMonthGrid,
  getNextMonthDate,
  getPrevMonthDate,
  getDayRange,
  getNextDayDate,
  getPrevDayDate,
  getCalendarDateKey,
  parseLocalDatetimeString,
  getItemHourInTimeZone,
  type WeekRange,
} from '@/lib/temporal/calendar';
import { CalendarDayView } from './CalendarDayView';
import { CalendarWeekView } from './CalendarWeekView';
import { CalendarMonthView } from './CalendarMonthView';
import { UnscheduledContentDrawer } from './UnscheduledContentDrawer';
import { CreateContentModal } from '@/components/content/CreateContentModal';
import { ContentDetailModal } from '@/components/content/ContentDetailModal';
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { getCalendarEventsAction } from '@/lib/actions/content-actions';
import { getTaskDetailAction } from '@/lib/actions/task-actions';
import { useDialog } from '@/lib/hooks/use-dialog';
import {
  buildCalendarItemColorMap,
  resolveCalendarItemColor,
} from '@/lib/calendar/item-colors';

export type CalendarViewMode = 'day' | 'week' | 'month';

interface ProjectOption {
  id: string;
  name: string;
  color: string | null;
}

interface CalendarWorkspaceProps {
  initialScheduledItems: ContentItemWithMeta[];
  initialScheduledTasks?: TaskWithMeta[];
  initialUnscheduledItems: ContentItemWithMeta[];
  workspaceId: string;
  workspaceName?: string;
  socialAccounts: SocialAccountRow[];
  projects: ProjectOption[];
  userTimeZone: string;
  initialWeekRange: WeekRange;
  initialLoadedRange?: { startIso: string; endIso: string };
}

/**
 * Deduplicate an array of items by `id`, keeping the latest entry.
 */
function deduplicateById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (item && item.id && !seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }
  return result;
}

/**
 * Replaces items falling within [rangeStartMs, rangeEndMs] with `fresh` items,
 * while preserving cached items outside that range.
 */
function replaceItemsInRange<T extends { id: string }>(
  existing: T[],
  fresh: T[],
  rangeStartMs: number,
  rangeEndMs: number,
  getTimestampMs: (item: T) => number | null
): T[] {
  const freshIds = new Set(fresh.map((item) => item.id));
  const outside = existing.filter((item) => {
    if (freshIds.has(item.id)) return false;
    const ts = getTimestampMs(item);
    if (ts === null) return true;
    return ts < rangeStartMs || ts > rangeEndMs;
  });

  return deduplicateById([...outside, ...fresh]);
}

const PRIORITY_BADGE_MAP: Record<TaskPriority, { label: string; badgeClass: string }> = {
  urgent: { label: 'Urgent', badgeClass: 'badge-danger' },
  high: { label: 'High', badgeClass: 'badge-warning' },
  medium: { label: 'Med', badgeClass: 'badge-info' },
  low: { label: 'Low', badgeClass: 'badge-neutral' },
};

function formatTime12h(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

function getTaskEffectiveTimestamp(task: TaskWithMeta): string | null {
  return task.scheduled_start || (task.created_from !== 'calendar' ? task.due_date : null);
}

function doesTaskMatchRange(task: TaskWithMeta, startMs: number, endMs: number): boolean {
  if (task.scheduled_start) {
    const ms = new Date(task.scheduled_start).getTime();
    if (ms >= startMs && ms <= endMs) return true;
  }
  if (task.created_from !== 'calendar' && task.due_date) {
    const dueMs = new Date(task.due_date).getTime();
    if (dueMs >= startMs && dueMs <= endMs) return true;
  }
  return false;
}

export function CalendarWorkspace({
  initialScheduledItems,
  initialScheduledTasks = [],
  initialUnscheduledItems,
  workspaceId,
  workspaceName = 'Workspace',
  socialAccounts,
  projects,
  userTimeZone,
  initialWeekRange,
  initialLoadedRange,
}: CalendarWorkspaceProps) {
  // View mode & reference date state
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week');
  const [referenceDate, setReferenceDate] = useState<Date>(() => {
    const now = new Date();
    const startMs = new Date(initialWeekRange.weekStart).getTime();
    const endMs = new Date(initialWeekRange.weekEnd).getTime();
    if (now.getTime() >= startMs && now.getTime() <= endMs) {
      return now;
    }
    return new Date(initialWeekRange.weekStart);
  });

  // Scheduled & Unscheduled state
  const [scheduledItems, setScheduledItems] = useState<ContentItemWithMeta[]>(() =>
    deduplicateById(initialScheduledItems)
  );
  const [scheduledTasks, setScheduledTasks] = useState<TaskWithMeta[]>(() =>
    deduplicateById(initialScheduledTasks)
  );
  const [unscheduledItems, setUnscheduledItems] = useState<ContentItemWithMeta[]>(() =>
    deduplicateById(initialUnscheduledItems)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filter & Drawer state
  const [platformFilter, setPlatformFilter] = useState<SocialPlatform | ''>('');
  const [isUnscheduledDrawerOpen, setIsUnscheduledDrawerOpen] = useState(false);
  const [isAssignedPanelOpen, setIsAssignedPanelOpen] = useState(true);

  // Content Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createDefaultStatus, setCreateDefaultStatus] = useState<ContentStatus>('scheduled');
  const [createInitialScheduledAt, setCreateInitialScheduledAt] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<ContentItemWithMeta | null>(null);

  // Task Modal states
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [createTaskInitialStart, setCreateTaskInitialStart] = useState<string | null>(null);
  const [createTaskInitialEnd, setCreateTaskInitialEnd] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskDetail | null>(null);

  const handleOpenTaskDetail = useCallback(
    async (task: TaskWithMeta) => {
      if (task.is_virtual) {
        setSelectedTask({
          ...task,
          subtasks: [],
          dependencies: [],
          blocking_tasks: [],
        });
        if (task.original_task_id) {
          try {
            const res = await getTaskDetailAction(workspaceId, task.original_task_id);
            if (res.success && res.data) {
              const templateDetail = res.data as TaskDetail;
              setSelectedTask({
                ...templateDetail,
                id: task.id,
                is_virtual: true,
                original_task_id: task.original_task_id,
                scheduled_start: task.scheduled_start,
                scheduled_end: task.scheduled_end,
                due_date: task.due_date,
                occurrence_index: task.occurrence_index,
                recurrence_rule_id: task.recurrence_rule_id,
                status: 'todo',
                subtasks: (templateDetail.subtasks || []).map((st) => ({
                  ...st,
                  status: 'todo' as const,
                  completed_at: null,
                })),
              });
            }
          } catch {
            // Keep optimistic task detail
          }
        }
        return;
      }

      setSelectedTask({
        ...task,
        subtasks: [],
        dependencies: [],
        blocking_tasks: task.blocking_tasks || [],
      });
      try {
        const res = await getTaskDetailAction(workspaceId, task.id);
        if (res.success && res.data) {
          setSelectedTask(res.data as TaskDetail);
        }
      } catch {
        // Keep optimistic task detail on network error
      }
    },
    [workspaceId]
  );

  // Slot Type Picker state (when clicking a calendar slot/date to schedule either Task or Content)
  const [slotPickerContext, setSlotPickerContext] = useState<{
    dateKey: string;
    hour: number | null;
    label: string;
  } | null>(null);
  const [pendingSlotTime, setPendingSlotTime] = useState<string>('');
  const [slotTimeError, setSlotTimeError] = useState<string | null>(null);

  const closeSlotPicker = useCallback(() => {
    setSlotPickerContext(null);
    setSlotTimeError(null);
  }, []);

  const slotPickerDialogRef = useDialog(Boolean(slotPickerContext), closeSlotPicker);

  // Sequence counter to prevent out-of-order race conditions during rapid navigation
  const requestIdRef = useRef(0);

  // Track loaded date ranges in memory so switching Day/Week/Month within an already-fetched range is instant
  const loadedRangesRef = useRef<Array<{ start: number; end: number }>>(
    initialLoadedRange
      ? [
          {
            start: new Date(initialLoadedRange.startIso).getTime(),
            end: new Date(initialLoadedRange.endIso).getTime(),
          },
        ]
      : [
          {
            start: initialWeekRange.weekStart.getTime(),
            end: initialWeekRange.weekEnd.getTime(),
          },
        ]
  );

  // Derived active ranges based on referenceDate and userTimeZone
  const currentDayRange = useMemo(
    () => getDayRange(referenceDate, userTimeZone),
    [referenceDate, userTimeZone]
  );

  const currentWeekRange = useMemo(
    () => getWeekRange(referenceDate, userTimeZone),
    [referenceDate, userTimeZone]
  );

  const currentMonthGrid = useMemo(
    () => getMonthGrid(referenceDate, userTimeZone),
    [referenceDate, userTimeZone]
  );

  const isRangeCovered = useCallback((startMs: number, endMs: number) => {
    return loadedRangesRef.current.some(
      (range) => range.start <= startMs + 1000 && range.end >= endMs - 1000
    );
  }, []);

  const recordLoadedRange = useCallback((startMs: number, endMs: number) => {
    loadedRangesRef.current.push({ start: startMs, end: endMs });
  }, []);

  /**
   * Fetch scheduled content items AND scheduled tasks for the visible range (Day, Week, or Month)
   * via the composite Server Action `getCalendarEventsAction`.
   * Uses sequence ID (`requestIdRef`) to discard stale responses if the user clicks rapidly,
   * and skips network round-trips when the target range is already cached in memory (unless `force` is true).
   */
  const fetchContentAndTasks = useCallback(
    async (targetDate: Date, mode: CalendarViewMode, force = false) => {
      let rangeStart: Date;
      let rangeEnd: Date;

      if (mode === 'day') {
        const day = getDayRange(targetDate, userTimeZone);
        rangeStart = day.dayStart;
        rangeEnd = day.dayEnd;
      } else if (mode === 'week') {
        const week = getWeekRange(targetDate, userTimeZone);
        rangeStart = week.weekStart;
        rangeEnd = week.weekEnd;
      } else {
        const grid = getMonthGrid(targetDate, userTimeZone);
        const firstCell = grid.cells[0];
        const lastCell = grid.cells[grid.cells.length - 1];
        rangeStart = firstCell.startOfDay;
        rangeEnd = lastCell.endOfDay;
      }

      const rangeStartMs = rangeStart.getTime();
      const rangeEndMs = rangeEnd.getTime();

      if (!force && isRangeCovered(rangeStartMs, rangeEndMs)) {
        setErrorMessage(null);
        return;
      }

      // Fetch the full enclosing month grid window so subsequent Day/Week/Month navigations are cached
      const enclosingGrid = getMonthGrid(targetDate, userTimeZone);
      const gridFirst = enclosingGrid.cells[0];
      const gridLast = enclosingGrid.cells[enclosingGrid.cells.length - 1];
      const fetchStartMs = Math.min(rangeStartMs, gridFirst.startOfDay.getTime());
      const fetchEndMs = Math.max(rangeEndMs, gridLast.endOfDay.getTime());

      const currentRequestId = ++requestIdRef.current;

      try {
        setIsLoading(true);
        setErrorMessage(null);

        const res = await getCalendarEventsAction(workspaceId, {
          scheduled_from: new Date(fetchStartMs).toISOString(),
          scheduled_to: new Date(fetchEndMs).toISOString(),
        });

        if (currentRequestId !== requestIdRef.current) return;

        if (res.error) {
          setErrorMessage(res.error);
          return;
        }

        if (res.data) {
          setScheduledItems((prev) =>
            replaceItemsInRange(
              prev,
              res.data!.content,
              fetchStartMs,
              fetchEndMs,
              (item) => (item.scheduled_at ? new Date(item.scheduled_at).getTime() : null)
            )
          );

          setScheduledTasks((prev) =>
            replaceItemsInRange(
              prev,
              res.data!.tasks,
              fetchStartMs,
              fetchEndMs,
              (task) => {
                const effective = getTaskEffectiveTimestamp(task);
                return effective ? new Date(effective).getTime() : null;
              }
            )
          );
        }

        recordLoadedRange(fetchStartMs, fetchEndMs);
      } catch (err) {
        if (currentRequestId !== requestIdRef.current) return;
        setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred');
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [workspaceId, userTimeZone, isRangeCovered, recordLoadedRange]
  );

  // Navigation Handlers
  const handlePrev = () => {
    if (viewMode === 'day') {
      const prevDate = getPrevDayDate(referenceDate, userTimeZone);
      setReferenceDate(prevDate);
      fetchContentAndTasks(prevDate, 'day');
    } else if (viewMode === 'week') {
      const prevWeek = getPrevWeekRange(currentWeekRange.weekStart, userTimeZone);
      setReferenceDate(prevWeek.weekStart);
      fetchContentAndTasks(prevWeek.weekStart, 'week');
    } else {
      const prevMonthDate = getPrevMonthDate(referenceDate, userTimeZone);
      setReferenceDate(prevMonthDate);
      fetchContentAndTasks(prevMonthDate, 'month');
    }
  };

  const handleNext = () => {
    if (viewMode === 'day') {
      const nextDate = getNextDayDate(referenceDate, userTimeZone);
      setReferenceDate(nextDate);
      fetchContentAndTasks(nextDate, 'day');
    } else if (viewMode === 'week') {
      const nextWeek = getNextWeekRange(currentWeekRange.weekStart, userTimeZone);
      setReferenceDate(nextWeek.weekStart);
      fetchContentAndTasks(nextWeek.weekStart, 'week');
    } else {
      const nextMonthDate = getNextMonthDate(referenceDate, userTimeZone);
      setReferenceDate(nextMonthDate);
      fetchContentAndTasks(nextMonthDate, 'month');
    }
  };

  const handleToday = () => {
    const now = new Date();
    setReferenceDate(now);
    fetchContentAndTasks(now, viewMode);
  };

  const handleViewModeChange = (newMode: CalendarViewMode) => {
    if (newMode === viewMode) return;
    setViewMode(newMode);
    fetchContentAndTasks(referenceDate, newMode);
  };

  // Drill-down from Month or Week view cell header to Day view
  const handleSelectDate = (date: Date) => {
    setReferenceDate(date);
    setViewMode('day');
    fetchContentAndTasks(date, 'day');
  };

  // Interactive Slot Scheduling Handlers
  const handleScheduleAtHour = (hour: number) => {
    const formatted = `${String(hour).padStart(2, '0')}:00`;
    setPendingSlotTime(formatted);
    setSlotTimeError(null);
    setSlotPickerContext({
      dateKey: currentDayRange.dateKey,
      hour,
      label: `${currentDayRange.label} at ${formatted}`,
    });
  };

  const handleScheduleAtTime = (timeHHMM: string) => {
    const cleanTime = timeHHMM.trim() || '09:00';
    const [hStr] = cleanTime.split(':');
    const parsedHour = Number(hStr);
    setPendingSlotTime(cleanTime);
    setSlotTimeError(null);
    setSlotPickerContext({
      dateKey: currentDayRange.dateKey,
      hour: Number.isFinite(parsedHour) ? parsedHour : 9,
      label: `${currentDayRange.label} at ${cleanTime}`,
    });
  };

  const handleScheduleOnDate = (dateKey: string) => {
    setPendingSlotTime('09:00');
    setSlotTimeError(null);
    setSlotPickerContext({
      dateKey,
      hour: null,
      label: dateKey,
    });
  };

  const resolveSelectedSlotTimes = (): { startIso: string; endIso: string } | null => {
    if (!slotPickerContext) return null;

    let timePart = '';
    if (pendingSlotTime.trim()) {
      timePart = pendingSlotTime.trim();
    } else if (slotPickerContext.hour !== null) {
      timePart = `${String(slotPickerContext.hour).padStart(2, '0')}:00`;
    } else {
      setSlotTimeError('Please select a time to schedule this item.');
      return null;
    }

    const [hStr, mStr] = timePart.split(':');
    const h = Number(hStr);
    const m = Number(mStr || '0');
    const localStartStr = `${slotPickerContext.dateKey}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const endHour = Math.min(23, h + 1);
    const localEndStr = `${slotPickerContext.dateKey}T${String(endHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    const startUtc = parseLocalDatetimeString(localStartStr, userTimeZone);
    const endUtc = parseLocalDatetimeString(localEndStr, userTimeZone);

    return {
      startIso: startUtc ? startUtc.toISOString() : new Date().toISOString(),
      endIso: endUtc ? endUtc.toISOString() : new Date(Date.now() + 3600000).toISOString(),
    };
  };

  const handleChooseSlotContent = () => {
    const resolved = resolveSelectedSlotTimes();
    if (!resolved) return;

    setCreateDefaultStatus('scheduled');
    setCreateInitialScheduledAt(resolved.startIso);
    setSlotPickerContext(null);
    setSlotTimeError(null);
    setIsCreateModalOpen(true);
  };

  const handleChooseSlotTask = () => {
    const resolved = resolveSelectedSlotTimes();
    if (!resolved) return;

    setCreateTaskInitialStart(resolved.startIso);
    setCreateTaskInitialEnd(resolved.endIso);
    setSlotPickerContext(null);
    setSlotTimeError(null);
    setIsCreateTaskModalOpen(true);
  };

  // Lifecycle Handlers for Content Items (Strictly Idempotent)
  const handleContentCreated = useCallback((newItem: ContentItemWithMeta) => {
    if (newItem.scheduled_at) {
      setScheduledItems((prev) =>
        prev.some((i) => i.id === newItem.id) ? prev : [...prev, newItem]
      );
      setUnscheduledItems((prev) => prev.filter((i) => i.id !== newItem.id));
    } else if (newItem.status === 'idea' || newItem.status === 'draft') {
      setUnscheduledItems((prev) =>
        prev.some((i) => i.id === newItem.id) ? prev : [newItem, ...prev]
      );
    }
  }, []);

  const handleContentUpdated = useCallback((updatedItem: ContentItemWithMeta) => {
    if (updatedItem.scheduled_at) {
      setUnscheduledItems((prev) => prev.filter((i) => i.id !== updatedItem.id));
      setScheduledItems((prev) => {
        const exists = prev.some((i) => i.id === updatedItem.id);
        if (exists) {
          return prev.map((i) => (i.id === updatedItem.id ? updatedItem : i));
        }
        return [...prev, updatedItem];
      });
    } else {
      setScheduledItems((prev) => prev.filter((i) => i.id !== updatedItem.id));
      if (updatedItem.status === 'idea' || updatedItem.status === 'draft') {
        setUnscheduledItems((prev) => {
          const exists = prev.some((i) => i.id === updatedItem.id);
          if (exists) {
            return prev.map((i) => (i.id === updatedItem.id ? updatedItem : i));
          }
          return [updatedItem, ...prev];
        });
      } else {
        setUnscheduledItems((prev) => prev.filter((i) => i.id !== updatedItem.id));
      }
    }

    setSelectedItem(updatedItem);
  }, []);

  const handleContentDeleted = useCallback((id: string) => {
    setScheduledItems((prev) => prev.filter((i) => i.id !== id));
    setUnscheduledItems((prev) => prev.filter((i) => i.id !== id));
    setSelectedItem((prev) => (prev?.id === id ? null : prev));
  }, []);

  // Lifecycle Handlers for Tasks (Strictly Idempotent)
  const handleTaskCreated = useCallback((newTask: TaskWithMeta) => {
    if (newTask.scheduled_start || newTask.due_date) {
      setScheduledTasks((prev) =>
        prev.some((t) => t.id === newTask.id) ? prev : [...prev, newTask]
      );
    }
  }, []);

  const handleTaskUpdated = useCallback(() => {
    fetchContentAndTasks(referenceDate, viewMode, true);
  }, [fetchContentAndTasks, referenceDate, viewMode]);

  // Open detail modal to schedule an unscheduled item
  const handleScheduleFromDrawer = (item: ContentItemWithMeta) => {
    const defaultHourDate = new Date(referenceDate);
    defaultHourDate.setUTCHours(10, 0, 0, 0);
    setSelectedItem({
      ...item,
      status: 'scheduled',
      scheduled_at: defaultHourDate.toISOString(),
    });
  };

  // Compute a stable, unfiltered color map across all tasks and content items so channel filtering
  // or view switching never alters an item's assigned color.
  const itemColorMap = useMemo(
    () =>
      buildCalendarItemColorMap(
        scheduledTasks,
        [...scheduledItems, ...unscheduledItems],
        userTimeZone
      ),
    [scheduledTasks, scheduledItems, unscheduledItems, userTimeZone]
  );

  // Apply platform filter to scheduled items
  const filteredScheduledItems = useMemo(() => {
    return scheduledItems.filter((item) => {
      if (platformFilter && item.platform !== platformFilter) return false;
      return true;
    });
  }, [scheduledItems, platformFilter]);

  // Scope items and tasks to the active view range
  const { visibleRangeStartMs, visibleRangeEndMs } = useMemo(() => {
    if (viewMode === 'day') {
      return {
        visibleRangeStartMs: currentDayRange.dayStart.getTime(),
        visibleRangeEndMs: currentDayRange.dayEnd.getTime(),
      };
    }
    if (viewMode === 'week') {
      return {
        visibleRangeStartMs: currentWeekRange.weekStart.getTime(),
        visibleRangeEndMs: currentWeekRange.weekEnd.getTime(),
      };
    }
    const firstCell = currentMonthGrid.cells[0];
    const lastCell = currentMonthGrid.cells[currentMonthGrid.cells.length - 1];
    return {
      visibleRangeStartMs: firstCell.startOfDay.getTime(),
      visibleRangeEndMs: lastCell.endOfDay.getTime(),
    };
  }, [viewMode, currentDayRange, currentWeekRange, currentMonthGrid]);

  const visibleScheduledItems = useMemo(() => {
    return filteredScheduledItems.filter((item) => {
      if (!item.scheduled_at) return false;
      const ms = new Date(item.scheduled_at).getTime();
      return ms >= visibleRangeStartMs && ms <= visibleRangeEndMs;
    });
  }, [filteredScheduledItems, visibleRangeStartMs, visibleRangeEndMs]);

  const visibleScheduledTasks = useMemo(() => {
    return scheduledTasks.filter((task) =>
      doesTaskMatchRange(task, visibleRangeStartMs, visibleRangeEndMs)
    );
  }, [scheduledTasks, visibleRangeStartMs, visibleRangeEndMs]);

  // Split items & tasks between Workspace-Assigned (created_from !== 'calendar')
  // and Calendar-Scheduled (created_from === 'calendar') for Week & Month views
  const assignedTasksForView = useMemo(
    () => visibleScheduledTasks.filter((t) => t.created_from !== 'calendar' && t.entry_type !== 'calendar_block'),
    [visibleScheduledTasks]
  );
  const calendarTasksForView = useMemo(
    () => visibleScheduledTasks.filter((t) => t.created_from === 'calendar' || t.entry_type === 'calendar_block'),
    [visibleScheduledTasks]
  );
  const assignedContentForView = useMemo(
    () => visibleScheduledItems.filter((i) => i.created_from !== 'calendar'),
    [visibleScheduledItems]
  );
  const calendarContentForView = useMemo(
    () => visibleScheduledItems.filter((i) => i.created_from === 'calendar'),
    [visibleScheduledItems]
  );

  // Strict active unscheduled count (ideas + drafts only)
  const activeUnscheduledCount = useMemo(() => {
    return unscheduledItems.filter(
      (item) => item.scheduled_at === null && (item.status === 'idea' || item.status === 'draft')
    ).length;
  }, [unscheduledItems]);

  // Active period label
  const activePeriodLabel =
    viewMode === 'day'
      ? currentDayRange.label
      : viewMode === 'week'
        ? currentWeekRange.label
        : currentMonthGrid.label;

  const assignedTotalForView = assignedTasksForView.length + assignedContentForView.length;
  const calendarTotalForView = calendarTasksForView.length + calendarContentForView.length;

  return (
    <div className="space-y-6" data-testid="calendar-workspace">
      {/* Editorial Header: Title & Primary Actions */}
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 pb-5 border-b border-[var(--border-subtle)]">
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-tertiary)] flex-wrap">
            <CalendarIcon className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
            <span className="uppercase tracking-[0.12em] font-semibold text-[var(--text-secondary)] truncate max-w-[240px]">
              {workspaceName}
            </span>
            <span aria-hidden="true">·</span>
            <span>Schedule &amp; Time Blocking</span>
            <span
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-[var(--bg-subtle)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
              title="Active Calendar Timezone"
              data-testid="calendar-timezone-badge"
            >
              <Globe className="w-3 h-3 text-[var(--text-tertiary)]" />
              {userTimeZone}
            </span>
          </div>

          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="heading-display text-3xl sm:text-4xl text-[var(--text-primary)]">
              Calendar
            </h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Plan daily focus blocks, task deadlines, and social publishing in one place.
            </p>
          </div>
        </div>

        {/* Right Actions: Unscheduled Backlog, New Task, New Content */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsUnscheduledDrawerOpen((prev) => !prev)}
            data-testid="toggle-unscheduled-drawer"
            aria-pressed={isUnscheduledDrawerOpen}
            className={`inline-flex items-center gap-2 px-3.5 py-2.5 rounded-full text-xs font-semibold border transition-all ${
              isUnscheduledDrawerOpen
                ? 'bg-[var(--text-primary)] text-[var(--bg-canvas)] border-[var(--text-primary)]'
                : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-default)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]'
            }`}
          >
            <Inbox className="w-3.5 h-3.5" />
            <span>Unscheduled</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                isUnscheduledDrawerOpen
                  ? 'bg-[var(--bg-canvas)] text-[var(--text-primary)]'
                  : 'bg-[var(--bg-subtle)] text-[var(--text-primary)]'
              }`}
            >
              {activeUnscheduledCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCreateTaskInitialStart(null);
              setCreateTaskInitialEnd(null);
              setIsCreateTaskModalOpen(true);
            }}
            data-testid="calendar-new-task-btn"
            className="btn-secondary px-4 py-2.5 text-xs font-semibold"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span>New Task</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCreateDefaultStatus('draft');
              setCreateInitialScheduledAt(null);
              setIsCreateModalOpen(true);
            }}
            data-testid="calendar-new-content-btn"
            className="btn-accent px-4 py-2.5 text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Content</span>
          </button>
        </div>
      </header>

      {/* Navigation, View Switcher & Channel Filter Toolbar */}
      <section
        aria-label="Calendar controls"
        className="surface-card p-3 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5"
      >
        {/* Left: Period Navigation Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="inline-flex items-center rounded-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] p-1">
            <button
              type="button"
              onClick={handlePrev}
              disabled={isLoading}
              className="p-1.5 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors disabled:opacity-50"
              aria-label="Previous period"
              data-testid="calendar-prev-btn"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleToday}
              disabled={isLoading}
              className="px-3 py-1 rounded-full text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors disabled:opacity-50"
              data-testid="calendar-today-btn"
            >
              Today
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={isLoading}
              className="p-1.5 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors disabled:opacity-50"
              aria-label="Next period"
              data-testid="calendar-next-btn"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <h2
              className="heading-section text-base sm:text-lg text-[var(--text-primary)] tracking-tight truncate"
              data-testid="calendar-period-label"
            >
              {activePeriodLabel}
            </h2>
            {isLoading && (
              <RefreshCw
                className="w-3.5 h-3.5 text-[var(--text-tertiary)] animate-spin shrink-0"
                aria-label="Loading calendar items"
              />
            )}
          </div>
        </div>

        {/* Right: Segmented View Switcher & Channel Filter */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* View Mode Switcher (Day / Week / Month) */}
          <div
            className="inline-flex items-center rounded-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] p-1"
            role="tablist"
            aria-label="Calendar view mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'day'}
              onClick={() => handleViewModeChange('day')}
              data-testid="view-mode-day"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                viewMode === 'day'
                  ? 'bg-[var(--text-primary)] text-[var(--bg-canvas)] shadow-xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Day</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'week'}
              onClick={() => handleViewModeChange('week')}
              data-testid="view-mode-week"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                viewMode === 'week'
                  ? 'bg-[var(--text-primary)] text-[var(--bg-canvas)] shadow-xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              <span>Week</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'month'}
              onClick={() => handleViewModeChange('month')}
              data-testid="view-mode-month"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                viewMode === 'month'
                  ? 'bg-[var(--text-primary)] text-[var(--bg-canvas)] shadow-xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Month</span>
            </button>
          </div>

          {/* Channel / Platform Filter */}
          <div className="flex items-center gap-1.5">
            <div className="relative flex items-center">
              <Filter className="w-3.5 h-3.5 text-[var(--text-tertiary)] absolute left-3 pointer-events-none" />
              <select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value as SocialPlatform | '')}
                aria-label="Filter channels"
                data-testid="calendar-platform-filter"
                className="pl-8 pr-7 py-1.5 bg-[var(--bg-subtle)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] rounded-full text-xs font-medium text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-strong)] transition-colors"
              >
                <option value="">All Channels</option>
                <option value="x">X (Twitter)</option>
                <option value="linkedin">LinkedIn</option>
                <option value="reddit">Reddit</option>
                <option value="threads">Threads</option>
              </select>
            </div>

            {platformFilter && (
              <button
                type="button"
                onClick={() => setPlatformFilter('')}
                className="px-2.5 py-1.5 rounded-full text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-subtle)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Error Banner */}
      {errorMessage && (
        <div
          role="alert"
          className="p-4 rounded-2xl badge-danger border flex items-center justify-between gap-3 text-xs sm:text-sm"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="font-medium break-words">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)] shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content Area: Full-Width Active Calendar View */}
      <div className="w-full min-w-0">
        {viewMode === 'day' && (
          <CalendarDayView
            dayRange={currentDayRange}
            contentItems={visibleScheduledItems}
            taskItems={visibleScheduledTasks}
            userTimeZone={userTimeZone}
            itemColorMap={itemColorMap}
            onSelectContent={(item) => setSelectedItem(item)}
            onSelectTask={handleOpenTaskDetail}
            onScheduleAtHour={handleScheduleAtHour}
            onScheduleAtTime={handleScheduleAtTime}
          />
        )}

        {viewMode !== 'day' && (
          <div className="space-y-5">
            {/* Full-Width Calendar Grid Header Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                  <CalendarIcon className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                  <span>Calendar time blocks ({calendarTotalForView})</span>
                </span>
                <span className="text-[var(--text-tertiary)]" aria-hidden="true">·</span>
                <span className="text-xs text-[var(--text-secondary)]">
                  Select any day heading for the daily agenda, or click `+` to schedule a time block
                </span>
              </div>

              <button
                type="button"
                onClick={() => setIsAssignedPanelOpen((prev) => !prev)}
                aria-expanded={isAssignedPanelOpen}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  isAssignedPanelOpen
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-default)]'
                    : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Assigned from Tasks &amp; Content ({assignedTotalForView})</span>
              </button>
            </div>

            {/* Separate Area for Tasks & Content Added from the Tasks / Content Tabs */}
            {isAssignedPanelOpen && (
              <section
                aria-label="Workspace-assigned tasks and content"
                className="w-full surface-card overflow-hidden"
              >
                <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]/50 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-primary)] flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
                      <span>Assigned from Tasks &amp; Content Workspaces</span>
                    </h3>
                    <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                      Items added in the Tasks or Content tabs during this {viewMode} (shown separately from calendar time blocks)
                    </p>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)] shrink-0">
                    {assignedTotalForView}
                  </span>
                </div>

                <div className="p-4 sm:p-5">
                  {assignedTotalForView === 0 ? (
                    <div className="py-6 px-4 text-center rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--bg-subtle)]/35">
                      <p className="text-xs font-medium text-[var(--text-secondary)]">
                        No workspace-assigned items in this {viewMode}.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {assignedTasksForView.map((task) => {
                        const priorityInfo =
                          PRIORITY_BADGE_MAP[task.priority] || PRIORITY_BADGE_MAP.medium;
                        const colorToken = resolveCalendarItemColor('task', task, itemColorMap);
                        const effectiveTimestamp = getTaskEffectiveTimestamp(task);
                        const dateKey = effectiveTimestamp
                          ? getCalendarDateKey(effectiveTimestamp, userTimeZone)
                          : null;
                        return (
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => handleOpenTaskDetail(task)}
                            data-testid={`assigned-task-${task.id}`}
                            data-cal-color={colorToken.name}
                            className={`w-full text-left p-3.5 rounded-2xl border border-l-4 transition-all space-y-1.5 group focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)] ${colorToken.colorClass} cal-card-surface`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0 cal-swatch-dot"
                                  aria-hidden="true"
                                />
                                <CheckSquare className="w-3 h-3 shrink-0" />
                                <span>Task</span>
                              </span>
                              <span
                                className={`px-2 py-0.2 rounded-full text-[10px] font-semibold border ${priorityInfo.badgeClass}`}
                              >
                                {priorityInfo.label}
                              </span>
                            </div>
                            <p
                              className={`text-xs sm:text-sm font-semibold leading-snug line-clamp-2 break-words ${
                                task.status === 'done'
                                  ? 'line-through text-[var(--text-tertiary)]'
                                  : 'text-[var(--text-primary)] group-hover:underline'
                              }`}
                            >
                              {task.title}
                            </p>
                            {effectiveTimestamp && (
                              <p className="text-[11px] font-mono text-[var(--text-secondary)]">
                                {dateKey ? `${dateKey} · ` : ''}
                                {task.is_all_day
                                  ? 'All day'
                                  : task.scheduled_start
                                    ? (() => {
                                        const { hour, minute } = getItemHourInTimeZone(
                                          task.scheduled_start,
                                          userTimeZone
                                        );
                                        return formatTime12h(hour, minute);
                                      })()
                                    : task.due_date
                                      ? (() => {
                                          const { hour, minute } = getItemHourInTimeZone(
                                            task.due_date,
                                            userTimeZone
                                          );
                                          return `Due ${formatTime12h(hour, minute)}`;
                                        })()
                                      : ''}
                              </p>
                            )}
                          </button>
                        );
                      })}

                      {assignedContentForView.map((item) => {
                        const colorToken = resolveCalendarItemColor('content', item, itemColorMap);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelectedItem(item)}
                            data-testid={`assigned-content-${item.id}`}
                            data-cal-color={colorToken.name}
                            className={`w-full text-left p-3.5 rounded-2xl border border-l-4 transition-all space-y-1.5 group focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)] ${colorToken.colorClass} cal-card-surface`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0 cal-swatch-dot"
                                  aria-hidden="true"
                                />
                                <Share2 className="w-3 h-3 shrink-0" />
                                <span>{item.platform}</span>
                              </span>
                              {item.scheduled_at && (
                                <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                                  {(() => {
                                    const { hour, minute } = getItemHourInTimeZone(
                                      item.scheduled_at,
                                      userTimeZone
                                    );
                                    return formatTime12h(hour, minute);
                                  })()}
                                </span>
                              )}
                            </div>
                            <p className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] leading-snug line-clamp-2 break-words group-hover:underline">
                              {item.title || item.body || 'Untitled post'}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Full-Width Week / Month Grid (Never squeezed by a side panel) */}
            <div className="w-full min-w-0">
              {viewMode === 'week' && (
                <CalendarWeekView
                  weekDays={currentWeekRange.days}
                  items={calendarContentForView}
                  tasks={calendarTasksForView}
                  userTimeZone={userTimeZone}
                  itemColorMap={itemColorMap}
                  onOpenDetail={(item) => setSelectedItem(item)}
                  onOpenTaskDetail={handleOpenTaskDetail}
                  onSelectDay={handleSelectDate}
                  onScheduleOnDate={handleScheduleOnDate}
                />
              )}
              {viewMode === 'month' && (
                <CalendarMonthView
                  monthGrid={currentMonthGrid}
                  items={calendarContentForView}
                  tasks={calendarTasksForView}
                  userTimeZone={userTimeZone}
                  itemColorMap={itemColorMap}
                  onOpenDetail={(item) => setSelectedItem(item)}
                  onOpenTaskDetail={handleOpenTaskDetail}
                  onSelectDate={handleSelectDate}
                  onScheduleOnDate={handleScheduleOnDate}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Unscheduled Backlog Slide-Over Drawer */}
      <UnscheduledContentDrawer
        items={unscheduledItems}
        isOpen={isUnscheduledDrawerOpen}
        itemColorMap={itemColorMap}
        onClose={() => setIsUnscheduledDrawerOpen(false)}
        onScheduleItem={handleScheduleFromDrawer}
        onOpenDetail={(item) => setSelectedItem(item)}
      />

      {/* Slot Type Picker Modal (When clicking a calendar slot/date) */}
      {slotPickerContext && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 dark:bg-black/75 backdrop-blur-xs p-4"
          onClick={closeSlotPicker}
          data-testid="calendar-slot-picker-backdrop"
        >
          <div
            ref={slotPickerDialogRef}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="slot-picker-title"
            tabIndex={-1}
            data-testid="calendar-slot-picker-modal"
            className="w-full max-w-md surface-elevated bg-[var(--bg-surface-elevated)] border border-[var(--border-strong)] text-[var(--text-primary)] rounded-3xl p-6 space-y-5 shadow-[var(--shadow-elevated)] focus:outline-none"
          >
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-[var(--border-subtle)]">
              <div className="space-y-1 min-w-0">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                  <Clock className="w-3 h-3 text-[var(--text-secondary)] shrink-0" />
                  <span>Time Block</span>
                </span>
                <h3
                  id="slot-picker-title"
                  className="heading-section text-lg sm:text-xl text-[var(--text-primary)]"
                >
                  Schedule on Calendar
                </h3>
                <p className="text-xs text-[var(--text-secondary)] break-words">
                  Target slot:{' '}
                  <span className="font-mono font-semibold text-[var(--text-primary)]">
                    {slotPickerContext.label}
                  </span>{' '}
                  <span className="text-[var(--text-tertiary)]">({userTimeZone})</span>
                </p>
              </div>
              <button
                type="button"
                onClick={closeSlotPicker}
                aria-label="Close slot picker"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 p-4 rounded-2xl bg-[var(--bg-surface-muted)] border border-[var(--border-subtle)]">
              <label
                htmlFor="slot-picker-time"
                className="block text-xs font-semibold text-[var(--text-primary)]"
              >
                Scheduled Time ({userTimeZone}){' '}
                <span className="text-[var(--status-danger-text)]">*</span>
              </label>

              <div className="relative flex items-center">
                <Clock className="w-4 h-4 text-[var(--text-secondary)] absolute left-3.5 pointer-events-none" />
                <input
                  id="slot-picker-time"
                  type="time"
                  value={pendingSlotTime}
                  onChange={(e) => {
                    setPendingSlotTime(e.target.value);
                    if (slotTimeError) setSlotTimeError(null);
                  }}
                  data-testid="slot-picker-time-input"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-xl text-sm font-mono font-semibold text-[var(--text-primary)] shadow-2xs focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)] transition-colors"
                />
              </div>

              {/* Quick Time Presets */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {[
                  { time: '09:00', label: '9:00 AM' },
                  { time: '12:00', label: '12:00 PM' },
                  { time: '15:00', label: '3:00 PM' },
                  { time: '18:00', label: '6:00 PM' },
                ].map((preset) => {
                  const isActive = pendingSlotTime === preset.time;
                  return (
                    <button
                      key={preset.time}
                      type="button"
                      onClick={() => {
                        setPendingSlotTime(preset.time);
                        if (slotTimeError) setSlotTimeError(null);
                      }}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold border transition-colors ${
                        isActive
                          ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)] shadow-2xs'
                          : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              {slotTimeError && (
                <p role="alert" className="text-xs font-medium text-[var(--status-danger-text)]">
                  {slotTimeError}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                Choose what to schedule
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleChooseSlotTask}
                  data-testid="slot-picker-task-btn"
                  className="flex flex-col items-start gap-2.5 p-4 rounded-2xl bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-muted)] border border-[var(--border-strong)] hover:border-[var(--text-primary)] shadow-2xs transition-all text-left group focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)]"
                >
                  <div className="p-2.5 rounded-xl bg-[var(--bg-surface-muted)] border border-[var(--border-subtle)] text-[var(--text-primary)] group-hover:bg-[var(--accent)] group-hover:text-[var(--accent-ink)] group-hover:border-transparent transition-colors">
                    <CheckSquare className="w-5 h-5" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      Schedule Task
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] leading-snug">
                      Block focus time for an action item
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={handleChooseSlotContent}
                  data-testid="slot-picker-content-btn"
                  className="flex flex-col items-start gap-2.5 p-4 rounded-2xl bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-muted)] border border-[var(--border-strong)] hover:border-[var(--text-primary)] shadow-2xs transition-all text-left group focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)]"
                >
                  <div className="p-2.5 rounded-xl bg-[var(--bg-surface-muted)] border border-[var(--border-subtle)] text-[var(--text-primary)] group-hover:bg-[var(--accent)] group-hover:text-[var(--accent-ink)] group-hover:border-transparent transition-colors">
                    <Share2 className="w-5 h-5" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      Schedule Content
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] leading-snug">
                      Plan a social post, thread, or reply
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Content Modal */}
      <CreateContentModal
        workspaceId={workspaceId}
        socialAccounts={socialAccounts}
        projects={projects}
        userTimeZone={userTimeZone}
        defaultStatus={createDefaultStatus}
        initialScheduledAt={createInitialScheduledAt}
        createdFrom="calendar"
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setCreateInitialScheduledAt(null);
        }}
        onContentCreated={handleContentCreated}
      />

      {/* Create Task Modal */}
      <CreateTaskModal
        workspaceId={workspaceId}
        projects={projects}
        userTimeZone={userTimeZone}
        initialScheduledStart={createTaskInitialStart}
        initialScheduledEnd={createTaskInitialEnd}
        createdFrom="calendar"
        isOpen={isCreateTaskModalOpen}
        onClose={() => {
          setIsCreateTaskModalOpen(false);
          setCreateTaskInitialStart(null);
          setCreateTaskInitialEnd(null);
        }}
        onTaskCreated={handleTaskCreated}
      />

      {/* Content Detail & Rescheduling Modal */}
      {selectedItem && (
        <ContentDetailModal
          item={selectedItem}
          workspaceId={workspaceId}
          socialAccounts={socialAccounts}
          projects={projects}
          userTimeZone={userTimeZone}
          isOpen={Boolean(selectedItem)}
          onClose={() => setSelectedItem(null)}
          onContentUpdated={handleContentUpdated}
          onContentDeleted={handleContentDeleted}
        />
      )}

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          workspaceId={workspaceId}
          allTasks={scheduledTasks}
          isOpen={Boolean(selectedTask)}
          onClose={() => setSelectedTask(null)}
          onTaskUpdated={handleTaskUpdated}
          onOpenTask={handleOpenTaskDetail}
          userTimeZone={userTimeZone}
        />
      )}
    </div>
  );
}
