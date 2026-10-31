'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  RefreshCw,
  AlertTriangle,
  Inbox,
  CheckSquare,
  Share2,
} from 'lucide-react';
import type { ContentItemWithMeta, SocialAccountRow } from '@/lib/services/content-service';
import type { TaskWithMeta, TaskDetail } from '@/lib/services/task-service';
import type { WeekRange, MonthGrid, DayRange } from '@/lib/temporal/calendar';
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
  toLocalDatetimeString,
} from '@/lib/temporal/calendar';
import { DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';
import { getCalendarEventsAction } from '@/lib/actions/content-actions';
import { getTaskDetailAction } from '@/lib/actions/task-actions';
import { CalendarDayView } from './CalendarDayView';
import { CalendarWeekView } from './CalendarWeekView';
import { CalendarMonthView } from './CalendarMonthView';
import { UnscheduledContentDrawer } from './UnscheduledContentDrawer';
import { ContentDetailModal } from '@/components/content/ContentDetailModal';
import { CreateContentModal } from '@/components/content/CreateContentModal';
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import type { ContentStatus } from '@/types/database';
import clsx from 'clsx';

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
  socialAccounts?: SocialAccountRow[];
  projects?: ProjectOption[];
  userTimeZone?: string;
  initialWeekRange: WeekRange;
  initialLoadedRange?: { startIso: string; endIso: string };
}

// Deduplication helper to prevent duplicate key errors and repeated items
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

// Replaces items within the given timestamp interval with fresh items while preserving items outside the interval
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

