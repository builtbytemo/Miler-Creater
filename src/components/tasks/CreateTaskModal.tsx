'use client';

import { useState, useEffect } from 'react';
import { X, Calendar, Clock, AlertCircle } from 'lucide-react';
import { createTaskAction } from '@/lib/actions/task-actions';
import type { TaskWithMeta } from '@/lib/services/task-service';
import { toLocalDatetimeString, parseLocalDatetimeString } from '@/lib/temporal/calendar';
import { DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';

interface ProjectOption {
  id: string;
  name: string;
  color: string | null;
}

interface CreateTaskModalProps {
  workspaceId: string;
  projects: ProjectOption[];
  parentTaskId?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onTaskCreated?: (task: TaskWithMeta) => void;
  initialScheduledStart?: string | null;
  initialScheduledEnd?: string | null;
  userTimeZone?: string;
}

export function CreateTaskModal({
  workspaceId,
  projects,
  parentTaskId,
  isOpen,
  onClose,
  onTaskCreated,
  initialScheduledStart = null,
  initialScheduledEnd = null,
  userTimeZone = DEFAULT_TIMEZONE,
}: CreateTaskModalProps) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAllDay, setIsAllDay] = useState(false);
  const [recurrenceFreq, setRecurrenceFreq] = useState('none');

  // Explicit scheduling state
  const [isScheduled, setIsScheduled] = useState<boolean>(Boolean(initialScheduledStart));
  const [scheduledStart, setScheduledStart] = useState<string>(
    initialScheduledStart ? toLocalDatetimeString(initialScheduledStart, userTimeZone) : ''
  );
  const [scheduledEnd, setScheduledEnd] = useState<string>(
    initialScheduledEnd ? toLocalDatetimeString(initialScheduledEnd, userTimeZone) : ''
  );

  // Sync state whenever modal opens or props change
  useEffect(() => {
    if (isOpen) {
      setIsScheduled(Boolean(initialScheduledStart));
      setScheduledStart(
        initialScheduledStart ? toLocalDatetimeString(initialScheduledStart, userTimeZone) : ''
      );
      setScheduledEnd(
        initialScheduledEnd ? toLocalDatetimeString(initialScheduledEnd, userTimeZone) : ''
      );
      setIsAllDay(false);
      setRecurrenceFreq('none');
      setError(null);
    }
  }, [isOpen, initialScheduledStart, initialScheduledEnd, userTimeZone]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isPending) return;

    const form = e.currentTarget;
    const formData = new FormData(form);

    const title = (formData.get('title') as string || '').trim();
    if (!title) {
      setError('Task title is required');
      return;
    }

    // Validate scheduling choice
    if (isScheduled) {
      if (!scheduledStart.trim()) {
        setError('Please specify a scheduled start date & time, or uncheck "Schedule on Calendar" to leave unscheduled.');
        return;
      }

      // Convert to UTC ISO using user's timezone to prevent timezone drift
      const parsedStart = parseLocalDatetimeString(scheduledStart.trim(), userTimeZone);
      if (parsedStart) {
        formData.set('scheduled_start', parsedStart.toISOString());
      } else {
        formData.set('scheduled_start', scheduledStart.trim());
      }

      if (scheduledEnd.trim()) {
        const parsedEnd = parseLocalDatetimeString(scheduledEnd.trim(), userTimeZone);
        if (parsedEnd) {
          formData.set('scheduled_end', parsedEnd.toISOString());
        } else {
          formData.set('scheduled_end', scheduledEnd.trim());
        }
      } else {
        formData.delete('scheduled_end');
      }
    } else {
      // Explicitly unscheduled
      formData.delete('scheduled_start');
      formData.delete('scheduled_end');
    }

    try {
      setIsPending(true);
      setError(null);

      const res = await createTaskAction(null, formData);

      if (res?.error) {
        setError(res.error);
        return;
      }

      if (res?.success && res.data) {
        onTaskCreated?.(res.data as TaskWithMeta);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-xl w-full p-6 text-neutral-100 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">
              {parentTaskId ? 'Add Subtask' : 'Create New Task'}
            </h2>
            <p className="text-xs text-neutral-400">
              {parentTaskId ? 'Attach a child deliverable' : 'Define actionable work with scheduling & dependencies'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-950/40 border border-red-800 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="workspace_id" value={workspaceId} />
          {parentTaskId && <input type="hidden" name="parent_task_id" value={parentTaskId} />}

          {/* Title */}
          <div>
            <label htmlFor="task-title" className="block text-xs font-medium text-neutral-300 mb-1">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              id="task-title"
              name="title"
              type="text"
              required
              placeholder="e.g. Draft Q4 architecture proposal"
              className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-700 bg-neutral-800 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="task-desc" className="block text-xs font-medium text-neutral-300 mb-1">
              Description / Notes
            </label>
            <textarea
              id="task-desc"
              name="description"
              rows={3}
              placeholder="Details, acceptance criteria, or links..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-700 bg-neutral-800 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Priority & Status Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="task-priority" className="block text-xs font-medium text-neutral-300 mb-1">
                Priority
              </label>
              <select
                id="task-priority"
                name="priority"
                defaultValue="medium"
                className="w-full px-3 py-2 text-xs rounded-lg border border-neutral-700 bg-neutral-800 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <div>
              <label htmlFor="task-status" className="block text-xs font-medium text-neutral-300 mb-1">
                Initial Status
              </label>
              <select
                id="task-status"
                name="status"
                defaultValue="todo"
                className="w-full px-3 py-2 text-xs rounded-lg border border-neutral-700 bg-neutral-800 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
          </div>

          {/* Project Association */}
          {projects.length > 0 && (
            <div>
              <label htmlFor="task-project" className="block text-xs font-medium text-neutral-300 mb-1">
                Project
              </label>
              <select
                id="task-project"
                name="project_id"
                defaultValue=""
                className="w-full px-3 py-2 text-xs rounded-lg border border-neutral-700 bg-neutral-800 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">No Project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Timing & Dates Section */}
          <div className="p-3.5 rounded-lg bg-neutral-950 border border-neutral-800 space-y-3">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-neutral-200">
                <input
                  type="checkbox"
                  checked={isScheduled}
                  onChange={(e) => setIsScheduled(e.target.checked)}
                  className="rounded border-neutral-700 bg-neutral-800 text-emerald-500 focus:ring-emerald-500"
                />
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                  Schedule on Calendar
                </span>
              </label>

              {isScheduled && (
                <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-400">
                  <input
                    type="checkbox"
                    name="is_all_day"
                    value="true"
                    checked={isAllDay}
                    onChange={(e) => setIsAllDay(e.target.checked)}
                    className="rounded border-neutral-700 bg-neutral-800 text-blue-500 focus:ring-blue-500"
                  />
                  <span>All Day Task</span>
                </label>
              )}
            </div>

            {isScheduled ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label htmlFor="scheduled-start" className="block text-[11px] text-neutral-400 mb-1">
                    Scheduled Start <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="scheduled-start"
                    name="scheduled_start"
                    type={isAllDay ? 'date' : 'datetime-local'}
                    value={scheduledStart}
                    onChange={(e) => setScheduledStart(e.target.value)}
                    required={isScheduled}
                    className="w-full px-2.5 py-1.5 text-xs rounded-md border border-neutral-700 bg-neutral-800 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </div>

                <div>
                  <label htmlFor="scheduled-end" className="block text-[11px] text-neutral-400 mb-1">
                    Scheduled End <span className="text-neutral-500">(Optional)</span>
                  </label>
                  <input
                    id="scheduled-end"
                    name="scheduled_end"
                    type={isAllDay ? 'date' : 'datetime-local'}
                    value={scheduledEnd}
                    onChange={(e) => setScheduledEnd(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-md border border-neutral-700 bg-neutral-800 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-neutral-500">
                Task will be saved to your backlog unscheduled. You can set an optional deadline or duration below.
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-neutral-800/80">
              <div>
                <label htmlFor="due-date" className="block text-[11px] text-neutral-400 mb-1">
                  Due Date / Deadline <span className="text-neutral-500">(Optional)</span>
                </label>
                <input
                  id="due-date"
                  name="due_date"
                  type={isAllDay ? 'date' : 'datetime-local'}
                  className="w-full px-2.5 py-1.5 text-xs rounded-md border border-neutral-700 bg-neutral-800 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="duration-min" className="block text-[11px] text-neutral-400 mb-1">
                  Estimated Duration (Minutes)
                </label>
                <input
                  id="duration-min"
                  name="estimated_duration_minutes"
                  type="number"
                  min="5"
                  step="5"
                  placeholder="e.g. 60"
                  className="w-full px-2.5 py-1.5 text-xs rounded-md border border-neutral-700 bg-neutral-800 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Recurrence Rule Section (top-level tasks only) */}
          {!parentTaskId && (
            <div className="p-3.5 rounded-lg bg-neutral-950 border border-neutral-800 space-y-3">
              <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-purple-400" />
                Recurrence Rule
              </span>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="recurrence-freq" className="block text-[11px] text-neutral-400 mb-1">
                    Frequency
                  </label>
                  <select
                    id="recurrence-freq"
                    name="recurrence_frequency"
                    value={recurrenceFreq}
                    onChange={(e) => setRecurrenceFreq(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-md border border-neutral-700 bg-neutral-800 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="none">One-time Task</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>

                {recurrenceFreq !== 'none' && (
                  <div>
                    <label htmlFor="recurrence-interval" className="block text-[11px] text-neutral-400 mb-1">
                      Interval (Every N {recurrenceFreq === 'daily' ? 'days' : recurrenceFreq === 'weekly' ? 'weeks' : 'months'})
                    </label>
                    <input
                      id="recurrence-interval"
                      name="recurrence_interval"
                      type="number"
                      min="1"
                      defaultValue="1"
                      className="w-full px-2.5 py-1.5 text-xs rounded-md border border-neutral-700 bg-neutral-800 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-neutral-300 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 shadow-sm"
            >
              {isPending ? 'Saving Task...' : 'Save Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
