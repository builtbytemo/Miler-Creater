'use client';

import { useState } from 'react';
import {
  X,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plus,
  Trash2,
  Link as LinkIcon,
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
} from '@/lib/actions/task-actions';
import { CreateTaskModal } from './CreateTaskModal';

interface TaskDetailModalProps {
  task: TaskDetail;
  allTasks: TaskWithMeta[];
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
  onTaskUpdated?: () => void;
}

export function TaskDetailModal({
  task,
  allTasks,
  workspaceId,
  isOpen,
  onClose,
  onTaskUpdated,
}: TaskDetailModalProps) {
  const [isSubtaskModalOpen, setIsSubtaskModalOpen] = useState(false);
  const [selectedPrereqId, setSelectedPrereqId] = useState('');
  const [depError, setDepError] = useState<string | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);

  if (!isOpen) return null;

  // Potential prerequisites: tasks in this workspace other than itself and its existing dependencies
  const existingDepIds = new Set(task.dependencies.map((d) => d.depends_on_task_id));
  const candidatePrereqs = allTasks.filter(
    (t) => t.id !== task.id && !existingDepIds.has(t.id) && t.parent_task_id !== task.id
  );

  const handleStatusChange = async (newStatus: TaskStatus) => {
    try {
      setIsActionPending(true);
      if (newStatus === 'done') {
        await completeTaskAction(workspaceId, task.id);
      } else if (newStatus === 'cancelled') {
        await cancelTaskAction(workspaceId, task.id);
      } else {
        const formData = new FormData();
        formData.set('workspace_id', workspaceId);
        formData.set('task_id', task.id);
        formData.set('status', newStatus);
        await updateTaskAction(null, formData);
      }
      onTaskUpdated?.();
      onClose();
    } finally {
      setIsActionPending(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete task "${task.title}"?`)) return;
    try {
      setIsActionPending(true);
      await deleteTaskAction(workspaceId, task.id);
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
      const res = await addTaskDependencyAction(workspaceId, task.id, selectedPrereqId);
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
                    task.priority === 'urgent'
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                      : task.priority === 'high'
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      : task.priority === 'medium'
                      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                  }`}
                >
                  {task.priority}
                </span>

                {task.project && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-neutral-800 text-neutral-300 border border-neutral-700">
                    {task.project.name}
                  </span>
                )}

                {task.recurrence_rule_id && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    <Clock className="w-3 h-3" />
                    Recurring
                  </span>
                )}
              </div>
              <h2 className="text-lg font-semibold text-neutral-100">{task.title}</h2>
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
          {task.is_blocked && task.blocking_tasks.length > 0 && (
            <div className="p-3.5 rounded-lg bg-red-950/40 border border-red-800 text-red-200 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-red-300">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span>Task Blocked by Unfinished Dependencies</span>
              </div>
              <p className="text-red-300/80">
                The following prerequisite tasks must be completed before this task can proceed:
              </p>
              <ul className="list-disc list-inside space-y-0.5 text-[11px] font-mono">
                {task.blocking_tasks.map((bt) => (
                  <li key={bt.id}>
                    {bt.title} ({bt.status})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Status Quick Bar */}
          <div className="flex items-center gap-2 p-3 rounded-lg bg-neutral-950 border border-neutral-800">
            <span className="text-xs text-neutral-400 mr-2 font-medium">Status:</span>
            {(['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as TaskStatus[]).map((st) => (
              <button
                key={st}
                type="button"
                disabled={isActionPending}
                onClick={() => handleStatusChange(st)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                  task.status === st
                    ? 'bg-neutral-100 text-neutral-950 font-semibold shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
                }`}
              >
                {st === 'in_progress' ? 'In Progress' : st.charAt(0).toUpperCase() + st.slice(1)}
              </button>
            ))}
          </div>

          {/* Description */}
          {task.description && (
            <div className="space-y-1 text-sm text-neutral-300 bg-neutral-950 p-4 rounded-lg border border-neutral-800 whitespace-pre-wrap leading-relaxed">
              {task.description}
            </div>
          )}

          {/* Scheduling Metadata */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 space-y-1">
              <span className="text-neutral-500 font-medium">Scheduled Start</span>
              <p className="text-neutral-200">
                {task.scheduled_start
                  ? new Date(task.scheduled_start).toLocaleString('en-US', {
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
                {task.due_date
                  ? new Date(task.due_date).toLocaleString('en-US', {
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
                {task.estimated_duration_minutes ? `${task.estimated_duration_minutes} mins` : 'Unspecified'}
              </p>
            </div>
          </div>

          {/* Subtasks Section */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
                Subtasks ({task.completed_subtask_count}/{task.subtask_count})
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

            {task.subtasks.length === 0 ? (
              <p className="text-xs text-neutral-500 py-2">No subtasks defined yet.</p>
            ) : (
              <div className="space-y-1.5">
                {task.subtasks.map((st) => (
                  <div
                    key={st.id}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-neutral-950 border border-neutral-800/80 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          st.status === 'done' ? 'bg-emerald-400' : 'bg-neutral-600'
                        }`}
                      />
                      <span className={st.status === 'done' ? 'line-through text-neutral-500' : 'text-neutral-200'}>
                        {st.title}
                      </span>
                    </div>
                    <span className="text-[10px] text-neutral-400 font-mono">{st.status}</span>
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
                Dependencies ({task.dependencies.length})
              </h3>
            </div>

            {depError && (
              <div className="p-2.5 rounded bg-red-950/40 border border-red-800 text-red-300 text-xs">
                {depError}
              </div>
            )}

            {task.dependencies.length > 0 && (
              <div className="space-y-1.5">
                {task.dependencies.map((dep) => (
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
          projects={task.project ? [task.project] : []}
          parentTaskId={task.id}
          isOpen={isSubtaskModalOpen}
          onClose={() => {
            setIsSubtaskModalOpen(false);
            onTaskUpdated?.();
          }}
        />
      )}
    </>
  );
}
