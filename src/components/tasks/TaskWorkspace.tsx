'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCalendarDateKey } from '@/lib/temporal/calendar';
import { matchesTaskDate, sortTaskView, type TaskDateFilter, type TaskSort } from '@/lib/tasks/task-view';
import {
  Search,
  Plus,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Clock,
  Calendar,
  X,
  ArrowUpRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import type { TaskWithMeta, TaskDetail } from '@/lib/services/task-service';
import { completeTaskAction, getTaskDetailAction } from '@/lib/actions/task-actions';
import { EmptyState } from '@/components/ui/EmptyState';
import { CreateTaskModal } from './CreateTaskModal';
import { TaskDetailModal } from './TaskDetailModal';

interface ProjectOption {
  id: string;
  name: string;
  color: string | null;
}

interface TaskWorkspaceProps {
  initialTasks: TaskWithMeta[];
  workspaceId: string;
  projects: ProjectOption[];
  userTimeZone: string;
  initialSearch?: string;
  initialStatusFilter?: string;
  initialPriorityFilter?: string;
  initialDateFilter?: string;
  initialTaskId?: string;
}

const VALID_DATE_FILTERS: readonly TaskDateFilter[] = ['all', 'today', 'overdue', 'unscheduled'];
const VALID_STATUS_FILTERS = ['all', 'active', 'todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
const VALID_PRIORITY_FILTERS = ['all', 'urgent', 'high', 'medium', 'low'] as const;

function formatTaskDueDate(dueDate: string, timeZone?: string): string {
  const date = new Date(dueDate);
  if (Number.isNaN(date.getTime())) return '';

  if (timeZone) {
    try {
      return date.toLocaleDateString('en-US', {
        timeZone,
        month: 'short',
        day: 'numeric',
      });
    } catch {
      // Invalid or unsupported timezone, proceed to fallback
    }
  }

  try {
    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (browserTimeZone) {
      return date.toLocaleDateString('en-US', {
        timeZone: browserTimeZone,
        month: 'short',
        day: 'numeric',
      });
    }
  } catch {
    // Browser timezone resolution failed, proceed to final fallback
  }

  try {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export function TaskWorkspace({
  initialTasks,
  workspaceId,
  projects,
  userTimeZone,
  initialSearch,
  initialStatusFilter,
  initialPriorityFilter,
  initialDateFilter,
  initialTaskId,
}: TaskWorkspaceProps) {
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [tasks, setTasks] = useState<TaskWithMeta[]>(() =>
    initialTasks.filter((task) => task.entry_type !== 'calendar_block' && task.created_from !== 'calendar')
  );
  const [search, setSearch] = useState(initialSearch ?? '');
  const [dateFilter, setDateFilter] = useState<TaskDateFilter>(() => {
    if (initialDateFilter && VALID_DATE_FILTERS.includes(initialDateFilter as TaskDateFilter)) {
      return initialDateFilter as TaskDateFilter;
    }
    if (initialTaskId) return 'all';
    return 'today';
  });
  const [sort, setSort] = useState<TaskSort>('default');
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const todayKey = getCalendarDateKey(clock, userTimeZone);
  const nowMs = clock.getTime();
  const [statusFilter, setStatusFilter] = useState<string>(() =>
    initialStatusFilter &&
    VALID_STATUS_FILTERS.includes(initialStatusFilter as (typeof VALID_STATUS_FILTERS)[number])
      ? initialStatusFilter
      : 'all'
  );
  const [priorityFilter, setPriorityFilter] = useState<string>(() =>
    initialPriorityFilter &&
    VALID_PRIORITY_FILTERS.includes(initialPriorityFilter as (typeof VALID_PRIORITY_FILTERS)[number])
      ? initialPriorityFilter
      : 'all'
  );
  const [projectFilter, setProjectFilter] = useState<string>('all');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<TaskDetail | null>(() => {
    if (!initialTaskId) return null;
    const matched = initialTasks.find(
      (task) =>
        task.id === initialTaskId &&
        task.entry_type !== 'calendar_block' &&
        task.created_from !== 'calendar'
    );
    if (!matched) return null;
    return {
      ...matched,
      subtasks: [],
      dependencies: [],
    };
  });
  const [subtasksByParent, setSubtasksByParent] = useState<Record<string, TaskWithMeta[]>>({});

  useEffect(() => {
    if (!initialTaskId) return;
    let active = true;
    getTaskDetailAction(workspaceId, initialTaskId)
      .then((res) => {
        if (!active || !res.success || !res.data) return;
        const fullDetail = res.data as TaskDetail;
        setSelectedTaskDetail(fullDetail);
        setSubtasksByParent((prev) => ({
          ...prev,
          [initialTaskId]: fullDetail.subtasks,
        }));
      })
      .catch((err) => {
        console.error('Failed to load initial task details:', err);
      });
    return () => {
      active = false;
    };
  }, [initialTaskId, workspaceId]);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Keyboard-first shortcuts: `/` focuses search, `c` opens task creation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isCreateOpen || selectedTaskDetail) return;

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          target.closest('[role="dialog"]'))
      ) {
        return;
      }

      if (event.key === '/') {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        setIsCreateOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCreateOpen, selectedTaskDetail]);

  // Synchronize client state when server revalidates or initialTasks prop updates
  const [prevInitialTasks, setPrevInitialTasks] = useState(initialTasks);
  if (prevInitialTasks !== initialTasks) {
    setPrevInitialTasks(initialTasks);
    setTasks(initialTasks.filter((task) => task.entry_type !== 'calendar_block' && task.created_from !== 'calendar'));
  }

  // Auto-dismiss success message after 5 seconds
  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => {
      setSuccessMessage(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const handleSubtaskCreated = (parentId: string, newSubtask: TaskWithMeta) => {
    setSubtasksByParent((prev) => {
      const existing = prev[parentId] || [];
      if (existing.some((s) => s.id === newSubtask.id)) return prev;
      return { ...prev, [parentId]: [...existing, newSubtask] };
    });

    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === parentId) {
          return {
            ...t,
            subtask_count: t.subtask_count + 1,
            completed_subtask_count:
              newSubtask.status === 'done'
                ? t.completed_subtask_count + 1
                : t.completed_subtask_count,
          };
        }
        return t;
      })
    );

    setSelectedTaskDetail((prev) => {
      if (prev && prev.id === parentId) {
        if (prev.subtasks.some((s) => s.id === newSubtask.id)) return prev;
        const nextSubtasks = [...prev.subtasks, newSubtask];
        return {
          ...prev,
          subtasks: nextSubtasks,
          subtask_count: nextSubtasks.length,
          completed_subtask_count: nextSubtasks.filter((s) => s.status === 'done').length,
        };
      }
      return prev;
    });

    setSuccessMessage(`Subtask "${newSubtask.title}" created successfully.`);
    router.refresh();
  };

  const handleTaskCreated = (newTask: TaskWithMeta) => {
    if (!newTask.parent_task_id) {
      setTasks((prev) => {
        if (prev.some((t) => t.id === newTask.id)) return prev;
        return [newTask, ...prev];
      });
      setSuccessMessage(`Task "${newTask.title}" created successfully.`);
    } else {
      handleSubtaskCreated(newTask.parent_task_id, newTask);
      return;
    }
    router.refresh();
  };

  // Filter tasks client-side for immediate responsive interactions
  const filteredTasks = useMemo(() => {
    return sortTaskView(
      tasks.filter((t) => {
        if (!matchesTaskDate(t, dateFilter, todayKey, userTimeZone, nowMs)) return false;
        // 1. Search filter
        if (search.trim() !== '') {
          const query = search.trim().toLowerCase();
          const matchesTitle = t.title.toLowerCase().includes(query);
          const matchesDesc = t.description?.toLowerCase().includes(query);
          if (!matchesTitle && !matchesDesc) return false;
        }

        // 2. Status filter
        if (statusFilter === 'active') {
          if (t.status === 'done' || t.status === 'cancelled') return false;
        } else if (statusFilter === 'blocked') {
          if (!t.is_blocked) return false;
        } else if (statusFilter !== 'all') {
          if (t.status !== statusFilter) return false;
        }

        // 3. Priority filter
        if (priorityFilter !== 'all') {
          if (t.priority !== priorityFilter) return false;
        }

        // 4. Project filter
        if (projectFilter !== 'all') {
          if (t.project_id !== projectFilter) return false;
        }

        return true;
      }),
      sort
    );
  }, [
    tasks,
    search,
    statusFilter,
    priorityFilter,
    projectFilter,
    dateFilter,
    sort,
    todayKey,
    nowMs,
    userTimeZone,
  ]);

  const hasActiveFilters =
    search.trim() !== '' ||
    statusFilter !== 'all' ||
    priorityFilter !== 'all' ||
    projectFilter !== 'all' ||
    dateFilter !== 'all';

  const clearAllFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setPriorityFilter('all');
    setProjectFilter('all');
    setDateFilter('all');
  };

  const handleQuickToggleDone = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setActionError(null);
      setPendingTaskId(taskId);
      const res = await completeTaskAction(workspaceId, taskId);
      if (res.success && res.data) {
        const typedData = res.data as {
          completedTask: TaskWithMeta;
          nextOccurrence: TaskWithMeta | null;
        };
        setTasks((prev) => {
          const next = prev.map((t) => (t.id === taskId ? typedData.completedTask : t));
          if (typedData.nextOccurrence) {
            next.unshift(typedData.nextOccurrence);
          }
          return next;
        });
        setSuccessMessage('Task completed');
        router.refresh();
      } else {
        setActionError(res.error || 'Could not complete this task. Please try again.');
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Could not complete this task. Please try again.'
      );
    } finally {
      setPendingTaskId(null);
    }
  };

  const handleOpenDetail = async (task: TaskWithMeta) => {
    const cachedSubtasks = subtasksByParent[task.id] || [];
    const initialDetail: TaskDetail = {
      ...task,
      subtasks: cachedSubtasks,
      dependencies: [],
    };
    setSelectedTaskDetail(initialDetail);

    try {
      const res = await getTaskDetailAction(workspaceId, task.id);
      if (res.success && res.data) {
        const fullDetail = res.data as TaskDetail;
        setSelectedTaskDetail(fullDetail);
        setSubtasksByParent((prev) => ({
          ...prev,
          [task.id]: fullDetail.subtasks,
        }));
      }
    } catch (err) {
      console.error('Failed to load task details:', err);
    }
  };

  const priorityBadgeClass = (priority: TaskWithMeta['priority']) => {
    switch (priority) {
      case 'urgent':
        return 'badge-danger border';
      case 'high':
        return 'badge-warning border';
      case 'medium':
        return 'badge-info border';
      default:
        return 'bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] border border-[var(--border-subtle)]';
    }
  };

  const statusPillClass = (status: TaskWithMeta['status'], isBlocked: boolean) => {
    if (isBlocked || status === 'blocked') {
      return 'badge-danger border';
    }
    switch (status) {
      case 'in_progress':
        return 'bg-[var(--accent-subtle)] text-[var(--text-primary)] border border-[var(--accent-border)] font-medium';
      case 'done':
        return 'badge-success border';
      default:
        return 'bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] border border-[var(--border-subtle)]';
    }
  };

  const priorityStripeClass = (priority: TaskWithMeta['priority']) => {
    switch (priority) {
      case 'urgent':
        return 'bg-[var(--accent)]';
      case 'high':
        return 'bg-[var(--status-warning-text)]';
      case 'medium':
        return 'bg-[var(--status-info-text)]/70';
      default:
        return 'bg-[var(--border-strong)]';
    }
  };

  return (
    <div className="space-y-6 min-w-0">
      {/* 1. Page Masthead: Precision Header & Primary Action */}
      <header className="flex flex-col @xl:flex-row @xl:items-end justify-between gap-4 border-b border-[var(--border-subtle)] pb-5 min-w-0">
        <div className="space-y-1 max-w-2xl min-w-0">
          <h1 className="heading-display text-[22px] sm:text-[26px] break-words">
            Tasks
          </h1>
          <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
            Prioritize deliverables, resolve blockers, and keep scheduled work moving.
          </p>
        </div>

        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="btn-accent px-4 py-2 text-xs sm:text-[13px] whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>New Task</span>
            <kbd className="hidden sm:inline-flex items-center justify-center rounded-[3px] border border-white/25 bg-black/15 px-1 py-0.5 text-[10px] font-mono leading-none text-white/90">
              C
            </kbd>
          </button>
        </div>
      </header>

      {/* Feedback Banners */}
      {actionError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border p-3.5 text-xs sm:text-[13px] badge-danger"
        >
          <span className="min-w-0 break-words">{actionError}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setActionError(null)}
            className="shrink-0 rounded-[var(--radius-xs)] p-1.5 hover:opacity-80 transition-opacity"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 p-3.5 rounded-[var(--radius-md)] border badge-success text-xs"
        >
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="break-words">{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="shrink-0 p-1 rounded-[var(--radius-xs)] hover:opacity-80 transition-opacity"
            title="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* 2. Search, Filters & Sort Controls (@container responsive) */}
      <section aria-label="Search and filter tasks" className="space-y-3 min-w-0">
        {/* Top Row: Search Input + Status Segment Tabs */}
        <div className="flex flex-col @3xl:flex-row @3xl:items-center justify-between gap-3 min-w-0">
          <div className="relative w-full @3xl:max-w-xs min-w-0">
            <Search
              className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search tasks"
              placeholder="Search tasks..."
              className="input-control w-full h-9 pl-8.5 pr-12 text-xs"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-[var(--radius-xs)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            ) : (
              <kbd
                aria-hidden="true"
                className="pointer-events-none hidden sm:inline-flex items-center justify-center rounded-[4px] border border-[var(--border-default)] bg-[var(--bg-surface-muted)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-muted)] absolute right-2.5 top-1/2 -translate-y-1/2"
              >
                /
              </kbd>
            )}
          </div>

          {/* Status Filter Tabs */}
          <div className="flex flex-wrap items-center gap-1 text-xs min-w-0">
            {[
              { id: 'all', label: 'All Tasks' },
              { id: 'active', label: 'Active' },
              { id: 'todo', label: 'To Do' },
              { id: 'in_progress', label: 'In Progress' },
              { id: 'blocked', label: 'Blocked' },
              { id: 'done', label: 'Completed' },
            ].map((tab) => {
              const isSelected = statusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={clsx(
                    'min-h-8 px-2.5 py-1 rounded-[var(--radius-sm)] font-medium whitespace-nowrap transition-colors',
                    isSelected
                      ? 'bg-[var(--text-primary)] text-[var(--bg-canvas)] font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)]'
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Bottom Row: Date Filter Segment + Priority / Project / Sort Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-0.5 min-w-0">
          <div
            className="inline-flex flex-wrap items-center gap-0.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] p-0.5"
            aria-label="Filter tasks by date"
          >
            {(
              [
                { id: 'today', label: 'Today' },
                { id: 'all', label: 'Any date' },
                { id: 'overdue', label: 'Overdue' },
                { id: 'unscheduled', label: 'No date' },
              ] as const
            ).map((item) => {
              const isSelected = dateFilter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setDateFilter(item.id)}
                  className={clsx(
                    'min-h-7 rounded-[5px] px-2.5 py-1 text-xs whitespace-nowrap transition-all',
                    isSelected
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-semibold shadow-2xs ring-1 ring-[var(--border-subtle)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] font-medium'
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs min-w-0">
            {/* Priority Selector */}
            <select
              aria-label="Filter by priority"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="input-control w-auto min-h-8 px-2.5 py-1.5 text-xs leading-tight text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            {/* Project Selector */}
            {projects.length > 0 && (
              <select
                aria-label="Filter by project"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="input-control w-auto min-h-8 px-2.5 py-1.5 max-w-[180px] truncate text-xs leading-tight text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <option value="all">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}

            {/* Sort Selector */}
            <select
              aria-label="Sort tasks"
              value={sort}
              onChange={(e) => setSort(e.target.value as TaskSort)}
              className="input-control w-auto min-h-8 px-2.5 py-1.5 text-xs leading-tight text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <option value="default">Time: earliest first</option>
              <option value="due">Due date: soonest</option>
              <option value="priority">Priority: highest</option>
              <option value="newest">Newest first</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="h-8 px-2.5 rounded-[var(--radius-sm)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] transition-colors whitespace-nowrap"
              >
                Clear filters
              </button>
            )}

            <span
              role="status"
              className="text-xs font-mono text-[var(--text-muted)] tabular-nums whitespace-nowrap pl-1"
            >
              {filteredTasks.length} {filteredTasks.length === 1 ? 'task' : 'tasks'}
            </span>
          </div>
        </div>
      </section>

      {/* 3. Compact, Scannable Task List */}
      <section aria-label="Task list" className="min-w-0">
        {filteredTasks.length === 0 ? (
          <EmptyState
            showMascot={!hasActiveFilters}
            icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            title="No tasks found"
            description={
              hasActiveFilters
                ? 'Try adjusting your search query or clearing your active filters.'
                : 'Create your first task to start organizing priorities, deadlines, and subtasks.'
            }
            action={
              <>
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(true)}
                  className="btn-accent px-4 py-2 text-xs"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Create Task</span>
                </button>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="btn-secondary px-4 py-2 text-xs"
                  >
                    Clear filters
                  </button>
                )}
              </>
            }
          />
        ) : (
          <div className="surface-card divide-y divide-[var(--border-subtle)] overflow-hidden">
            {filteredTasks.map((task) => {
              const isCompleted = task.status === 'done';
              const isPending = pendingTaskId === task.id;
              const isOverdue =
                !isCompleted &&
                task.status !== 'cancelled' &&
                Boolean(task.due_date) &&
                matchesTaskDate(task, 'overdue', todayKey, userTimeZone, nowMs);

              return (
                <div
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleOpenDetail(task)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleOpenDetail(task);
                    }
                  }}
                  className={clsx(
                    'group relative flex items-start @lg:items-center justify-between gap-3 @lg:gap-4 px-4 sm:px-5 py-3 transition-colors cursor-pointer min-w-0',
                    'hover:bg-[var(--bg-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-[-2px]',
                    isCompleted && 'opacity-65 hover:opacity-100'
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={clsx(
                      'absolute inset-y-2 left-0 w-[2px] rounded-r-full transition-opacity',
                      priorityStripeClass(task.priority),
                      isCompleted ? 'opacity-25' : 'opacity-75 group-hover:opacity-100'
                    )}
                  />

                  {/* Left: Checkbox + Title + Compact Metadata */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={(e) => handleQuickToggleDone(task.id, e)}
                      aria-label={
                        isCompleted
                          ? `Mark "${task.title}" completed`
                          : `Complete "${task.title}"`
                      }
                      className="mt-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0 disabled:opacity-50"
                      title={isCompleted ? 'Completed' : 'Click to complete'}
                    >
                      {isCompleted ? (
                        <CheckCircle2
                          className="w-4 h-4 text-[var(--status-success-text)]"
                          aria-hidden="true"
                        />
                      ) : (
                        <Circle className="w-4 h-4" aria-hidden="true" />
                      )}
                    </button>

                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span
                          className={clsx(
                            'text-[13.5px] font-medium leading-snug line-clamp-2 break-words min-w-0 group-hover:underline',
                            isCompleted
                              ? 'line-through text-[var(--text-muted)]'
                              : 'text-[var(--text-primary)]'
                          )}
                        >
                          {task.title}
                        </span>

                        {task.is_blocked && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-semibold badge-danger border shrink-0">
                            <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" />
                            <span>Blocked</span>
                          </span>
                        )}

                        {task.recurrence_rule_id && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-medium badge-editorial border shrink-0">
                            <Clock className="w-2.5 h-2.5" aria-hidden="true" />
                            <span>Recurring</span>
                          </span>
                        )}
                      </div>

                      {/* Compact Metadata Strip */}
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--text-muted)]">
                        <span
                          className={clsx(
                            'px-1.5 py-0.5 rounded-[var(--radius-xs)] text-[10.5px] font-medium capitalize shrink-0',
                            priorityBadgeClass(task.priority)
                          )}
                        >
                          {task.priority}
                        </span>

                        {task.project && (
                          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)] min-w-0 max-w-[180px]">
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: task.project.color || '#575651' }}
                            />
                            <span className="truncate">{task.project.name}</span>
                          </span>
                        )}

                        {task.due_date && (
                          <span
                            className={clsx(
                              'inline-flex items-center gap-1 font-mono text-[11px] shrink-0',
                              isOverdue
                                ? 'text-[var(--status-danger-text)] font-medium'
                                : 'text-[var(--text-secondary)]'
                            )}
                          >
                            <Calendar className="w-3 h-3 opacity-75" aria-hidden="true" />
                            <span>
                              {isOverdue ? 'Overdue · ' : 'Due '}
                              {formatTaskDueDate(task.due_date, userTimeZone)}
                            </span>
                          </span>
                        )}

                        {task.subtask_count > 0 && (
                          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-muted)] shrink-0">
                            <span
                              aria-hidden="true"
                              className="h-1 w-8 overflow-hidden rounded-full bg-[var(--bg-surface-muted)]"
                            >
                              <span
                                className="block h-full bg-[var(--accent)] transition-all"
                                style={{
                                  width: `${Math.round(
                                    (task.completed_subtask_count / Math.max(1, task.subtask_count)) * 100
                                  )}%`,
                                }}
                              />
                            </span>
                            <span className="tabular-nums">
                              {task.completed_subtask_count}/{task.subtask_count} subtasks
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Status Pill & Subtle Editorial Hover Arrow */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={clsx(
                        'px-2 py-0.5 rounded-[var(--radius-xs)] text-[11px] font-mono capitalize whitespace-nowrap',
                        statusPillClass(task.status, task.is_blocked)
                      )}
                    >
                      {task.status.replace('_', ' ')}
                    </span>
                    <span
                      aria-hidden="true"
                      className="hidden sm:flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] group-hover:bg-[var(--accent)] group-hover:text-[var(--accent-ink)] transition-colors"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Task Creation Modal */}
      {isCreateOpen && (
        <CreateTaskModal
          workspaceId={workspaceId}
          projects={projects}
          userTimeZone={userTimeZone}
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onTaskCreated={handleTaskCreated}
        />
      )}

      {/* Task Detail Modal */}
      {selectedTaskDetail && (
        <TaskDetailModal
          task={selectedTaskDetail}
          allTasks={tasks}
          workspaceId={workspaceId}
          userTimeZone={userTimeZone}
          isOpen={Boolean(selectedTaskDetail)}
          onClose={() => setSelectedTaskDetail(null)}
          onTaskUpdated={(updatedStatus) => {
            if (updatedStatus && selectedTaskDetail) {
              setSelectedTaskDetail((prev) =>
                prev
                  ? {
                      ...prev,
                      status: updatedStatus,
                      completed_at: updatedStatus === 'done' ? new Date().toISOString() : null,
                      is_blocked:
                        updatedStatus === 'blocked' ? true : prev.blocking_tasks.length > 0,
                    }
                  : null
              );
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === selectedTaskDetail.id
                    ? {
                        ...t,
                        status: updatedStatus,
                        completed_at: updatedStatus === 'done' ? new Date().toISOString() : null,
                        is_blocked:
                          updatedStatus === 'blocked' ? true : t.blocking_tasks.length > 0,
                      }
                    : t
                )
              );
            }
            router.refresh();
          }}
          onSubtaskCreated={handleSubtaskCreated}
          onOpenTask={(task) => handleOpenDetail(task)}
        />
      )}
    </div>
  );
}