export function CalendarWorkspace({
  initialScheduledItems,
  initialScheduledTasks = [],
  initialUnscheduledItems,
  workspaceId,
  socialAccounts = [],
  projects = [],
  userTimeZone = DEFAULT_TIMEZONE,
  initialWeekRange,
  initialLoadedRange,
}: CalendarWorkspaceProps) {
  // Navigation & Temporal State
  const [referenceDate, setReferenceDate] = useState<Date>(initialWeekRange.weekStart);
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('week');
  const [scheduledItems, setScheduledItems] = useState<ContentItemWithMeta[]>(() =>
    deduplicateById(initialScheduledItems)
  );
  const [scheduledTasks, setScheduledTasks] = useState<TaskWithMeta[]>(() =>
    deduplicateById(initialScheduledTasks)
  );
  const [unscheduledItems, setUnscheduledItems] = useState<ContentItemWithMeta[]>(() =>
    deduplicateById(initialUnscheduledItems)
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // In-memory cache of loaded date intervals (in ms) to eliminate redundant network fetches
  const loadedRangesRef = useRef<Array<{ start: number; end: number }>>([]);

  useEffect(() => {
    if (initialLoadedRange) {
      loadedRangesRef.current = [
        {
          start: new Date(initialLoadedRange.startIso).getTime(),
          end: new Date(initialLoadedRange.endIso).getTime(),
        },
      ];
    } else {
      loadedRangesRef.current = [
        {
          start: initialWeekRange.weekStart.getTime(),
          end: initialWeekRange.weekEnd.getTime(),
        },
      ];
    }
  }, [initialLoadedRange, initialWeekRange]);

  // Synchronize state when initial props change (e.g. navigation or server action revalidation)
  useEffect(() => {
    setScheduledItems(deduplicateById(initialScheduledItems));
  }, [initialScheduledItems]);

  useEffect(() => {
    setScheduledTasks(deduplicateById(initialScheduledTasks));
  }, [initialScheduledTasks]);

  useEffect(() => {
    setUnscheduledItems(deduplicateById(initialUnscheduledItems));
  }, [initialUnscheduledItems]);

  // Request ID ref to protect against out-of-order race conditions
  const requestIdRef = useRef(0);

  // Content Modal States
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedContent, setSelectedContent] = useState<ContentItemWithMeta | null>(null);
  const [isContentDetailOpen, setIsContentDetailOpen] = useState(false);
  const [isCreateContentOpen, setIsCreateContentOpen] = useState(false);
  const [createContentDefaultStatus, setCreateContentDefaultStatus] = useState<ContentStatus>('draft');
  const [createContentInitialScheduledAt, setCreateContentInitialScheduledAt] = useState<string | null>(null);

  // Task Modal States
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<TaskDetail | null>(null);
  const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [createTaskInitialStart, setCreateTaskInitialStart] = useState<string | null>(null);
  const [createTaskInitialEnd, setCreateTaskInitialEnd] = useState<string | null>(null);

  // Slot Scheduling Picker Modal (when an empty time/day slot is clicked)
  const [isSlotPickerOpen, setIsSlotPickerOpen] = useState(false);
  const [pendingSlotDateKey, setPendingSlotDateKey] = useState<string | null>(null);
  const [pendingSlotHour, setPendingSlotHour] = useState<number | null>(null);
  const [pendingSlotTime, setPendingSlotTime] = useState<string>('');
  const [slotPickerError, setSlotPickerError] = useState<string | null>(null);

  // Platform Filter State
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');

  // Derived Temporal Ranges
  const currentDayRange: DayRange = useMemo(
    () => getDayRange(referenceDate, userTimeZone),
    [referenceDate, userTimeZone]
  );

  const currentWeek: WeekRange = useMemo(
    () => getWeekRange(referenceDate, userTimeZone),
    [referenceDate, userTimeZone]
  );

  const currentMonthGrid: MonthGrid = useMemo(
    () => getMonthGrid(referenceDate, userTimeZone),
    [referenceDate, userTimeZone]
  );

  // Helper to check if a required interval [startMs, endMs] is already covered by any cached range
  const isRangeCovered = (startMs: number, endMs: number): boolean => {
    return loadedRangesRef.current.some(
      (range) => range.start <= startMs + 1000 && range.end >= endMs - 1000
    );
  };

  // Unified data fetch for visible range across Day, Week, and Month views
  const fetchContentAndTasks = async (
    targetDate: Date,
    mode: 'day' | 'week' | 'month',
    force = false
  ) => {
    let neededStartMs: number;
    let neededEndMs: number;

    if (mode === 'day') {
      const dayRange = getDayRange(targetDate, userTimeZone);
      neededStartMs = dayRange.dayStart.getTime();
      neededEndMs = dayRange.dayEnd.getTime();
    } else if (mode === 'week') {
      const week = getWeekRange(targetDate, userTimeZone);
      neededStartMs = week.weekStart.getTime();
      neededEndMs = week.weekEnd.getTime();
    } else {
      const grid = getMonthGrid(targetDate, userTimeZone);
      neededStartMs = grid.cells[0].startOfDay.getTime();
      neededEndMs = grid.cells[grid.cells.length - 1].endOfDay.getTime();
    }

    if (!force && isRangeCovered(neededStartMs, neededEndMs)) {
      return;
    }

    const reqId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    // Compute month grid window enclosing targetDate to batch-cache adjacent days/weeks
    const grid = getMonthGrid(targetDate, userTimeZone);
    const gridStartMs = grid.cells[0].startOfDay.getTime();
    const gridEndMs = grid.cells[grid.cells.length - 1].endOfDay.getTime();
    const fetchStartMs = Math.min(gridStartMs, neededStartMs);
    const fetchEndMs = Math.max(gridEndMs, neededEndMs);
    const fetchStartIso = new Date(fetchStartMs).toISOString();
    const fetchEndIso = new Date(fetchEndMs).toISOString();

    try {
      const res = await getCalendarEventsAction(workspaceId, {
        scheduled_from: fetchStartIso,
        scheduled_to: fetchEndIso,
      });

      // Ignore out-of-order responses if a newer request was dispatched
      if (reqId !== requestIdRef.current) return;

      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        // Record covered interval
        loadedRangesRef.current.push({
          start: fetchStartMs,
          end: fetchEndMs,
        });

        const freshContent = res.data.content || [];
        const freshTasks = res.data.tasks || [];

        setScheduledItems((prev) =>
          replaceItemsInRange(
            prev,
            freshContent,
            fetchStartMs,
            fetchEndMs,
            (item) => (item.scheduled_at ? new Date(item.scheduled_at).getTime() : null)
          )
        );

        setScheduledTasks((prev) =>
          replaceItemsInRange(
            prev,
            freshTasks,
            fetchStartMs,
            fetchEndMs,
            (task) => (task.scheduled_start ? new Date(task.scheduled_start).getTime() : null)
          )
        );
      }
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load calendar events');
    } finally {
      if (reqId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  // Switch between Day, Week, and Month views while preserving referenceDate
  const handleSwitchView = (newMode: 'day' | 'week' | 'month') => {
    if (newMode === viewMode) return;
    setViewMode(newMode);
    fetchContentAndTasks(referenceDate, newMode);
  };

  // Previous period navigation
  const handlePrev = () => {
    if (viewMode === 'day') {
      const prevDay = getPrevDayDate(referenceDate, userTimeZone);
      setReferenceDate(prevDay);
      fetchContentAndTasks(prevDay, 'day');
    } else if (viewMode === 'week') {
      const prevWeek = getPrevWeekRange(referenceDate, userTimeZone);
      setReferenceDate(prevWeek.weekStart);
      fetchContentAndTasks(prevWeek.weekStart, 'week');
    } else {
      const prevMonth = getPrevMonthDate(referenceDate, userTimeZone);
      setReferenceDate(prevMonth);
      fetchContentAndTasks(prevMonth, 'month');
    }
  };

  // Next period navigation
  const handleNext = () => {
    if (viewMode === 'day') {
      const nextDay = getNextDayDate(referenceDate, userTimeZone);
      setReferenceDate(nextDay);
      fetchContentAndTasks(nextDay, 'day');
    } else if (viewMode === 'week') {
      const nextWeek = getNextWeekRange(referenceDate, userTimeZone);
      setReferenceDate(nextWeek.weekStart);
      fetchContentAndTasks(nextWeek.weekStart, 'week');
    } else {
      const nextMonth = getNextMonthDate(referenceDate, userTimeZone);
      setReferenceDate(nextMonth);
      fetchContentAndTasks(nextMonth, 'month');
    }
  };

  // Jump to today
  const handleToday = () => {
    const today = new Date();
    setReferenceDate(today);
    fetchContentAndTasks(today, viewMode);
  };

  // Clicking a date cell in month view jumps to Day view for that date
  const handleSelectDateFromMonth = (date: Date) => {
    setReferenceDate(date);
    setViewMode('day');
    fetchContentAndTasks(date, 'day');
  };

  // Clicking a day header in week view jumps to Day view for that date
  const handleSelectDayFromWeek = (dateKey: string) => {
    const [y, m, d] = dateKey.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    setReferenceDate(target);
    setViewMode('day');
    fetchContentAndTasks(target, 'day');
  };

  // Open slot scheduling choice (Content vs Task)
  const handleOpenSlot = (dateKey: string, hour: number | null = null) => {
    setPendingSlotDateKey(dateKey);
    setPendingSlotHour(hour);
    setPendingSlotTime(hour !== null ? `${String(hour).padStart(2, '0')}:00` : '');
    setSlotPickerError(null);
    setIsSlotPickerOpen(true);
  };

  const handleStartScheduleContentFromSlot = () => {
    const dateKey = pendingSlotDateKey || getCalendarDateKey(referenceDate, userTimeZone);
    if (pendingSlotHour === null && !pendingSlotTime.trim()) {
      setSlotPickerError('Please choose a time for this date before continuing.');
      return;
    }
    const time = pendingSlotTime.trim() || '09:00';
    const localIso = `${dateKey}T${time}`;

    setIsSlotPickerOpen(false);
    setCreateContentInitialScheduledAt(localIso);
    setCreateContentDefaultStatus('scheduled');
    setIsCreateContentOpen(true);
  };

  const handleStartScheduleTaskFromSlot = () => {
    const dateKey = pendingSlotDateKey || getCalendarDateKey(referenceDate, userTimeZone);
    if (pendingSlotHour === null && !pendingSlotTime.trim()) {
      setSlotPickerError('Please choose a start time for this date before continuing.');
      return;
    }
    const time = pendingSlotTime.trim() || '09:00';
    const localStart = `${dateKey}T${time}`;
    const [hStr, mStr] = time.split(':');
    const h = parseInt(hStr, 10);
    const endH = Math.min(23, h + 1);
    const localEnd = `${dateKey}T${String(endH).padStart(2, '0')}:${mStr || '00'}`;

    setIsSlotPickerOpen(false);
    setCreateTaskInitialStart(localStart);
    setCreateTaskInitialEnd(localEnd);
    setIsCreateTaskOpen(true);
  };

  // Inspect / edit Content item
  const handleSelectContent = (item: ContentItemWithMeta) => {
    setSelectedContent(item);
    setIsContentDetailOpen(true);
  };

  // Inspect / edit Task item
  const handleSelectTask = async (task: TaskWithMeta) => {
    try {
      const res = await getTaskDetailAction(workspaceId, task.id);
      if (res.data) {
        setSelectedTaskDetail(res.data as TaskDetail);
        setIsTaskDetailOpen(true);
      } else {
        // Fallback minimal task detail
        setSelectedTaskDetail({
          ...task,
          subtasks: [],
          dependencies: [],
        });
        setIsTaskDetailOpen(true);
      }
    } catch {
      setSelectedTaskDetail({
        ...task,
        subtasks: [],
        dependencies: [],
      });
      setIsTaskDetailOpen(true);
    }
  };

  // Quick schedule action from unscheduled drawer
  const handleScheduleFromDrawer = (item: ContentItemWithMeta) => {
    setSelectedContent(item);
    setIsContentDetailOpen(true);
  };

  // Optimistic update when content is updated
  const handleContentUpdated = (updated: ContentItemWithMeta) => {
    if (updated.scheduled_at) {
      setUnscheduledItems((prev) => prev.filter((i) => i.id !== updated.id));

      const updatedKey = getCalendarDateKey(updated.scheduled_at, userTimeZone);
      const isVisibleInCurrentView =
        viewMode === 'day'
          ? currentDayRange.dateKey === updatedKey
          : viewMode === 'week'
            ? currentWeek.days.some((d) => d.dateKey === updatedKey)
            : currentMonthGrid.cells.some((c) => c.dateKey === updatedKey);

      if (isVisibleInCurrentView) {
        setScheduledItems((prev) => {
          const exists = prev.some((i) => i.id === updated.id);
          if (exists) {
            return prev.map((i) => (i.id === updated.id ? updated : i));
          }
          return [...prev, updated];
        });
      } else {
        setScheduledItems((prev) => prev.filter((i) => i.id !== updated.id));
      }
    } else {
      setScheduledItems((prev) => prev.filter((i) => i.id !== updated.id));
      setUnscheduledItems((prev) => {
        const exists = prev.some((i) => i.id === updated.id);
        if (exists) {
          return prev.map((i) => (i.id === updated.id ? updated : i));
        }
        return [updated, ...prev];
      });
    }

    if (selectedContent?.id === updated.id) {
      setSelectedContent(updated);
    }
  };

  // Remove content item upon deletion
  const handleContentDeleted = (deletedId: string) => {
    setScheduledItems((prev) => prev.filter((i) => i.id !== deletedId));
    setUnscheduledItems((prev) => prev.filter((i) => i.id !== deletedId));
    setIsContentDetailOpen(false);
    setSelectedContent(null);
  };

  // Handle new content created (idempotent: does not append duplicate items)
  const handleContentCreated = (newItem: ContentItemWithMeta) => {
    if (newItem.scheduled_at) {
      const newKey = getCalendarDateKey(newItem.scheduled_at, userTimeZone);
      const isVisibleInCurrentView =
        viewMode === 'day'
          ? currentDayRange.dateKey === newKey
          : viewMode === 'week'
            ? currentWeek.days.some((d) => d.dateKey === newKey)
            : currentMonthGrid.cells.some((c) => c.dateKey === newKey);

      if (isVisibleInCurrentView) {
        setScheduledItems((prev) => {
          if (prev.some((i) => i.id === newItem.id)) return prev;
          return [...prev, newItem];
        });
      }
    } else {
      setUnscheduledItems((prev) => {
        if (prev.some((i) => i.id === newItem.id)) return prev;
        return [newItem, ...prev];
      });
    }
    setIsCreateContentOpen(false);
  };

  // Handle new task created (idempotent: does not append duplicate tasks)
  const handleTaskCreated = (newTask: TaskWithMeta) => {
    if (newTask.scheduled_start) {
      const newKey = getCalendarDateKey(newTask.scheduled_start, userTimeZone);
      const isVisibleInCurrentView =
        viewMode === 'day'
          ? currentDayRange.dateKey === newKey
          : viewMode === 'week'
            ? currentWeek.days.some((d) => d.dateKey === newKey)
            : currentMonthGrid.cells.some((c) => c.dateKey === newKey);

      if (isVisibleInCurrentView) {
        setScheduledTasks((prev) => {
          if (prev.some((t) => t.id === newTask.id)) return prev;
          return [...prev, newTask];
        });
      }
    }
    setIsCreateTaskOpen(false);
  };

  // Handle task updated from TaskDetailModal
  const handleTaskUpdated = () => {
    // Re-fetch calendar events to guarantee consistency with dependencies & subtasks (bypass cache)
    fetchContentAndTasks(referenceDate, viewMode, true);
  };

  // Filter scheduled items by channel if selected
  const displayedScheduledItems = scheduledItems.filter((item) => {
    if (selectedPlatform !== 'all' && item.platform !== selectedPlatform) return false;
    return true;
  });

  // Strict backlog count: scheduled_at is null, status is idea or draft, not archived
  const activeUnscheduledCount = unscheduledItems.filter(
    (i) => !i.scheduled_at && i.status !== 'archived' && (i.status === 'idea' || i.status === 'draft')
  ).length;

  const currentPeriodLabel =
    viewMode === 'day'
      ? currentDayRange.label
      : viewMode === 'week'
        ? currentWeek.label
        : currentMonthGrid.label;

  return (
    <div className="space-y-6">
      {/* Calendar Header with Navigation & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-neutral-800">
        {/* Left: Title & Period Navigator */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span>Calendar</span>
            </h1>
            <div className="flex items-center gap-2 mt-1 text-xs text-neutral-400 font-mono">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              <span>{userTimeZone}</span>
            </div>
          </div>

          {/* Navigation Controls: Prev, Today, Next */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-neutral-950 border border-neutral-800 shadow-xs">
            <button
              type="button"
              onClick={handlePrev}
              disabled={isLoading}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors disabled:opacity-50"
              aria-label={`Previous ${viewMode}`}
              title={`Previous ${viewMode}`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleToday}
              disabled={isLoading}
              className="px-2.5 py-1 text-xs font-semibold text-neutral-200 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors disabled:opacity-50"
            >
              Today
            </button>

            <button
              type="button"
              onClick={handleNext}
              disabled={isLoading}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors disabled:opacity-50"
              aria-label={`Next ${viewMode}`}
              title={`Next ${viewMode}`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-neutral-800 mx-1" />

            <span
              data-testid="calendar-period-label"
              className="px-2 text-xs font-bold text-neutral-100 font-mono whitespace-nowrap"
            >
              {currentPeriodLabel}
            </span>
          </div>
        </div>

        {/* Right: View Switcher, Backlog Toggle, New Task & New Content */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* View Switcher: Day / Week / Month */}
          <div className="flex items-center p-1 rounded-xl bg-neutral-950 border border-neutral-800 text-xs">
            <button
              type="button"
              onClick={() => handleSwitchView('day')}
              data-testid="view-switch-day"
              className={clsx(
                'px-3 py-1 rounded-lg font-medium transition-colors',
                viewMode === 'day'
                  ? 'bg-neutral-800 text-white shadow-xs font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200'
              )}
            >
              Day
            </button>
            <button
              type="button"
              onClick={() => handleSwitchView('week')}
              data-testid="view-switch-week"
              className={clsx(
                'px-3 py-1 rounded-lg font-medium transition-colors',
                viewMode === 'week'
                  ? 'bg-neutral-800 text-white shadow-xs font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200'
              )}
            >
              Week
            </button>
            <button
              type="button"
              onClick={() => handleSwitchView('month')}
              data-testid="view-switch-month"
              className={clsx(
                'px-3 py-1 rounded-lg font-medium transition-colors',
                viewMode === 'month'
                  ? 'bg-neutral-800 text-white shadow-xs font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200'
              )}
            >
              Month
            </button>
          </div>

          {/* Platform Channel Filter */}
          <select
            value={selectedPlatform}
            onChange={(e) => setSelectedPlatform(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-neutral-300 focus:outline-none focus:border-blue-500"
            aria-label="Filter channels"
          >
            <option value="all">All Channels</option>
            <option value="linkedin">LinkedIn</option>
            <option value="reddit">Reddit</option>
            <option value="threads">Threads</option>
            <option value="x">X</option>
          </select>

          {/* Unscheduled Backlog Drawer Toggle Button */}
          <button
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            data-testid="toggle-unscheduled-drawer"
            className="px-3 py-1.5 rounded-xl bg-neutral-950 hover:bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 hover:text-white flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <Inbox className="w-3.5 h-3.5 text-amber-400" />
            <span>Unscheduled</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {activeUnscheduledCount}
            </span>
          </button>

          {/* New Task Button (no slot selected: does not silently assign a date or time) */}
          <button
            type="button"
            onClick={() => {
              setCreateTaskInitialStart(null);
              setCreateTaskInitialEnd(null);
              setIsCreateTaskOpen(true);
            }}
            data-testid="calendar-new-task-btn"
            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span>New Task</span>
          </button>

          {/* New Content Button (no slot selected: does not silently assign a date or time) */}
          <button
            type="button"
            onClick={() => {
              setCreateContentInitialScheduledAt(null);
              setCreateContentDefaultStatus('draft');
              setIsCreateContentOpen(true);
            }}
            data-testid="calendar-new-content-btn"
            className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Content</span>
          </button>
        </div>
      </div>

      {/* Navigation Error Alert & Retry */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/80 flex items-center justify-between text-xs text-red-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchContentAndTasks(referenceDate, viewMode, true)}
            className="px-2.5 py-1 rounded-md bg-red-900/60 hover:bg-red-900 text-white font-medium flex items-center gap-1 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Main View: Day Timeline, Week Grid, or Month Grid */}
      {viewMode === 'day' ? (
        <CalendarDayView
          dayRange={currentDayRange}
          contentItems={displayedScheduledItems}
          taskItems={scheduledTasks}
          userTimeZone={userTimeZone}
          onSelectContent={handleSelectContent}
          onSelectTask={handleSelectTask}
          onNewAtHour={(dateKey, hour) => handleOpenSlot(dateKey, hour)}
          isLoading={isLoading}
        />
      ) : viewMode === 'week' ? (
        <CalendarWeekView
          weekRange={currentWeek}
          items={displayedScheduledItems}
          taskItems={scheduledTasks}
          userTimeZone={userTimeZone}
          onSelectItem={handleSelectContent}
          onSelectTask={handleSelectTask}
          onNewForDay={(dateKey) => handleOpenSlot(dateKey, null)}
          onSelectDay={handleSelectDayFromWeek}
          isLoading={isLoading}
        />
      ) : (
        <CalendarMonthView
          monthGrid={currentMonthGrid}
          items={displayedScheduledItems}
          taskItems={scheduledTasks}
          userTimeZone={userTimeZone}
          onSelectItem={handleSelectContent}
          onSelectTask={handleSelectTask}
          onSelectDate={handleSelectDateFromMonth}
          onNewForDate={(dateKey) => handleOpenSlot(dateKey, null)}
          isLoading={isLoading}
        />
      )}

      {/* Unscheduled Content Backlog Drawer */}
      <UnscheduledContentDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        items={unscheduledItems}
        userTimeZone={userTimeZone}
        onSelectItem={handleSelectContent}
        onScheduleItem={handleScheduleFromDrawer}
        onCaptureNewIdea={() => {
          setIsDrawerOpen(false);
          setCreateContentInitialScheduledAt(null);
          setCreateContentDefaultStatus('idea');
          setIsCreateContentOpen(true);
        }}
      />

      {/* Slot Type Picker Modal (Schedule Content or Add Task) */}
      {isSlotPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-sm w-full p-6 text-neutral-100 shadow-2xl space-y-4">
            <div>
              <h3 className="text-base font-semibold text-white">Schedule on Calendar</h3>
              <p className="text-xs text-neutral-400 mt-1">
                Selected date: <span className="font-mono text-neutral-200">{pendingSlotDateKey}</span>
              </p>
            </div>

            {slotPickerError && (
              <div className="p-2.5 rounded-lg bg-red-950/40 border border-red-800 text-red-300 text-xs">
                {slotPickerError}
              </div>
            )}

            <div>
              <label htmlFor="slot-picker-time" className="block text-xs font-medium text-neutral-300 mb-1">
                Schedule Time {pendingSlotHour === null ? <span className="text-amber-400 font-normal">(Please choose a time)</span> : ''}
              </label>
              <input
                id="slot-picker-time"
                type="time"
                value={pendingSlotTime}
                onChange={(e) => {
                  setPendingSlotTime(e.target.value);
                  setSlotPickerError(null);
                }}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-neutral-700 bg-neutral-800 text-neutral-200 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={handleStartScheduleContentFromSlot}
                className="p-3.5 rounded-xl border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 text-xs font-semibold flex flex-col items-center gap-2 transition-all hover:scale-[1.02]"
              >
                <Share2 className="w-5 h-5 text-blue-400" />
                <span>Schedule Content</span>
              </button>

              <button
                type="button"
                onClick={handleStartScheduleTaskFromSlot}
                className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs font-semibold flex flex-col items-center gap-2 transition-all hover:scale-[1.02]"
              >
                <CheckSquare className="w-5 h-5 text-emerald-400" />
                <span>Schedule Task</span>
              </button>
            </div>

            <div className="pt-2 text-right">
              <button
                type="button"
                onClick={() => setIsSlotPickerOpen(false)}
                className="text-xs text-neutral-400 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content Detail & Edit Modal */}
      {selectedContent && (
        <ContentDetailModal
          item={selectedContent}
          workspaceId={workspaceId}
          isOpen={isContentDetailOpen}
          onClose={() => {
            setIsContentDetailOpen(false);
            setSelectedContent(null);
          }}
          onContentUpdated={handleContentUpdated}
          onContentDeleted={handleContentDeleted}
          socialAccounts={socialAccounts}
          projects={projects}
          userTimeZone={userTimeZone}
        />
      )}

      {/* Content Creation Modal */}
      {isCreateContentOpen && (
        <CreateContentModal
          workspaceId={workspaceId}
          isOpen={isCreateContentOpen}
          onClose={() => {
            setIsCreateContentOpen(false);
            setCreateContentInitialScheduledAt(null);
          }}
          onContentCreated={handleContentCreated}
          defaultStatus={createContentDefaultStatus}
          initialScheduledAt={createContentInitialScheduledAt}
          userTimeZone={userTimeZone}
          socialAccounts={socialAccounts}
          projects={projects}
        />
      )}

      {/* Task Creation Modal */}
      {isCreateTaskOpen && (
        <CreateTaskModal
          workspaceId={workspaceId}
          projects={projects}
          isOpen={isCreateTaskOpen}
          onClose={() => {
            setIsCreateTaskOpen(false);
            setCreateTaskInitialStart(null);
            setCreateTaskInitialEnd(null);
          }}
          onTaskCreated={handleTaskCreated}
          initialScheduledStart={createTaskInitialStart}
          initialScheduledEnd={createTaskInitialEnd}
          userTimeZone={userTimeZone}
        />
      )}

      {/* Task Detail Modal */}
      {selectedTaskDetail && (
        <TaskDetailModal
          task={selectedTaskDetail}
          allTasks={scheduledTasks}
          workspaceId={workspaceId}
          isOpen={isTaskDetailOpen}
          onClose={() => {
            setIsTaskDetailOpen(false);
            setSelectedTaskDetail(null);
          }}
          onTaskUpdated={handleTaskUpdated}
        />
      )}
    </div>
  );
}
