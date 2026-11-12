'use client';

import { useState, useId } from 'react';
import { useDialog } from '@/lib/hooks/use-dialog';
import {
  X,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  Plus,
  Trash2,
  Link as LinkIcon,
  Loader2,
  Repeat,
  Edit3,
} from 'lucide-react';
import { clsx } from 'clsx';
import type { TaskDetail, TaskWithMeta, RecurrenceRuleDetail } from '@/lib/services/task-service';
import type { TaskStatus, TaskPriority } from '@/types/database';
import {
  completeTaskAction,
  cancelTaskAction,
  deleteTaskAction,
  updateTaskAction,
  addTaskDependencyAction,
  removeTaskDependencyAction,
  updateRecurrenceRuleAction,
  stopRecurrenceAction,
  makeTaskRecurringAction,
  type TaskActionResult,
} from '@/lib/actions/task-actions';
import { formatRecurrenceSummary } from '@/lib/temporal/recurrence';
import { toLocalDatetimeString, parseLocalDatetimeString } from '@/lib/temporal/calendar';
import { DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';
import { CreateTaskModal } from './CreateTaskModal';

interface TaskDetailModalProps {
  task: TaskDetail;
  allTasks: TaskWithMeta[];
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
  onTaskUpdated?: (updatedStatus?: TaskStatus) => void;
  onSubtaskCreated?: (parentId: string, subtask: TaskWithMeta) => void;
  onOpenTask?: (task: TaskWithMeta) => void;
  userTimeZone?: string;
}

export function TaskDetailModal({
  task,
  allTasks,
  workspaceId,
  isOpen,
  onClose,
  onTaskUpdated,
  onSubtaskCreated,
  onOpenTask,
  userTimeZone = DEFAULT_TIMEZONE,
}: TaskDetailModalProps) {
  const [currentTask, setCurrentTask] = useState<TaskDetail>(task);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isSubtaskModalOpen, setIsSubtaskModalOpen] = useState(false);
  const [selectedPrereqId, setSelectedPrereqId] = useState('');
  const [depError, setDepError] = useState<string | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);

  // Edit Task (This Occurrence Only) State
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editEntryType, setEditEntryType] = useState<'task' | 'calendar_block'>(task.entry_type || 'task');
  const [editDescription, setEditDescription] = useState(task.description || '');
  const [editPriority, setEditPriority] = useState<TaskPriority>(task.priority);
  const [editScheduledStart, setEditScheduledStart] = useState(
    task.scheduled_start ? toLocalDatetimeString(task.scheduled_start, userTimeZone) : ''
  );
  const [editScheduledEnd, setEditScheduledEnd] = useState(
    task.scheduled_end ? toLocalDatetimeString(task.scheduled_end, userTimeZone) : ''
  );
  const [editDueDate, setEditDueDate] = useState(
    task.due_date ? toLocalDatetimeString(task.due_date, userTimeZone) : ''
  );
  const [editDuration, setEditDuration] = useState<number | ''>(
    task.estimated_duration_minutes ?? ''
  );

  // Recurrence Series Editing State
  const [isEditingRecurrence, setIsEditingRecurrence] = useState(false);
  const [ruleFreq, setRuleFreq] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>(
    task.recurrence_rule?.frequency || 'weekly'
  );
  const [ruleInterval, setRuleInterval] = useState(task.recurrence_rule?.interval || 1);
  const [ruleWeekdays, setRuleWeekdays] = useState<number[]>(
    task.recurrence_rule?.by_weekday || [1]
  );
  const [ruleMonthday, setRuleMonthday] = useState(
    task.recurrence_rule?.by_monthday?.[0] || 1
  );
  const [ruleEndType, setRuleEndType] = useState<'never' | 'until_date' | 'count'>(
    task.recurrence_rule?.count
      ? 'count'
      : task.recurrence_rule?.until_date
        ? 'until_date'
        : 'never'
  );
  const [ruleUntilDate, setRuleUntilDate] = useState(
    task.recurrence_rule?.until_date ? task.recurrence_rule.until_date.split('T')[0] : ''
  );
  const [ruleCount, setRuleCount] = useState(task.recurrence_rule?.count || 10);
  const [isStopConfirmOpen, setIsStopConfirmOpen] = useState(false);
  const [recurrenceError, setRecurrenceError] = useState<string | null>(null);

  // Sync state when task prop changes
  const [prevTaskProp, setPrevTaskProp] = useState<TaskDetail>(task);
  if (prevTaskProp !== task) {
    setPrevTaskProp(task);
    setCurrentTask(task);
    setStatusError(null);
    setRecurrenceError(null);
    setIsEditingTask(false);
    setIsEditingRecurrence(false);
    setIsStopConfirmOpen(false);

    setEditTitle(task.title);
    setEditEntryType(task.entry_type || 'task');
    setEditDescription(task.description || '');
    setEditPriority(task.priority);
    setEditScheduledStart(
      task.scheduled_start ? toLocalDatetimeString(task.scheduled_start, userTimeZone) : ''
    );
    setEditScheduledEnd(
      task.scheduled_end ? toLocalDatetimeString(task.scheduled_end, userTimeZone) : ''
    );
    setEditDueDate(task.due_date ? toLocalDatetimeString(task.due_date, userTimeZone) : '');
    setEditDuration(task.estimated_duration_minutes ?? '');

    setRuleFreq(task.recurrence_rule?.frequency || 'weekly');
    setRuleInterval(task.recurrence_rule?.interval || 1);
    setRuleWeekdays(task.recurrence_rule?.by_weekday || [1]);
    setRuleMonthday(task.recurrence_rule?.by_monthday?.[0] || 1);
    setRuleEndType(
      task.recurrence_rule?.count
        ? 'count'
        : task.recurrence_rule?.until_date
          ? 'until_date'
          : 'never'
    );
    setRuleUntilDate(
      task.recurrence_rule?.until_date ? task.recurrence_rule.until_date.split('T')[0] : ''
    );
    setRuleCount(task.recurrence_rule?.count || 10);
  }

  const isVirtual = Boolean(currentTask.is_virtual);
  const dialogRef = useDialog(isOpen && !isSubtaskModalOpen, onClose, isActionPending);
  const titleId = useId();

  if (!isOpen) return null;

  // Potential prerequisites: tasks in this workspace other than itself and its existing dependencies
  const existingDepIds = new Set(currentTask.dependencies.map((d) => d.depends_on_task_id));
  const candidatePrereqs = allTasks.filter(
    (t) =>
      t.id !== currentTask.id &&
      !existingDepIds.has(t.id) &&
      t.parent_task_id !== currentTask.id
  );

  const handleSubtaskCreated = (newSubtask: TaskWithMeta) => {
    setCurrentTask((prev) => {
      if (prev.subtasks.some((s) => s.id === newSubtask.id)) return prev;
      const nextSubtasks = [...prev.subtasks, newSubtask];
      return {
        ...prev,
        subtasks: nextSubtasks,
        subtask_count: nextSubtasks.length,
        completed_subtask_count: nextSubtasks.filter((s) => s.status === 'done').length,
      };
    });

    onSubtaskCreated?.(currentTask.id, newSubtask);
  };

  const handleToggleSubtask = async (subtaskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const targetSubtask = currentTask.subtasks.find((s) => s.id === subtaskId);
    if (!targetSubtask) return;

    const newStatus: TaskStatus = targetSubtask.status === 'done' ? 'todo' : 'done';
    try {
      setIsActionPending(true);
      let res: TaskActionResult;
      if (newStatus === 'done') {
        res = await completeTaskAction(workspaceId, subtaskId);
      } else {
        const formData = new FormData();
        formData.set('workspace_id', workspaceId);
        formData.set('task_id', subtaskId);
        formData.set('status', 'todo');
        res = await updateTaskAction(null, formData);
      }

      if (res.error) {
        setStatusError(res.error);
        return;
      }

      setCurrentTask((prev) => {
        const nextSubtasks = prev.subtasks.map((s) =>
          s.id === subtaskId
            ? {
                ...s,
                status: newStatus,
                completed_at: newStatus === 'done' ? new Date().toISOString() : null,
              }
            : s
        );
        return {
          ...prev,
          subtasks: nextSubtasks,
          completed_subtask_count: nextSubtasks.filter((s) => s.status === 'done').length,
        };
      });

      onTaskUpdated?.();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to update subtask');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleStatusChange = async (newStatus: TaskStatus) => {
    if (newStatus === currentTask.status) return;
    setStatusError(null);

    // Prerequisite dependency restriction check for 'done'
    const isCompletionRestricted =
      currentTask.is_blocked ||
      (currentTask.blocking_tasks && currentTask.blocking_tasks.length > 0) ||
      (currentTask.dependencies &&
        currentTask.dependencies.some((d) => d.prerequisite_task?.status !== 'done'));

    if (newStatus === 'done' && isCompletionRestricted) {
      setStatusError('Cannot complete task while prerequisite dependencies are unresolved.');
      return;
    }

    try {
      setIsActionPending(true);
      let result: TaskActionResult;

      if (newStatus === 'done') {
        result = await completeTaskAction(workspaceId, currentTask.id);
      } else if (newStatus === 'cancelled') {
        result = await cancelTaskAction(workspaceId, currentTask.id);
      } else {
        const formData = new FormData();
        formData.set('workspace_id', workspaceId);
        formData.set('task_id', currentTask.id);
        formData.set('status', newStatus);
        result = await updateTaskAction(null, formData);
      }

      if (result.error) {
        setStatusError(result.error);
        return;
      }

      setCurrentTask((prev) => ({
        ...prev,
        status: newStatus,
        completed_at: newStatus === 'done' ? new Date().toISOString() : null,
        is_blocked:
          newStatus === 'blocked'
            ? true
            : Boolean(prev.blocking_tasks && prev.blocking_tasks.length > 0),
      }));

      onTaskUpdated?.(newStatus);
    } catch (err) {
      setStatusError(
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred while updating status.'
      );
    } finally {
      setIsActionPending(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete task "${currentTask.title}"?`)) return;
    try {
      setIsActionPending(true);
      await deleteTaskAction(workspaceId, currentTask.id);
      onTaskUpdated?.();
      onClose();
    } finally {
      setIsActionPending(false);
    }
  };

  // Ordinary Task Properties Update Handler (This Occurrence Only)
  const handleSaveTaskEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTitle.trim()) {
      setStatusError('Task title is required.');
      return;
    }

    try {
      setIsActionPending(true);
      setStatusError(null);

      const formData = new FormData();
      formData.set('workspace_id', workspaceId);
      formData.set('task_id', currentTask.id);
      formData.set('entry_type', editEntryType);
      formData.set('title', editTitle.trim());
      formData.set('description', editDescription.trim());
      formData.set('priority', editPriority);

      if (editScheduledStart.trim()) {
        const parsed = parseLocalDatetimeString(editScheduledStart.trim(), userTimeZone);
        formData.set('scheduled_start', parsed ? parsed.toISOString() : editScheduledStart.trim());
      } else {
        formData.delete('scheduled_start');
      }

      if (editScheduledEnd.trim()) {
        const parsed = parseLocalDatetimeString(editScheduledEnd.trim(), userTimeZone);
        formData.set('scheduled_end', parsed ? parsed.toISOString() : editScheduledEnd.trim());
      } else {
        formData.delete('scheduled_end');
      }

      if (editDueDate.trim()) {
        const parsed = parseLocalDatetimeString(editDueDate.trim(), userTimeZone);
        formData.set('due_date', parsed ? parsed.toISOString() : editDueDate.trim());
      } else {
        formData.delete('due_date');
      }

      if (editDuration !== '') {
        formData.set('estimated_duration_minutes', String(editDuration));
      } else {
        formData.delete('estimated_duration_minutes');
      }

      const res = await updateTaskAction(null, formData);
      if (res.error) {
        setStatusError(res.error);
        return;
      }

      if (res.data) {
        const updated = res.data as TaskWithMeta;
        setCurrentTask((prev) => ({
          ...prev,
          entry_type: updated.entry_type,
          title: updated.title,
          description: updated.description,
          priority: updated.priority,
          scheduled_start: updated.scheduled_start,
          scheduled_end: updated.scheduled_end,
          due_date: updated.due_date,
          estimated_duration_minutes: updated.estimated_duration_minutes,
        }));
      }

      setIsEditingTask(false);
      onTaskUpdated?.();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to update task');
    } finally {
      setIsActionPending(false);
    }
  };

  // Recurrence Schedule Edit Handler (Entire Series)
  const handleSaveRecurrenceEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ruleId = currentTask.recurrence_rule_id;

    if (ruleFreq === 'weekly' && ruleWeekdays.length === 0) {
      setRecurrenceError('Please select at least one weekday for weekly recurrence.');
      return;
    }
    if (ruleFreq === 'monthly' && (ruleMonthday < 1 || ruleMonthday > 31)) {
      setRecurrenceError('Month day must be between 1 and 31.');
      return;
    }
    if (ruleEndType === 'until_date' && !ruleUntilDate.trim()) {
      setRecurrenceError('Please choose an end date for recurrence.');
      return;
    }
    if (ruleEndType === 'count' && (!ruleCount || ruleCount < 1)) {
      setRecurrenceError('Occurrence count must be at least 1.');
      return;
    }

    try {
      setIsActionPending(true);
      setRecurrenceError(null);

      const recurrenceInput = {
        frequency: ruleFreq,
        interval: Math.max(1, ruleInterval),
        by_weekday: ruleFreq === 'weekly' ? ruleWeekdays : null,
        by_monthday: ruleFreq === 'monthly' ? [ruleMonthday] : null,
        until_date:
          ruleEndType === 'until_date' && ruleUntilDate
            ? new Date(`${ruleUntilDate}T23:59:59.999Z`).toISOString()
            : null,
        count: ruleEndType === 'count' ? ruleCount : null,
        timezone: currentTask.recurrence_rule?.timezone || userTimeZone,
      };

      if (ruleId) {
        // Updating existing rule
        const res = await updateRecurrenceRuleAction(workspaceId, ruleId, recurrenceInput);
        if (res.error) {
          setRecurrenceError(res.error);
          return;
        }

        if (res.data) {
          setCurrentTask((prev) => ({
            ...prev,
            recurrence_rule: res.data as RecurrenceRuleDetail,
          }));
        }
      } else {
        // Making an existing standalone task recurring
        const res = await makeTaskRecurringAction(workspaceId, currentTask.id, recurrenceInput);
        if (res.error) {
          setRecurrenceError(res.error);
          return;
        }

        if (res.data) {
          setCurrentTask((prev) => ({
            ...prev,
            recurrence_rule_id: res.data?.rule.id || null,
            recurrence_rule: res.data?.rule || null,
          }));
        }
      }

      setIsEditingRecurrence(false);
      onTaskUpdated?.();
    } catch (err) {
      setRecurrenceError(err instanceof Error ? err.message : 'Failed to update recurrence');
    } finally {
      setIsActionPending(false);
    }
  };

  // Stop Recurrence Handler
  const handleStopRecurrence = async () => {
    const ruleId = currentTask.recurrence_rule_id;
    if (!ruleId) return;

    try {
      setIsActionPending(true);
      setRecurrenceError(null);

      const targetTaskId = currentTask.is_virtual
        ? currentTask.original_task_id || undefined
        : currentTask.id;

      const res = await stopRecurrenceAction(workspaceId, ruleId, targetTaskId);
      if (res.error) {
        setRecurrenceError(res.error);
        return;
      }

      setCurrentTask((prev) => ({
        ...prev,
        recurrence_rule_id: null,
        recurrence_rule: null,
      }));

      setIsStopConfirmOpen(false);
      onTaskUpdated?.();

      // If viewing a virtual occurrence that was just stopped, close modal
      if (isVirtual) {
        onClose();
      }
    } catch (err) {
      setRecurrenceError(err instanceof Error ? err.message : 'Failed to stop recurrence');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleAddDependency = async () => {
    if (!selectedPrereqId) return;
    setDepError(null);
    try {
      setIsActionPending(true);
      const res = await addTaskDependencyAction(
        workspaceId,
        currentTask.id,
        selectedPrereqId
      );
      if (res.error) {
        setDepError(res.error);
      } else {
        setSelectedPrereqId('');
        onTaskUpdated?.();
      }
    } finally {
      setIsActionPending(false);
    }
  };

  const handleRemoveDependency = async (depId: string) => {
    try {
      setIsActionPending(true);
      await removeTaskDependencyAction(workspaceId, depId);
      onTaskUpdated?.();
    } finally {
      setIsActionPending(false);
    }
  };

  const priorityBadgeClass = (priority: TaskDetail['priority']) => {
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

  const inputBaseClass =
    'w-full px-3 py-1.5 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] hover:border-[var(--border-strong)] transition-colors font-mono';

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/45 dark:bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="surface-card bg-[var(--bg-surface-elevated)] max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden text-[var(--text-primary)] shadow-[var(--shadow-elevated)]"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 sm:px-6 py-4 shrink-0 min-w-0">
            <div className="space-y-1.5 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={clsx(
                    'px-2.5 py-0.5 rounded-full text-[11px] font-medium capitalize',
                    priorityBadgeClass(currentTask.priority)
                  )}
                >
                  {currentTask.priority}
                </span>

                <span
                  className={clsx(
                    'px-2.5 py-0.5 rounded-full text-[11px] font-medium border',
                    currentTask.entry_type === 'calendar_block'
                      ? 'badge-editorial'
                      : 'bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
                  )}
                >
                  {currentTask.entry_type === 'calendar_block' ? 'Calendar Block' : 'Task'}
                </span>

                {currentTask.project && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] border border-[var(--border-subtle)] max-w-[200px]">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: currentTask.project.color || '#575651' }}
                    />
                    <span className="truncate">{currentTask.project.name}</span>
                  </span>
                )}

                {currentTask.recurrence_rule_id && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium badge-editorial border">
                    <Clock className="w-3 h-3" aria-hidden="true" />
                    <span>
                      {isVirtual
                        ? `Planned Occurrence #${currentTask.occurrence_index ?? 'Future'}`
                        : 'Recurring Series'}
                    </span>
                  </span>
                )}

                {isEditingTask && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--status-info-bg)] text-[var(--status-info-text)] border border-[var(--border-subtle)]">
                    {currentTask.recurrence_rule_id
                      ? 'Scope: This occurrence only'
                      : 'Edit Task'}
                  </span>
                )}
              </div>

              {!isEditingTask ? (
                <h2
                  id={titleId}
                  className="heading-section text-lg sm:text-xl break-words min-w-0"
                >
                  {currentTask.title}
                </h2>
              ) : (
                <div className="text-xs text-[var(--text-muted)] font-mono">
                  Modify attributes for this individual occurrence.
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {!isVirtual && !isEditingTask && (
                <button
                  type="button"
                  onClick={() => setIsEditingTask(true)}
                  aria-label="Edit task properties"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] transition-colors"
                  title="Edit occurrence properties"
                >
                  <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                aria-label="Close task details"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] transition-colors"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Status Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/45 px-5 sm:px-6 py-3 shrink-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-[var(--text-muted)] mr-1">
                Status:
              </span>
              {isVirtual ? (
                <span className="px-3 py-1 text-xs rounded-full font-semibold bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)] shadow-2xs">
                  Planned Future Occurrence (Read-Only Preview)
                </span>
              ) : (
                (['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as TaskStatus[]).map(
                  (st) => {
                    const isCurrent = currentTask.status === st;
                    return (
                      <button
                        key={st}
                        type="button"
                        disabled={isActionPending}
                        onClick={() => handleStatusChange(st)}
                        className={clsx(
                          'px-3 py-1 text-xs rounded-full font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
                          isCurrent
                            ? 'bg-[var(--text-primary)] text-[var(--bg-canvas)] font-semibold shadow-2xs'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
                        )}
                      >
                        {st === 'in_progress'
                          ? 'In Progress'
                          : st.charAt(0).toUpperCase() + st.slice(1)}
                      </button>
                    );
                  }
                )
              )}
            </div>

            {isActionPending && (
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] font-medium shrink-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                <span>Saving...</span>
              </div>
            )}
          </div>

          {/* Scrollable Editorial Body */}
          <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-6 min-w-0">
            {/* Virtual Projection Notice */}
            {isVirtual && (
              <div className="p-3.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/60 text-xs text-[var(--text-secondary)] space-y-1">
                <div className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
                  <Clock className="w-4 h-4 text-[var(--text-muted)] shrink-0" aria-hidden="true" />
                  <span>Projected Recurring Occurrence</span>
                </div>
                <p>
                  This occurrence is projected virtually from your recurring schedule. It will be generated automatically in the database when preceding occurrences are completed.
                </p>
              </div>
            )}

            {/* Blocked State Indicator */}
            {currentTask.is_blocked && (
              <div className="p-4 rounded-2xl border badge-danger text-xs space-y-1.5">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>
                    {currentTask.blocking_tasks && currentTask.blocking_tasks.length > 0
                      ? 'Task Blocked by Unfinished Dependencies'
                      : 'Task is currently Blocked'}
                  </span>
                </div>
                {currentTask.blocking_tasks && currentTask.blocking_tasks.length > 0 && (
                  <>
                    <p className="opacity-90">
                      The following prerequisite tasks must be completed before this task can proceed:
                    </p>
                    <ul className="list-disc list-inside space-y-0.5 text-[11px] font-mono">
                      {currentTask.blocking_tasks.map((bt) => (
                        <li key={bt.id} className="break-words">
                          {bt.title} ({bt.status})
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {/* Errors */}
            {(statusError || recurrenceError) && (
              <div className="p-3.5 rounded-2xl border badge-danger text-xs flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="break-words">{statusError || recurrenceError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setStatusError(null);
                    setRecurrenceError(null);
                  }}
                  className="p-1 rounded-full hover:opacity-80 shrink-0"
                  title="Dismiss error"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* EDIT TASK FORM (This Occurrence Only) */}
            {isEditingTask ? (
              <form onSubmit={handleSaveTaskEdit} className="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/40 space-y-4">
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2.5">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    {currentTask.recurrence_rule_id
                      ? 'Edit Occurrence Details (This Task Only)'
                      : 'Edit Task Details'}
                  </span>
                  <span className="text-[11px] font-mono text-[var(--text-muted)]">
                    {userTimeZone}
                  </span>
                </div>

                <div className="space-y-1">
                  <label htmlFor="edit-task-title" className="block text-[11px] font-medium text-[var(--text-secondary)]">
                    Title <span className="text-[var(--status-danger-text)]">*</span>
                  </label>
                  <input
                    id="edit-task-title"
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className={inputBaseClass}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="edit-task-desc" className="block text-[11px] font-medium text-[var(--text-secondary)]">
                    Description
                  </label>
                  <textarea
                    id="edit-task-desc"
                    rows={3}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className={inputBaseClass}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="edit-task-entry-type" className="block text-[11px] font-medium text-[var(--text-secondary)]">
                      Entry Type
                    </label>
                    <select
                      id="edit-task-entry-type"
                      value={editEntryType}
                      onChange={(e) => setEditEntryType(e.target.value as 'task' | 'calendar_block')}
                      className="w-full h-8 px-3 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
                    >
                      <option value="task">Actionable Task</option>
                      <option value="calendar_block">Calendar Block</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="edit-task-priority" className="block text-[11px] font-medium text-[var(--text-secondary)]">
                      Priority
                    </label>
                    <select
                      id="edit-task-priority"
                      value={editPriority}
                      onChange={(e) => setEditPriority(e.target.value as TaskPriority)}
                      className="w-full h-8 px-3 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="edit-task-duration" className="block text-[11px] font-medium text-[var(--text-secondary)]">
                      Duration (Minutes)
                    </label>
                    <input
                      id="edit-task-duration"
                      type="number"
                      min="1"
                      step="5"
                      value={editDuration}
                      onChange={(e) =>
                        setEditDuration(e.target.value ? parseInt(e.target.value, 10) : '')
                      }
                      className={inputBaseClass}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="edit-scheduled-start" className="block text-[11px] font-medium text-[var(--text-secondary)]">
                      Scheduled Start
                    </label>
                    <input
                      id="edit-scheduled-start"
                      type={currentTask.is_all_day ? 'date' : 'datetime-local'}
                      value={editScheduledStart}
                      onChange={(e) => setEditScheduledStart(e.target.value)}
                      className={inputBaseClass}
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="edit-due-date" className="block text-[11px] font-medium text-[var(--text-secondary)]">
                      Due Date / Deadline
                    </label>
                    <input
                      id="edit-due-date"
                      type={currentTask.is_all_day ? 'date' : 'datetime-local'}
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      className={inputBaseClass}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
                  <button
                    type="button"
                    onClick={() => setIsEditingTask(false)}
                    className="btn-secondary px-3 py-1.5 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isActionPending}
                    className="btn-accent px-4 py-1.5 text-xs disabled:opacity-50"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            ) : (
              <>
                {/* Description View */}
                {currentTask.description && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                      Description
                    </span>
                    <div className="text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words leading-relaxed">
                      {currentTask.description}
                    </div>
                  </div>
                )}

                {/* Scheduling Metadata Ledger */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-y border-[var(--border-subtle)] py-4 text-xs">
                  <div className="space-y-1 min-w-0">
                    <span className="text-[var(--text-muted)] block">Scheduled Start</span>
                    <p className="font-mono text-[var(--text-primary)] truncate">
                      {currentTask.scheduled_start
                        ? new Date(currentTask.scheduled_start).toLocaleString('en-US', {
                            timeZone: userTimeZone,
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Not scheduled'}
                    </p>
                  </div>

                  <div className="space-y-1 min-w-0">
                    <span className="text-[var(--text-muted)] block">Deadline / Due</span>
                    <p className="font-mono font-medium text-[var(--text-primary)] truncate">
                      {currentTask.due_date
                        ? new Date(currentTask.due_date).toLocaleString('en-US', {
                            timeZone: userTimeZone,
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'No deadline'}
                    </p>
                  </div>

                  <div className="space-y-1 min-w-0">
                    <span className="text-[var(--text-muted)] block">Estimated Duration</span>
                    <p className="font-mono text-[var(--text-primary)] truncate">
                      {currentTask.estimated_duration_minutes
                        ? `${currentTask.estimated_duration_minutes} mins`
                        : 'Unspecified'}
                    </p>
                  </div>
                </div>
              </>
            )}

            {/* RECURRENCE SCHEDULE SECTION */}
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/50 p-4 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
                <div className="flex items-center gap-2">
                  <Repeat className="w-4 h-4 text-[var(--text-secondary)]" aria-hidden="true" />
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    Recurring Series Schedule
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                  Scope: Entire Series
                </span>
              </div>

              {currentTask.recurrence_rule_id ? (
                <>
                  {!isEditingRecurrence ? (
                    <div className="space-y-3">
                      <div className="text-xs leading-relaxed text-[var(--text-primary)]">
                        {currentTask.recurrence_rule
                          ? formatRecurrenceSummary(currentTask.recurrence_rule)
                          : 'Repeats periodically on schedule.'}
                      </div>

                      <div className="text-[11px] font-mono text-[var(--text-muted)]">
                        Schedule Timezone: {currentTask.recurrence_rule?.timezone || userTimeZone}
                      </div>

                      {/* Series Action Controls */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={isActionPending}
                          onClick={() => setIsEditingRecurrence(true)}
                          className="btn-secondary px-3 py-1.5 text-xs"
                        >
                          Edit Series Schedule
                        </button>

                        <button
                          type="button"
                          disabled={isActionPending}
                          onClick={() => setIsStopConfirmOpen(true)}
                          className="px-3 py-1.5 text-xs rounded-full font-medium text-[var(--status-danger-text)] hover:bg-[var(--status-danger-bg)] transition-colors"
                        >
                          Stop Recurrence
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* EDIT RECURRENCE RULE FORM */
                    <form onSubmit={handleSaveRecurrenceEdit} className="space-y-4 pt-1">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                            Frequency
                          </label>
                          <select
                            value={ruleFreq}
                            onChange={(e) =>
                              setRuleFreq(e.target.value as 'daily' | 'weekly' | 'monthly' | 'yearly')
                            }
                            className="w-full h-8 px-3 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
                          >
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                            <option value="yearly">Yearly</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                            Interval (Every N {ruleFreq === 'daily' ? 'days' : ruleFreq === 'weekly' ? 'weeks' : ruleFreq === 'monthly' ? 'months' : 'years'})
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={ruleInterval}
                            onChange={(e) => setRuleInterval(Math.max(1, parseInt(e.target.value, 10) || 1))}
                            className={inputBaseClass}
                          />
                        </div>
                      </div>

                      {ruleFreq === 'weekly' && (
                        <div className="space-y-1.5 pt-1 border-t border-[var(--border-subtle)]">
                          <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                            Repeat on Weekdays <span className="text-[var(--status-danger-text)]">*</span>
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              { day: 1, label: 'Mon' },
                              { day: 2, label: 'Tue' },
                              { day: 3, label: 'Wed' },
                              { day: 4, label: 'Thu' },
                              { day: 5, label: 'Fri' },
                              { day: 6, label: 'Sat' },
                              { day: 7, label: 'Sun' },
                            ].map(({ day, label }) => {
                              const isSelected = ruleWeekdays.includes(day);
                              return (
                                <button
                                  key={day}
                                  type="button"
                                  onClick={() => {
                                    setRuleWeekdays((prev) =>
                                      isSelected
                                        ? prev.filter((d) => d !== day)
                                        : [...prev, day].sort((a, b) => a - b)
                                    );
                                  }}
                                  className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                                    isSelected
                                      ? 'bg-[var(--text-primary)] text-[var(--bg-canvas)] shadow-2xs font-semibold'
                                      : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)]'
                                  }`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {ruleFreq === 'monthly' && (
                        <div className="space-y-1 pt-1 border-t border-[var(--border-subtle)]">
                          <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                            Day of Month (1 - 31)
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="31"
                            value={ruleMonthday}
                            onChange={(e) =>
                              setRuleMonthday(Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)))
                            }
                            className="w-24 h-8 px-3 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-mono"
                          />
                        </div>
                      )}

                      {/* Termination controls */}
                      <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
                        <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                          Termination Condition
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <label className="flex items-center gap-2 p-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] cursor-pointer text-xs">
                            <input
                              type="radio"
                              name="detail_recurrence_end"
                              checked={ruleEndType === 'never'}
                              onChange={() => setRuleEndType('never')}
                              className="accent-[var(--text-primary)]"
                            />
                            <span>Never ends</span>
                          </label>

                          <label className="flex items-center gap-2 p-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] cursor-pointer text-xs">
                            <input
                              type="radio"
                              name="detail_recurrence_end"
                              checked={ruleEndType === 'until_date'}
                              onChange={() => setRuleEndType('until_date')}
                              className="accent-[var(--text-primary)]"
                            />
                            <span>On Date</span>
                          </label>

                          <label className="flex items-center gap-2 p-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] cursor-pointer text-xs">
                            <input
                              type="radio"
                              name="detail_recurrence_end"
                              checked={ruleEndType === 'count'}
                              onChange={() => setRuleEndType('count')}
                              className="accent-[var(--text-primary)]"
                            />
                            <span>After Occurrences</span>
                          </label>
                        </div>

                        {ruleEndType === 'until_date' && (
                          <div className="space-y-1 pt-1">
                            <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                              End Date <span className="text-[var(--status-danger-text)]">*</span>
                            </label>
                            <input
                              type="date"
                              required
                              value={ruleUntilDate}
                              onChange={(e) => setRuleUntilDate(e.target.value)}
                              className="w-full sm:w-60 h-8 px-3 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-mono"
                            />
                          </div>
                        )}

                        {ruleEndType === 'count' && (
                          <div className="space-y-1 pt-1">
                            <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                              Total Occurrences <span className="text-[var(--status-danger-text)]">*</span>
                            </label>
                            <input
                              type="number"
                              min={currentTask.recurrence_rule?.total_occurrences_generated || 1}
                              required
                              value={ruleCount}
                              onChange={(e) => setRuleCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                              className="w-32 h-8 px-3 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-mono"
                            />
                            {currentTask.recurrence_rule?.total_occurrences_generated && (
                              <p className="text-[11px] text-[var(--text-muted)] font-mono">
                                {currentTask.recurrence_rule.total_occurrences_generated} occurrences already consumed. Count cannot be lower.
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
                        <button
                          type="button"
                          onClick={() => setIsEditingRecurrence(false)}
                          className="btn-secondary px-3 py-1.5 text-xs"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={isActionPending}
                          className="btn-accent px-4 py-1.5 text-xs disabled:opacity-50"
                        >
                          Save Series Schedule
                        </button>
                      </div>
                    </form>
                  )}
                </>
              ) : (
                /* One-Time Task (Option to make recurring) */
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-[var(--text-secondary)]">
                    This is currently a one-time task.
                  </span>
                  {!isVirtual && (
                    <button
                      type="button"
                      disabled={isActionPending}
                      onClick={() => setIsEditingRecurrence(true)}
                      className="btn-secondary px-3 py-1.5 text-xs"
                    >
                      Make Recurring
                    </button>
                  )}
                </div>
              )}

              {/* Stop Recurrence Confirmation Dialog */}
              {isStopConfirmOpen && (
                <div className="p-3.5 rounded-2xl border badge-danger text-xs space-y-2.5 animate-in fade-in duration-150">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Stop Recurring Series?</span>
                  </div>
                  <p className="leading-relaxed opacity-95">
                    Future occurrences will no longer be generated or projected on your calendar. All existing completed tasks and this occurrence will be preserved safely in your history.
                  </p>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsStopConfirmOpen(false)}
                      className="btn-secondary px-3 py-1 text-xs"
                    >
                      Keep Recurring
                    </button>
                    <button
                      type="button"
                      disabled={isActionPending}
                      onClick={handleStopRecurrence}
                      className="btn-accent px-4 py-1 text-xs"
                    >
                      Confirm Stop
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Subtasks Section */}
            <div className="space-y-3 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-[var(--text-primary)] tracking-tight">
                  Subtasks ({currentTask.completed_subtask_count}/{currentTask.subtask_count})
                </h3>
                {!isVirtual && (
                  <button
                    type="button"
                    onClick={() => setIsSubtaskModalOpen(true)}
                    className="btn-secondary px-3 py-1 text-xs"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Add Subtask</span>
                  </button>
                )}
              </div>

              {currentTask.subtasks.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] py-1">
                  No subtasks defined yet.
                </p>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
                  {currentTask.subtasks.map((st) => (
                    <div
                      key={st.id}
                      className="flex items-start sm:items-center justify-between gap-3 py-2.5 text-xs min-w-0"
                    >
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <button
                          type="button"
                          disabled={isActionPending || isVirtual}
                          onClick={(e) => !isVirtual && handleToggleSubtask(st.id, e)}
                          className="mt-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0 disabled:opacity-50"
                          title={
                            isVirtual
                              ? 'Projected template subtask (read-only)'
                              : st.status === 'done'
                                ? 'Mark incomplete'
                                : 'Mark completed'
                          }
                        >
                          {st.status === 'done' ? (
                            <CheckCircle2
                              className="w-3.5 h-3.5 text-[var(--status-success-text)]"
                              aria-hidden="true"
                            />
                          ) : (
                            <Circle className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={isVirtual}
                          onClick={() => !isVirtual && onOpenTask?.(st)}
                          className={clsx(
                            'text-left min-w-0 flex-1',
                            !isVirtual && 'hover:underline'
                          )}
                          title={isVirtual ? undefined : 'View subtask details'}
                        >
                          <span
                            className={clsx(
                              'line-clamp-2 break-words',
                              st.status === 'done'
                                ? 'line-through text-[var(--text-muted)]'
                                : 'text-[var(--text-primary)] font-medium'
                            )}
                          >
                            {st.title}
                          </span>
                        </button>
                      </div>
                      <span className="text-[10.5px] text-[var(--text-muted)] font-mono capitalize shrink-0 whitespace-nowrap">
                        {st.status.replace('_', ' ')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Dependencies Section */}
            <div className="space-y-3 min-w-0">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-[var(--text-primary)] tracking-tight inline-flex items-center gap-1.5">
                  <LinkIcon
                    className="w-3.5 h-3.5 text-[var(--text-muted)]"
                    aria-hidden="true"
                  />
                  <span>Dependencies ({currentTask.dependencies.length})</span>
                </h3>
              </div>

              {depError && (
                <div className="p-3 rounded-xl border badge-danger text-xs break-words">
                  {depError}
                </div>
              )}

              {currentTask.dependencies.length > 0 && (
                <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
                  {currentTask.dependencies.map((dep) => (
                    <div
                      key={dep.id}
                      className="flex items-start sm:items-center justify-between gap-3 py-2.5 text-xs min-w-0"
                    >
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        {dep.prerequisite_task.status === 'done' ? (
                          <CheckCircle2
                            className="w-4 h-4 text-[var(--status-success-text)] shrink-0 mt-0.5"
                            aria-hidden="true"
                          />
                        ) : (
                          <AlertTriangle
                            className="w-4 h-4 text-[var(--status-warning-text)] shrink-0 mt-0.5"
                            aria-hidden="true"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="text-[var(--text-primary)] font-medium break-words">
                            {dep.prerequisite_task.title}
                          </span>
                          <span className="text-[11px] text-[var(--text-muted)] block sm:inline sm:ml-2 font-mono">
                            (Requires: done · Current: {dep.prerequisite_task.status})
                          </span>
                        </div>
                      </div>
                      {!isVirtual && (
                        <button
                          type="button"
                          disabled={isActionPending}
                          onClick={() => handleRemoveDependency(dep.id)}
                          className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--status-danger-text)] hover:bg-[var(--status-danger-bg)] transition-colors shrink-0"
                          title="Remove dependency"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add Dependency Input */}
              {!isVirtual && candidatePrereqs.length > 0 && (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1 min-w-0">
                  <select
                    aria-label="Select prerequisite task"
                    value={selectedPrereqId}
                    onChange={(e) => setSelectedPrereqId(e.target.value)}
                    className="flex-1 min-w-0 h-9 px-3 text-xs rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors"
                  >
                    <option value="">Select prerequisite task...</option>
                    {candidatePrereqs.map((cp) => (
                      <option key={cp.id} value={cp.id}>
                        {cp.title} ({cp.status})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!selectedPrereqId || isActionPending}
                    onClick={handleAddDependency}
                    className="btn-secondary px-4 py-2 text-xs whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    Add Requirement
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Sticky Footer Actions */}
          <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] px-5 sm:px-6 py-3.5 shrink-0">
            {!isVirtual ? (
              <button
                type="button"
                disabled={isActionPending}
                onClick={handleDelete}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[var(--status-danger-text)] hover:bg-[var(--status-danger-bg)] rounded-full transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Delete Task</span>
              </button>
            ) : (
              <span className="text-[11px] text-[var(--text-muted)] font-mono">
                Read-only series projection
              </span>
            )}

            <button
              type="button"
              onClick={onClose}
              className="btn-secondary px-5 py-2 text-xs"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Subtask Creation Modal */}
      {isSubtaskModalOpen && (
        <CreateTaskModal
          workspaceId={workspaceId}
          projects={currentTask.project ? [currentTask.project] : []}
          parentTaskId={currentTask.id}
          isOpen={isSubtaskModalOpen}
          onClose={() => {
            setIsSubtaskModalOpen(false);
          }}
          onTaskCreated={(createdSubtask) => {
            handleSubtaskCreated(createdSubtask);
          }}
        />
      )}
    </>
  );
}
