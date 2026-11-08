'use client';

import { useState, useMemo, useEffect } from 'react';
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
}

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
}: TaskWorkspaceProps) {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskWithMeta[]>(() =>
    initialTasks.filter((task) => task.created_from !== 'calendar')
  );
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<TaskDateFilter>('all');
  const [sort, setSort] = useState<TaskSort>('default');
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const todayKey = getCalendarDateKey(clock, userTimeZone);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<TaskDetail | null>(null);
  const [subtasksByParent, setSubtasksByParent] = useState<Record<string, TaskWithMeta[]>>({});
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Synchronize client state when server revalidates or initialTasks prop updates
  const [prevInitialTasks, setPrevInitialTasks] = useState(initialTasks);
  if (prevInitialTasks !== initialTasks) {
    setPrevInitialTasks(initialTasks);
    setTasks(initialTasks.filter((task) => task.created_from !== 'calendar'));
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
        if (!matchesTaskDate(t, dateFilter, todayKey, userTimeZone)) return false;
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

  return (
    <div className="space-y-8 min-w-0">
      {/* 1. Page Masthead: Confident Title & Primary Action First */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-5 border-b border-[var(--border-subtle)] pb-7 min-w-0">
        <div className="space-y-2 max-w-2xl min-w-0">
          <h1 className="heading-display text-3xl sm:text-4xl lg:text-[42px] break-words">
            Tasks
          </h1>
          <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed">
            Know what to do next. Organize your work, track progress, and plan your day.
          </p>
        </div>

        <div className="shrink-0">
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="btn-accent px-5 py-2.5 text-xs sm:text-[13px] whitespace-nowrap"
          >
            <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>New Task</span>
          </button>
        </div>
      </header>

      {/* Feedback Banners */}
      {actionError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-2xl border p-4 text-xs sm:text-sm badge-danger"
        >
          <span className="min-w-0 break-words">{actionError}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setActionError(null)}
            className="shrink-0 rounded-full p-1.5 hover:opacity-80 transition-opacity"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 p-3.5 rounded-2xl border badge-success text-xs"
        >
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="break-words">{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="shrink-0 p-1 rounded-full hover:opacity-80 transition-opacity"
            title="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* 2. Simplified Search, Filters & Sort Controls */}
      <section aria-label="Search and filter tasks" className="space-y-3.5 min-w-0">
        {/* Top Row: Search Input + Status Segment Pills */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 min-w-0">
          <div className="relative w-full lg:max-w-sm">
            <Search
              className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search tasks"
              placeholder="Search tasks by title or keyword..."
              className="w-full h-9 pl-9 pr-8 text-xs rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] hover:border-[var(--border-strong)] transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Status Filter Pills */}
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
                    'min-h-8 px-3 py-1 rounded-full font-medium whitespace-nowrap transition-colors',
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

        {/* Bottom Row: Date Filter Pills + Priority / Project / Sort Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 min-w-0">
          <div
            className="inline-flex flex-wrap items-center gap-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] p-1"
            aria-label="Filter tasks by date"
          >
            {(
              [
                { id: 'all', label: 'Any date' },
                { id: 'today', label: 'Today' },
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
                    'min-h-7 rounded-full px-3 py-1 text-xs whitespace-nowrap transition-all',
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
              className="h-8 px-3 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
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
                className="h-8 px-3 max-w-[180px] truncate rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
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
              className="h-8 px-3 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
            >
              <option value="default">Original order</option>
              <option value="due">Due date: soonest</option>
              <option value="priority">Priority: highest</option>
              <option value="newest">Newest first</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="h-8 px-3 rounded-full text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] transition-colors whitespace-nowrap"
              >
                Clear filters
              </button>
            )}

            <span
              role="status"
              className="text-xs font-mono text-[var(--text-muted)] whitespace-nowrap pl-1"
            >
              {filteredTasks.length} tasks
            </span>
          </div>
        </div>
      </section>

      {/* 3. Compact, Scannable Task List */}
      <section aria-label="Task list" className="min-w-0">
        {filteredTasks.length === 0 ? (
          <div className="py-14 px-6 text-center rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 space-y-3">
            <div className="w-10 h-10 rounded-full bg-[var(--bg-surface-muted)] text-[var(--text-muted)] flex items-center justify-center mx-auto border border-[var(--border-subtle)]">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">No tasks found</h3>
              <p className="text-xs text-[var(--text-muted)] max-w-sm mx-auto leading-relaxed">
                {hasActiveFilters
                  ? 'Try a different search or clear your filters to see more tasks.'
                  : 'Get started by creating your first task in this workspace.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
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
            </div>
          </div>
        ) : (
          <div className="surface-card divide-y divide-[var(--border-subtle)] overflow-hidden">
            {filteredTasks.map((task) => {
              const isCompleted = task.status === 'done';
              const isPending = pendingTaskId === task.id;
              const isOverdue =
                !isCompleted &&
                task.status !== 'cancelled' &&
                Boolean(task.due_date) &&
                matchesTaskDate(task, 'overdue', todayKey, userTimeZone);

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
                    'group flex items-start sm:items-center justify-between gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 transition-colors cursor-pointer min-w-0',
                    'hover:bg-[var(--bg-surface-hover)]',
                    isCompleted && 'opacity-65 hover:opacity-100'
                  )}
                >
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
                            'text-sm font-medium leading-snug line-clamp-2 break-words min-w-0 group-hover:underline',
                            isCompleted
                              ? 'line-through text-[var(--text-muted)]'
                              : 'text-[var(--text-primary)]'
                          )}
                        >
                          {task.title}
                        </span>

                        {task.is_blocked && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold badge-danger border shrink-0">
                            <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" />
                            <span>Blocked</span>
                          </span>
                        )}

                        {task.recurrence_rule_id && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium badge-editorial border shrink-0">
                            <Clock className="w-2.5 h-2.5" aria-hidden="true" />
                            <span>Recurring</span>
                          </span>
                        )}
                      </div>

                      {/* Compact Metadata Strip */}
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--text-muted)]">
                        <span
                          className={clsx(
                            'px-2 py-0.5 rounded-full text-[10.5px] font-medium capitalize shrink-0',
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
                          <span className="font-mono text-[11px] text-[var(--text-muted)] shrink-0">
                            {task.completed_subtask_count}/{task.subtask_count} subtasks
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Status Pill & Subtle Editorial Hover Arrow */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={clsx(
                        'px-2.5 py-0.5 rounded-full text-[11px] font-mono capitalize whitespace-nowrap',
                        statusPillClass(task.status, task.is_blocked)
                      )}
                    >
                      {task.status.replace('_', ' ')}
                    </span>
                    <span
                      aria-hidden="true"
                      className="hidden sm:flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] group-hover:bg-[var(--accent)] group-hover:text-[var(--accent-ink)] transition-colors"
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
