'use client';

import { useState, useId } from 'react';
import { useDialog } from '@/lib/hooks/use-dialog';
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
  createdFrom?: 'tasks' | 'calendar';
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
  createdFrom = 'tasks',
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
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<number[]>([1]);
  const [recurrenceMonthday, setRecurrenceMonthday] = useState(1);
  const [recurrenceEndType, setRecurrenceEndType] = useState<'never' | 'until_date' | 'count'>('never');
  const [recurrenceUntilDate, setRecurrenceUntilDate] = useState('');
  const [recurrenceCount, setRecurrenceCount] = useState(10);

  // Explicit scheduling state
  const [isScheduled, setIsScheduled] = useState<boolean>(Boolean(initialScheduledStart));
  const [scheduledStart, setScheduledStart] = useState<string>(
    initialScheduledStart ? toLocalDatetimeString(initialScheduledStart, userTimeZone) : ''
  );
  const [scheduledEnd, setScheduledEnd] = useState<string>(
    initialScheduledEnd ? toLocalDatetimeString(initialScheduledEnd, userTimeZone) : ''
  );

  // Sync state whenever modal opens or scheduling props change
  const syncKey = `${isOpen}:${initialScheduledStart ?? ''}:${initialScheduledEnd ?? ''}:${userTimeZone}`;
  const [prevSyncKey, setPrevSyncKey] = useState(syncKey);
  if (prevSyncKey !== syncKey) {
    setPrevSyncKey(syncKey);
    if (isOpen) {
      setIsScheduled(Boolean(initialScheduledStart));
      const initStartStr = initialScheduledStart
        ? toLocalDatetimeString(initialScheduledStart, userTimeZone)
        : '';
      setScheduledStart(initStartStr);
      setScheduledEnd(
        initialScheduledEnd ? toLocalDatetimeString(initialScheduledEnd, userTimeZone) : ''
      );
      setIsAllDay(false);
      setRecurrenceFreq('none');
      setRecurrenceInterval(1);

      // Infer default weekday / monthday from start date if available
      if (initStartStr) {
        const d = new Date(initStartStr);
        if (!isNaN(d.getTime())) {
          const isoDay = d.getDay() === 0 ? 7 : d.getDay();
          setRecurrenceWeekdays([isoDay]);
          setRecurrenceMonthday(d.getDate());
        }
      } else {
        setRecurrenceWeekdays([1]);
        setRecurrenceMonthday(1);
      }

      setRecurrenceEndType('never');
      setRecurrenceUntilDate('');
      setRecurrenceCount(10);
      setError(null);
    }
  }

  const dialogRef = useDialog(isOpen, onClose, isPending);
  const titleId = useId();

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isPending) return;

    const form = e.currentTarget;
    const formData = new FormData(form);
    if (createdFrom === 'calendar') formData.set('created_from', createdFrom);

    const title = ((formData.get('title') as string) || '').trim();
    if (!title) {
      setError('Task title is required');
      return;
    }

    // Validate scheduling choice
    if (isScheduled) {
      if (!scheduledStart.trim()) {
        setError(
          'Please specify a scheduled start date & time, or uncheck "Schedule on Calendar" to leave unscheduled.'
        );
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

    // Normalize due_date using the workspace timezone when entered as a local datetime
    const rawDueDate = ((formData.get('due_date') as string) || '').trim();
    if (rawDueDate && !isAllDay) {
      const parsedDue = parseLocalDatetimeString(rawDueDate, userTimeZone);
      if (parsedDue) {
        formData.set('due_date', parsedDue.toISOString());
      }
    }

    // Recurrence rule setup & validation (top-level tasks only)
    if (!parentTaskId && recurrenceFreq !== 'none') {
      formData.set('recurrence_frequency', recurrenceFreq);
      formData.set('recurrence_interval', String(Math.max(1, recurrenceInterval)));
      formData.set('recurrence_timezone', userTimeZone);

      if (recurrenceFreq === 'weekly') {
        if (recurrenceWeekdays.length === 0) {
          setError('Please select at least one weekday for weekly recurrence.');
          return;
        }
        formData.delete('recurrence_by_weekday');
        for (const w of recurrenceWeekdays) {
          formData.append('recurrence_by_weekday', String(w));
        }
      } else {
        formData.delete('recurrence_by_weekday');
      }

      if (recurrenceFreq === 'monthly') {
        if (recurrenceMonthday < 1 || recurrenceMonthday > 31) {
          setError('Month day must be between 1 and 31.');
          return;
        }
        formData.set('recurrence_by_monthday', String(recurrenceMonthday));
      } else {
        formData.delete('recurrence_by_monthday');
      }

      formData.set('recurrence_end_type', recurrenceEndType);
      if (recurrenceEndType === 'until_date') {
        if (!recurrenceUntilDate.trim()) {
          setError('Please choose an end date for recurrence.');
          return;
        }
        formData.set('recurrence_until_date', recurrenceUntilDate.trim());
        formData.delete('recurrence_count');
      } else if (recurrenceEndType === 'count') {
        if (!recurrenceCount || recurrenceCount < 1) {
          setError('Occurrence count must be a positive number >= 1.');
          return;
        }
        formData.set('recurrence_count', String(recurrenceCount));
        formData.delete('recurrence_until_date');
      } else {
        formData.delete('recurrence_until_date');
        formData.delete('recurrence_count');
      }
    } else {
      formData.set('recurrence_frequency', 'none');
      formData.delete('recurrence_by_weekday');
      formData.delete('recurrence_by_monthday');
      formData.delete('recurrence_until_date');
      formData.delete('recurrence_count');
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

  const inputBaseClass =
    'w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] hover:border-[var(--border-strong)] transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/45 dark:bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="surface-card bg-[var(--bg-surface-elevated)] max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden text-[var(--text-primary)] shadow-[var(--shadow-elevated)]"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 sm:px-6 py-4 shrink-0">
          <div className="space-y-0.5 min-w-0">
            <h2 id={titleId} className="heading-section text-base sm:text-lg">
              {parentTaskId ? 'Add Subtask' : 'Create New Task'}
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              {parentTaskId
                ? 'Attach a child deliverable to this task.'
                : 'Define actionable work with optional scheduling and recurrence.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Close dialog"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">
          <input type="hidden" name="workspace_id" value={workspaceId} />
          {parentTaskId && <input type="hidden" name="parent_task_id" value={parentTaskId} />}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3.5 rounded-2xl border badge-danger text-xs"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <label
              htmlFor="task-title"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              Title <span className="text-[var(--status-danger-text)]">*</span>
            </label>
            <input
              id="task-title"
              name="title"
              type="text"
              required
              placeholder="e.g. Draft Q4 architecture proposal"
              className={inputBaseClass}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label
              htmlFor="task-desc"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              Description / Notes
            </label>
            <textarea
              id="task-desc"
              name="description"
              rows={3}
              placeholder="Details, acceptance criteria, or links..."
              className={inputBaseClass}
            />
          </div>

          {/* Priority, Status & Project Grid */}
          <div
            className={`grid grid-cols-1 gap-3.5 ${
              projects.length > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
            }`}
          >
            <div className="space-y-1.5">
              <label
                htmlFor="task-priority"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Priority
              </label>
              <select
                id="task-priority"
                name="priority"
                defaultValue="medium"
                className="w-full h-9.5 px-3 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="task-status"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Initial Status
              </label>
              <select
                id="task-status"
                name="status"
                defaultValue="todo"
                className="w-full h-9.5 px-3 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors"
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>

            {projects.length > 0 && (
              <div className="space-y-1.5">
                <label
                  htmlFor="task-project"
                  className="block text-xs font-medium text-[var(--text-secondary)]"
                >
                  Project
                </label>
                <select
                  id="task-project"
                  name="project_id"
                  defaultValue=""
                  className="w-full h-9.5 px-3 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors"
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
          </div>

          {/* Timing & Dates Section */}
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/55 p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  checked={isScheduled}
                  onChange={(e) => setIsScheduled(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--text-primary)]"
                />
                <span className="inline-flex items-center gap-1.5">
                  <Calendar
                    className="w-3.5 h-3.5 text-[var(--text-secondary)]"
                    aria-hidden="true"
                  />
                  <span>Schedule on Calendar</span>
                </span>
              </label>

              {isScheduled && (
                <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    name="is_all_day"
                    value="true"
                    checked={isAllDay}
                    onChange={(e) => setIsAllDay(e.target.checked)}
                    className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--text-primary)]"
                  />
                  <span>All Day Task</span>
                </label>
              )}
            </div>

            {isScheduled ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-0.5">
                <div className="space-y-1">
                  <label
                    htmlFor="scheduled-start"
                    className="block text-[11px] font-medium text-[var(--text-secondary)]"
                  >
                    Scheduled Start <span className="text-[var(--status-danger-text)]">*</span>
                  </label>
                  <input
                    id="scheduled-start"
                    name="scheduled_start"
                    type={isAllDay ? 'date' : 'datetime-local'}
                    value={scheduledStart}
                    onChange={(e) => setScheduledStart(e.target.value)}
                    required={isScheduled}
                    className="w-full px-3 py-1.5 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="scheduled-end"
                    className="block text-[11px] font-medium text-[var(--text-secondary)]"
                  >
                    Scheduled End <span className="text-[var(--text-muted)]">(Optional)</span>
                  </label>
                  <input
                    id="scheduled-end"
                    name="scheduled_end"
                    type={isAllDay ? 'date' : 'datetime-local'}
                    value={scheduledEnd}
                    onChange={(e) => setScheduledEnd(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-mono"
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                Task will be saved to your backlog unscheduled. You can set an optional deadline or duration below.
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-[var(--border-subtle)]">
              <div className="space-y-1">
                <label
                  htmlFor="due-date"
                  className="block text-[11px] font-medium text-[var(--text-secondary)]"
                >
                  Due Date / Deadline <span className="text-[var(--text-muted)]">(Optional)</span>
                </label>
                <input
                  id="due-date"
                  name="due_date"
                  type={isAllDay ? 'date' : 'datetime-local'}
                  className="w-full px-3 py-1.5 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-mono"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="duration-min"
                  className="block text-[11px] font-medium text-[var(--text-secondary)]"
                >
                  Estimated Duration (Minutes)
                </label>
                <input
                  id="duration-min"
                  name="estimated_duration_minutes"
                  type="number"
                  min="5"
                  step="5"
                  placeholder="e.g. 60"
                  className="w-full px-3 py-1.5 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-mono"
                />
              </div>
            </div>
          </div>

          {/* Recurrence Rule Section (top-level tasks only) */}
          {!parentTaskId && (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/55 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
                  <span>Recurrence Rule</span>
                </span>
                <span className="text-[10.5px] font-mono text-[var(--text-muted)]">
                  {userTimeZone}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label
                    htmlFor="recurrence-freq"
                    className="block text-[11px] font-medium text-[var(--text-secondary)]"
                  >
                    Frequency
                  </label>
                  <select
                    id="recurrence-freq"
                    name="recurrence_frequency"
                    value={recurrenceFreq}
                    onChange={(e) => setRecurrenceFreq(e.target.value)}
                    className="w-full h-9 px-3 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
                  >
                    <option value="none">One-time Task</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>

                {recurrenceFreq !== 'none' && (
                  <div className="space-y-1">
                    <label
                      htmlFor="recurrence-interval"
                      className="block text-[11px] font-medium text-[var(--text-secondary)]"
                    >
                      Interval (Every N{' '}
                      {recurrenceFreq === 'daily'
                        ? 'days'
                        : recurrenceFreq === 'weekly'
                          ? 'weeks'
                          : recurrenceFreq === 'monthly'
                            ? 'months'
                            : 'years'}
                      )
                    </label>
                    <input
                      id="recurrence-interval"
                      name="recurrence_interval"
                      type="number"
                      min="1"
                      value={recurrenceInterval}
                      onChange={(e) =>
                        setRecurrenceInterval(Math.max(1, parseInt(e.target.value, 10) || 1))
                      }
                      className="w-full h-9 px-3 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-mono"
                    />
                  </div>
                )}
              </div>

              {recurrenceFreq === 'weekly' && (
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
                      const isSelected = recurrenceWeekdays.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => {
                            setRecurrenceWeekdays((prev) =>
                              isSelected
                                ? prev.filter((d) => d !== day)
                                : [...prev, day].sort((a, b) => a - b)
                            );
                          }}
                          className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
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

              {recurrenceFreq === 'monthly' && (
                <div className="space-y-1.5 pt-1 border-t border-[var(--border-subtle)]">
                  <label
                    htmlFor="recurrence-monthday"
                    className="block text-[11px] font-medium text-[var(--text-secondary)]"
                  >
                    Day of Month (1 - 31)
                  </label>
                  <input
                    id="recurrence-monthday"
                    type="number"
                    min="1"
                    max="31"
                    value={recurrenceMonthday}
                    onChange={(e) =>
                      setRecurrenceMonthday(
                        Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1))
                      )
                    }
                    className="w-28 h-9 px-3 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-mono"
                  />
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Months with fewer days safely clamp to month-end without drifting.
                  </p>
                </div>
              )}

              {recurrenceFreq === 'yearly' && (
                <div className="pt-1 border-t border-[var(--border-subtle)]">
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Repeats annually on the scheduled date. Leap-year dates (Feb 29) clamp safely to Feb 28 in non-leap years.
                  </p>
                </div>
              )}

              {recurrenceFreq !== 'none' && (
                <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                    Termination Condition
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <label className="flex items-center gap-2 p-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] cursor-pointer text-xs">
                      <input
                        type="radio"
                        name="recurrence_end_option"
                        value="never"
                        checked={recurrenceEndType === 'never'}
                        onChange={() => setRecurrenceEndType('never')}
                        className="accent-[var(--text-primary)]"
                      />
                      <span>Never ends</span>
                    </label>

                    <label className="flex items-center gap-2 p-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] cursor-pointer text-xs">
                      <input
                        type="radio"
                        name="recurrence_end_option"
                        value="until_date"
                        checked={recurrenceEndType === 'until_date'}
                        onChange={() => setRecurrenceEndType('until_date')}
                        className="accent-[var(--text-primary)]"
                      />
                      <span>On Date</span>
                    </label>

                    <label className="flex items-center gap-2 p-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] cursor-pointer text-xs">
                      <input
                        type="radio"
                        name="recurrence_end_option"
                        value="count"
                        checked={recurrenceEndType === 'count'}
                        onChange={() => setRecurrenceEndType('count')}
                        className="accent-[var(--text-primary)]"
                      />
                      <span>After Occurrences</span>
                    </label>
                  </div>

                  {recurrenceEndType === 'until_date' && (
                    <div className="space-y-1 pt-1">
                      <label
                        htmlFor="recurrence-until-date"
                        className="block text-[11px] font-medium text-[var(--text-secondary)]"
                      >
                        End Date <span className="text-[var(--status-danger-text)]">*</span>
                      </label>
                      <input
                        id="recurrence-until-date"
                        type="date"
                        value={recurrenceUntilDate}
                        onChange={(e) => setRecurrenceUntilDate(e.target.value)}
                        required
                        className="w-full sm:w-64 h-9 px-3 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-mono"
                      />
                    </div>
                  )}

                  {recurrenceEndType === 'count' && (
                    <div className="space-y-1 pt-1">
                      <label
                        htmlFor="recurrence-count"
                        className="block text-[11px] font-medium text-[var(--text-secondary)]"
                      >
                        Total Occurrences <span className="text-[var(--status-danger-text)]">*</span>
                      </label>
                      <input
                        id="recurrence-count"
                        type="number"
                        min="1"
                        value={recurrenceCount}
                        onChange={(e) =>
                          setRecurrenceCount(Math.max(1, parseInt(e.target.value, 10) || 1))
                        }
                        required
                        className="w-32 h-9 px-3 text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-mono"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary px-4 py-2 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="btn-accent px-5 py-2 text-xs disabled:opacity-50"
            >
              {isPending ? 'Saving Task...' : 'Save Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
