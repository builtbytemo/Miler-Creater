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
} from 'lucide-react';
import { clsx } from 'clsx';
import type { TaskDetail, TaskWithMeta } from '@/lib/services/task-service';
import type { TaskStatus } from '@/types/database';
import {
  completeTaskAction,
  cancelTaskAction,
  deleteTaskAction,
  updateTaskAction,
  addTaskDependencyAction,
  removeTaskDependencyAction,
  type TaskActionResult,
} from '@/lib/actions/task-actions';
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
}: TaskDetailModalProps) {
  const [currentTask, setCurrentTask] = useState<TaskDetail>(task);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isSubtaskModalOpen, setIsSubtaskModalOpen] = useState(false);
  const [selectedPrereqId, setSelectedPrereqId] = useState('');
  const [depError, setDepError] = useState<string | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);

  const [prevTaskProp, setPrevTaskProp] = useState<TaskDetail>(task);
  if (prevTaskProp !== task) {
    setPrevTaskProp(task);
    setCurrentTask(task);
    setStatusError(null);
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

      // Update local modal state immediately
      setCurrentTask((prev) => ({
        ...prev,
        status: newStatus,
        completed_at: newStatus === 'done' ? new Date().toISOString() : null,
        is_blocked:
          newStatus === 'blocked'
            ? true
            : Boolean(prev.blocking_tasks && prev.blocking_tasks.length > 0),
      }));

      // Notify parent workspace to update list state and refresh server data
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
          {/* Sticky Header */}
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
                        : 'Recurring'}
                    </span>
                  </span>
                )}
              </div>

              <h2
                id={titleId}
                className="heading-section text-lg sm:text-xl break-words min-w-0"
              >
                {currentTask.title}
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close task details"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* Status Strip — Directly Below Header Without Box Nesting */}
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

            {/* Status Update Error Banner */}
            {statusError && (
              <div className="p-3.5 rounded-2xl border badge-danger text-xs flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="break-words">{statusError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setStatusError(null)}
                  className="p-1 rounded-full hover:opacity-80 shrink-0"
                  title="Dismiss error"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Description — Open Typography Without Nested Box */}
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

            {/* Scheduling Metadata Ledger — Clean Hairline Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-y border-[var(--border-subtle)] py-4 text-xs">
              <div className="space-y-1 min-w-0">
                <span className="text-[var(--text-muted)] block">Scheduled Start</span>
                <p className="font-mono text-[var(--text-primary)] truncate">
                  {currentTask.scheduled_start
                    ? new Date(currentTask.scheduled_start).toLocaleString('en-US', {
                        timeZone: 'Africa/Cairo',
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
                        timeZone: 'Africa/Cairo',
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
