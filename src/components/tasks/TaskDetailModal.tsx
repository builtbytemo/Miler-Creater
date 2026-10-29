'use client';

import { useState, useEffect } from 'react';
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

  useEffect(() => {
    setCurrentTask(task);
    setStatusError(null);
  }, [task]);

  if (!isOpen) return null;

  // Potential prerequisites: tasks in this workspace other than itself and its existing dependencies
  const existingDepIds = new Set(currentTask.dependencies.map((d) => d.depends_on_task_id));
  const candidatePrereqs = allTasks.filter(
    (t) => t.id !== currentTask.id && !existingDepIds.has(t.id) && t.parent_task_id !== currentTask.id
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
      (currentTask.dependencies && currentTask.dependencies.some((d) => d.prerequisite_task?.status !== 'done'));

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
        is_blocked: newStatus === 'blocked' ? true : (prev.blocking_tasks && prev.blocking_tasks.length > 0),
      }));

      // Notify parent workspace to update list state and refresh server data
      onTaskUpdated?.(newStatus);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'An unexpected error occurred while updating status.');
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
      const res = await addTaskDependencyAction(workspaceId, currentTask.id, selectedPrereqId);
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

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-2xl w-full p-6 text-neutral-100 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-neutral-800 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase ${
                    currentTask.priority === 'urgent'
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                      : currentTask.priority === 'high'
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      : currentTask.priority === 'medium'
                      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                  }`}
                >
                  {currentTask.priority}
                </span>

                {currentTask.project && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-neutral-800 text-neutral-300 border border-neutral-700">
                    {currentTask.project.name}
                  </span>
                )}

                {currentTask.recurrence_rule_id && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    <Clock className="w-3 h-3" />
                    Recurring
                  </span>
                )}
              </div>
              <h2 className="text-lg font-semibold text-neutral-100">{currentTask.title}</h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Blocked State Indicator */}
          {currentTask.is_blocked && (
            <div className="p-3.5 rounded-lg bg-red-950/40 border border-red-800 text-red-200 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-red-300">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>
                  {currentTask.blocking_tasks && currentTask.blocking_tasks.length > 0
                    ? 'Task Blocked by Unfinished Dependencies'
                    : 'Task is currently Blocked'}
                </span>
              </div>
              {currentTask.blocking_tasks && currentTask.blocking_tasks.length > 0 && (
                <>
                  <p className="text-red-300/80">
                    The following prerequisite tasks must be completed before this task can proceed:
                  </p>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] font-mono">
                    {currentTask.blocking_tasks.map((bt) => (
                      <li key={bt.id}>
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
            <div className="p-3 rounded-lg bg-red-950/40 border border-red-800 text-red-200 text-xs flex items-center justify-between animate-in fade-in duration-150">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{statusError}</span>
              </div>
              <button
                type="button"
                onClick={() => setStatusError(null)}
                className="p-1 rounded text-red-400 hover:text-red-200 hover:bg-red-900/50 transition-colors"
                title="Dismiss error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Status Quick Bar */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-neutral-950 border border-neutral-800">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-neutral-400 mr-2 font-medium">Status:</span>
              {(['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as TaskStatus[]).map((st) => (
                <button
                  key={st}
                  type="button"
                  disabled={isActionPending}
                  onClick={() => handleStatusChange(st)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    currentTask.status === st
                      ? 'bg-neutral-100 text-neutral-950 font-semibold shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
                  }`}
                >
                  {st === 'in_progress' ? 'In Progress' : st.charAt(0).toUpperCase() + st.slice(1)}
                </button>
              ))}
            </div>

            {isActionPending && (
              <div className="flex items-center gap-1.5 text-xs text-blue-400 font-medium shrink-0 ml-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </div>
            )}
          </div>

          {/* Description */}
          {currentTask.description && (
            <div className="space-y-1 text-sm text-neutral-300 bg-neutral-950 p-4 rounded-lg border border-neutral-800 whitespace-pre-wrap leading-relaxed">
              {currentTask.description}
            </div>
          )}

          {/* Scheduling Metadata */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 space-y-1">
              <span className="text-neutral-500 font-medium">Scheduled Start</span>
              <p className="text-neutral-200">
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

            <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 space-y-1">
              <span className="text-neutral-500 font-medium">Deadline / Due</span>
              <p className="text-neutral-200 font-medium">
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

            <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 space-y-1">
              <span className="text-neutral-500 font-medium">Estimated Duration</span>
              <p className="text-neutral-200">
                {currentTask.estimated_duration_minutes ? `${currentTask.estimated_duration_minutes} mins` : 'Unspecified'}
              </p>
            </div>
          </div>

          {/* Subtasks Section */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
                Subtasks ({currentTask.completed_subtask_count}/{currentTask.subtask_count})
              </h3>
              <button
                type="button"
                onClick={() => setIsSubtaskModalOpen(true)}
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Subtask</span>
              </button>
            </div>

            {currentTask.subtasks.length === 0 ? (
              <p className="text-xs text-neutral-500 py-2">No subtasks defined yet.</p>
            ) : (
              <div className="space-y-1.5">
                {currentTask.subtasks.map((st) => (
                  <div
                    key={st.id}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-neutral-950 border border-neutral-800/80 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <button
                        type="button"
                        disabled={isActionPending}
                        onClick={(e) => handleToggleSubtask(st.id, e)}
                        className="text-neutral-500 hover:text-emerald-400 transition-colors shrink-0 disabled:opacity-50"
                        title={st.status === 'done' ? 'Mark incomplete' : 'Mark completed'}
                      >
                        {st.status === 'done' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Circle className="w-3.5 h-3.5 text-neutral-600 hover:text-emerald-400" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenTask?.(st)}
                        className="text-left truncate hover:underline"
                        title="View subtask details"
                      >
                        <span className={st.status === 'done' ? 'line-through text-neutral-500' : 'text-neutral-200'}>
                          {st.title}
                        </span>
                      </button>
                    </div>
                    <span className="text-[10px] text-neutral-400 font-mono capitalize ml-2 shrink-0">
                      {st.status.replace('_', ' ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Dependencies Section */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
                <LinkIcon className="w-3.5 h-3.5 text-neutral-400" />
                Dependencies ({currentTask.dependencies.length})
              </h3>
            </div>

            {depError && (
              <div className="p-2.5 rounded bg-red-950/40 border border-red-800 text-red-300 text-xs">
                {depError}
              </div>
            )}

            {currentTask.dependencies.length > 0 && (
              <div className="space-y-1.5">
                {currentTask.dependencies.map((dep) => (
                  <div
                    key={dep.id}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      {dep.prerequisite_task.status === 'done' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                      )}
                      <div>
                        <span className="text-neutral-200 font-medium">
                          {dep.prerequisite_task.title}
                        </span>
                        <span className="text-[10px] text-neutral-500 ml-2">
                          (Requires status: Done • Current: {dep.prerequisite_task.status})
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isActionPending}
                      onClick={() => handleRemoveDependency(dep.id)}
                      className="p-1 text-neutral-500 hover:text-red-400"
                      title="Remove dependency"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Dependency Input */}
            {candidatePrereqs.length > 0 && (
              <div className="flex items-center gap-2 pt-1">
                <select
                  value={selectedPrereqId}
                  onChange={(e) => setSelectedPrereqId(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-neutral-700 bg-neutral-800 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="px-3 py-1.5 text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  Add Requirement
                </button>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between border-t border-neutral-800 pt-4">
            <button
              type="button"
              disabled={isActionPending}
              onClick={handleDelete}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-950/30 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Task</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg transition-colors"
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
