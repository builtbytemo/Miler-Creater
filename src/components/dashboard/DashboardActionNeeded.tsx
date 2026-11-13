'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Loader2,
  X,
} from 'lucide-react';
import type { UrgentTaskItem, UpcomingContentItem } from '@/lib/services/dashboard-service';
import { completeTaskAction, updateTaskAction } from '@/lib/actions/task-actions';
import { formatInTimeZone } from '@/lib/temporal/timezone';
import { ZahiDiamondMark } from '@/components/brand/ZahiBrand';
import { clsx } from 'clsx';

interface DashboardActionNeededProps {
  workspaceId: string;
  urgentTasks: UrgentTaskItem[];
  upcomingContent: UpcomingContentItem[];
  timeZone: string;
  referenceTimeIso: string;
}

const platformTag: Record<UpcomingContentItem['platform'], string> = {
  linkedin: 'LI',
  reddit: 'RD',
  threads: 'TH',
  x: 'X',
};

const statusLabel: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
};

export interface UrgencyDescriptor {
  label: string;
  tone: 'overdue' | 'soon' | 'normal';
}

export function formatRelativeUrgency(
  isoDate: string | null,
  referenceIso: string,
  timeZone: string
): UrgencyDescriptor {
  if (!isoDate) {
    return { label: 'No due date', tone: 'normal' };
  }

  const targetMs = new Date(isoDate).getTime();
  const refMs = new Date(referenceIso).getTime();
  if (Number.isNaN(targetMs) || Number.isNaN(refMs)) {
    return { label: 'Scheduled', tone: 'normal' };
  }

  const diffMs = targetMs - refMs;
  const absMins = Math.round(Math.abs(diffMs) / 60_000);

  if (diffMs < 0) {
    if (absMins < 60) {
      return { label: `${Math.max(1, absMins)}m overdue`, tone: 'overdue' };
    }
    const absHours = Math.round(absMins / 60);
    if (absHours < 24) {
      return { label: `${absHours}h overdue`, tone: 'overdue' };
    }
    const absDays = Math.round(absHours / 24);
    return { label: `${absDays}d overdue`, tone: 'overdue' };
  }

  if (absMins < 60) {
    return { label: `In ${Math.max(1, absMins)}m`, tone: 'soon' };
  }
  const absHours = Math.round(absMins / 60);
  if (absHours <= 6) {
    return { label: `In ${absHours}h`, tone: 'soon' };
  }
  if (absHours < 24) {
    return {
      label: `Today · ${formatInTimeZone(isoDate, timeZone, {
        year: undefined,
        month: undefined,
        day: undefined,
        hour: '2-digit',
        minute: '2-digit',
      })}`,
      tone: 'normal',
    };
  }

  return {
    label: formatInTimeZone(isoDate, timeZone, {
      year: undefined,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    tone: 'normal',
  };
}

export function computeQuickRescheduleIso(
  baseDueIso: string | null,
  referenceIso: string,
  daysOffset: number
): string {
  const refDate = new Date(referenceIso);
  const safeRef = Number.isNaN(refDate.getTime()) ? new Date() : refDate;
  const target = new Date(safeRef.getTime() + daysOffset * 24 * 60 * 60 * 1000);

  const parsedDue = baseDueIso ? new Date(baseDueIso) : null;
  if (parsedDue && !Number.isNaN(parsedDue.getTime())) {
    target.setUTCHours(parsedDue.getUTCHours(), parsedDue.getUTCMinutes(), 0, 0);
  } else {
    target.setUTCHours(14, 0, 0, 0);
  }

  // Ensure a forward reschedule always lands in the future relative to reference time.
  if (target.getTime() <= safeRef.getTime()) {
    target.setTime(safeRef.getTime() + daysOffset * 24 * 60 * 60 * 1000);
  }

  return target.toISOString();
}

export function DashboardActionNeeded({
  workspaceId,
  urgentTasks,
  upcomingContent,
  timeZone,
  referenceTimeIso,
}: DashboardActionNeededProps) {
  const router = useRouter();
  const [localTasks, setLocalTasks] = useState<UrgentTaskItem[]>(urgentTasks);
  const [prevUrgentTasks, setPrevUrgentTasks] = useState<UrgentTaskItem[]>(urgentTasks);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [rescheduleTaskId, setRescheduleTaskId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);

  if (prevUrgentTasks !== urgentTasks) {
    setPrevUrgentTasks(urgentTasks);
    setLocalTasks(urgentTasks);
  }

  useEffect(() => {
    if (!rescheduleTaskId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRescheduleTaskId(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [rescheduleTaskId]);

  useEffect(() => {
    if (!statusNotice || statusNotice.tone !== 'success') return;
    const timer = setTimeout(() => setStatusNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [statusNotice]);

  const canMutate = Boolean(workspaceId && workspaceId !== 'local-preview');
  const refTimeMs = new Date(referenceTimeIso).getTime();

  const contentWithin24Hours = upcomingContent.filter((item) => {
    if (!item.scheduled_at) return false;
    const schedMs = new Date(item.scheduled_at).getTime();
    return schedMs >= refTimeMs && schedMs <= refTimeMs + 24 * 60 * 60 * 1000;
  });

  const totalActionItems = localTasks.length + contentWithin24Hours.length;

  const handleCompleteTask = async (task: UrgentTaskItem) => {
    if (!canMutate || busyTaskId) return;
    setBusyTaskId(task.id);
    setStatusNotice(null);

    try {
      const result = await completeTaskAction(workspaceId, task.id);
      if (result.error) {
        setStatusNotice({ tone: 'error', message: result.error });
        return;
      }

      setLocalTasks((prev) => prev.filter((item) => item.id !== task.id));
      if (rescheduleTaskId === task.id) {
        setRescheduleTaskId(null);
      }

      const payload = result.data as { nextOccurrence?: unknown } | undefined;
      setStatusNotice({
        tone: 'success',
        message: payload?.nextOccurrence
          ? `Completed "${task.title}" · Next occurrence queued`
          : `Completed "${task.title}"`,
      });
      router.refresh();
    } catch {
      setStatusNotice({
        tone: 'error',
        message: 'Could not complete task. Please try again.',
      });
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleQuickReschedule = async (task: UrgentTaskItem, daysOffset: number, label: string) => {
    if (!canMutate || busyTaskId) return;
    setBusyTaskId(task.id);
    setStatusNotice(null);

    try {
      const nextDueIso = computeQuickRescheduleIso(task.due_date, referenceTimeIso, daysOffset);
      const formData = new FormData();
      formData.set('workspace_id', workspaceId);
      formData.set('task_id', task.id);
      formData.set('due_date', nextDueIso);

      const result = await updateTaskAction(null, formData);
      if (result.error) {
        setStatusNotice({ tone: 'error', message: result.error });
        return;
      }

      setLocalTasks((prev) => prev.filter((item) => item.id !== task.id));
      setRescheduleTaskId(null);
      setStatusNotice({
        tone: 'success',
        message: `Rescheduled "${task.title}" to ${label}`,
      });
      router.refresh();
    } catch {
      setStatusNotice({
        tone: 'error',
        message: 'Could not reschedule task. Please try again.',
      });
    } finally {
      setBusyTaskId(null);
    }
  };

  return (
    <section
      className="surface-card overflow-hidden min-w-0"
      aria-labelledby="action-needed-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/45">
        <div className="flex items-center gap-2 min-w-0">
          <ZahiDiamondMark size="xs" tone="accent" />
          <h2 id="action-needed-heading" className="heading-section text-[13px]">
            Action Needed
          </h2>
          {totalActionItems > 0 && (
            <span className="inline-flex items-center rounded-[4px] border badge-accent px-1.5 py-0.5 text-[10.5px] font-mono font-semibold tabular-nums leading-none">
              {totalActionItems}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs shrink-0">
          <Link
            href="/tasks"
            className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-medium transition-colors"
          >
            <span>All tasks</span>
            <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
          </Link>
          <Link
            href="/calendar"
            className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-medium transition-colors"
          >
            <span>Schedule</span>
            <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {statusNotice && (
        <div
          role={statusNotice.tone === 'error' ? 'alert' : 'status'}
          className={clsx(
            'flex items-center justify-between gap-2 px-3.5 py-2 text-xs border-b border-[var(--border-subtle)]',
            statusNotice.tone === 'error' ? 'badge-danger' : 'badge-success'
          )}
        >
          <span className="flex items-center gap-1.5 min-w-0">
            {statusNotice.tone === 'error' ? (
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate font-medium">{statusNotice.message}</span>
          </span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            aria-label="Dismiss notification"
            className="p-0.5 rounded-[4px] hover:bg-black/10 dark:hover:bg-white/10 shrink-0"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      )}

      {totalActionItems === 0 ? (
        <div className="px-4 py-7 text-center space-y-2">
          <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-full badge-success border">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
          <div className="space-y-0.5">
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">
              All clear
            </p>
            <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto">
              No overdue tasks, tasks due today, or content scheduled in the next 24 hours.
            </p>
          </div>
          <div className="pt-1 flex items-center justify-center gap-2">
            <Link href="/tasks" className="btn-secondary h-7 px-2.5 text-[11px]">
              Review tasks
            </Link>
            <Link href="/content" className="btn-secondary h-7 px-2.5 text-[11px]">
              Plan content
            </Link>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-[var(--border-subtle)]">
          {localTasks.length > 0 && (
            <>
              <div className="bg-[var(--bg-surface-muted)]/30 px-3.5 py-1.5 flex items-center justify-between text-[10.5px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                <span>Priority tasks</span>
                <span>{localTasks.length} needing action</span>
              </div>

              {localTasks.map((task) => {
                const isOverdue = task.due_date ? new Date(task.due_date).getTime() < refTimeMs : false;
                const isBlocked = task.status === 'blocked';
                const badgeText = isOverdue
                  ? 'OVERDUE'
                  : isBlocked
                    ? 'BLOCKED'
                    : task.priority.toUpperCase();
                const urgency = formatRelativeUrgency(task.due_date, referenceTimeIso, timeZone);
                const isBusy = busyTaskId === task.id;
                const isRescheduling = rescheduleTaskId === task.id;
                const taskHref = `/tasks?taskId=${encodeURIComponent(task.id)}`;

                return (
                  <div
                    key={task.id}
                    className="group px-3.5 py-2.5 transition-colors hover:bg-[var(--bg-surface-hover)] min-w-0"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-w-0">
                      <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
                        {canMutate ? (
                          <button
                            type="button"
                            onClick={() => handleCompleteTask(task)}
                            disabled={Boolean(busyTaskId)}
                            aria-label={`Complete "${task.title}"`}
                            title="Mark task done"
                            className={clsx(
                              'mt-0.5 sm:mt-0 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
                              isBusy
                                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                                : 'border-[var(--border-strong)] bg-[var(--bg-surface)] text-transparent hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]'
                            )}
                          >
                            {isBusy ? (
                              <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Check className="h-2.5 w-2.5 stroke-[2.5]" aria-hidden="true" />
                            )}
                          </button>
                        ) : (
                          <span
                            aria-hidden="true"
                            className={clsx(
                              'mt-1.5 sm:mt-0 h-1.5 w-1.5 rounded-full shrink-0',
                              isOverdue || task.priority === 'urgent'
                                ? 'bg-[var(--status-danger-text)]'
                                : isBlocked || task.priority === 'high'
                                  ? 'bg-[var(--status-warning-text)]'
                                  : 'bg-[var(--text-muted)]'
                            )}
                          />
                        )}

                        <Link
                          href={taskHref}
                          className="flex flex-wrap sm:flex-nowrap items-center gap-2 min-w-0 flex-1 rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                        >
                          <span
                            className={clsx(
                              'inline-flex shrink-0 items-center rounded-[4px] border px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide leading-none',
                              isOverdue
                                ? 'badge-danger'
                                : task.priority === 'urgent'
                                  ? 'badge-accent'
                                  : isBlocked || task.priority === 'high'
                                    ? 'badge-warning'
                                    : 'badge-neutral'
                            )}
                          >
                            {badgeText}
                          </span>

                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors truncate">
                              {task.title}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-muted)]">
                              <span>{statusLabel[task.status] ?? task.status}</span>
                              <span aria-hidden="true">·</span>
                              <span className="capitalize">{task.priority} priority</span>
                            </div>
                          </div>
                        </Link>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-2 pl-6 sm:pl-0 shrink-0">
                        <div className="text-right">
                          {task.due_date ? (
                            <span
                              className={clsx(
                                'block text-[11px] font-mono tabular-nums whitespace-nowrap',
                                urgency.tone === 'overdue'
                                  ? 'text-[var(--status-danger-text)] font-semibold'
                                  : urgency.tone === 'soon'
                                    ? 'text-[var(--status-warning-text)] font-medium'
                                    : 'text-[var(--text-secondary)]'
                              )}
                            >
                              {urgency.label}
                            </span>
                          ) : (
                            <span className="block text-[11px] font-mono text-[var(--text-muted)]">
                              No due date
                            </span>
                          )}
                          {task.due_date && (
                            <span className="hidden md:block text-[10px] font-mono tabular-nums text-[var(--text-muted)] whitespace-nowrap">
                              {formatInTimeZone(task.due_date, timeZone, {
                                year: undefined,
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          )}
                        </div>

                        {canMutate && task.status !== 'done' && (
                          <button
                            type="button"
                            onClick={() =>
                              setRescheduleTaskId((prev) => (prev === task.id ? null : task.id))
                            }
                            aria-expanded={isRescheduling}
                            aria-label={`Reschedule "${task.title}"`}
                            title="Quick reschedule"
                            className={clsx(
                              'inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
                              isRescheduling
                                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
                            )}
                          >
                            <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="hidden sm:inline">Defer</span>
                          </button>
                        )}

                        <Link
                          href={taskHref}
                          aria-label={`Open "${task.title}"`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] transition-colors"
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </div>
                    </div>

                    {isRescheduling && canMutate && (
                      <div
                        role="group"
                        aria-label={`Quick reschedule options for ${task.title}`}
                        className="mt-2 ml-0 sm:ml-7 pt-2 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] mr-1">
                            Move due date:
                          </span>
                          <button
                            type="button"
                            disabled={Boolean(busyTaskId)}
                            onClick={() => handleQuickReschedule(task, 1, 'Tomorrow')}
                            className="btn-secondary h-6 px-2 text-[11px]"
                          >
                            Tomorrow
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(busyTaskId)}
                            onClick={() => handleQuickReschedule(task, 3, 'in 3 days')}
                            className="btn-secondary h-6 px-2 text-[11px]"
                          >
                            +3 days
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(busyTaskId)}
                            onClick={() => handleQuickReschedule(task, 7, 'next week')}
                            className="btn-secondary h-6 px-2 text-[11px]"
                          >
                            +7 days
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => setRescheduleTaskId(null)}
                          className="text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] px-1.5 py-0.5 rounded-[4px]"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {contentWithin24Hours.length > 0 && (
            <>
              <div className="bg-[var(--bg-surface-muted)]/30 px-3.5 py-1.5 flex items-center justify-between text-[10.5px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                <span>Publishing within 24 hours</span>
                <span>{contentWithin24Hours.length} queued</span>
              </div>
              {contentWithin24Hours.map((item) => {
                const contentUrgency = formatRelativeUrgency(
                  item.scheduled_at,
                  referenceTimeIso,
                  timeZone
                );
                return (
                  <Link
                    key={item.id}
                    href={`/content?tab=scheduled&contentId=${encodeURIComponent(item.id)}`}
                    className="group flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2.5 transition-colors hover:bg-[var(--bg-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] min-w-0"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shrink-0"
                      />
                      <span className="inline-flex shrink-0 items-center justify-center min-w-[26px] rounded-[4px] border badge-accent px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase leading-none">
                        {platformTag[item.platform]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors truncate">
                          {item.title}
                        </p>
                        <p className="text-[11px] text-[var(--text-muted)] font-mono uppercase">
                          {item.action_type} · Scheduled
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 pl-4 sm:pl-0 shrink-0">
                      <div className="text-right">
                        <span className="block text-[11px] font-mono tabular-nums text-[var(--text-primary)] font-medium whitespace-nowrap">
                          {contentUrgency.label}
                        </span>
                        {item.scheduled_at && (
                          <span className="hidden md:block text-[10px] font-mono tabular-nums text-[var(--text-muted)] whitespace-nowrap">
                            {formatInTimeZone(item.scheduled_at, timeZone, {
                              year: undefined,
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                      <ArrowUpRight
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hidden sm:block"
                      />
                    </div>
                  </Link>
                );
              })}
            </>
          )}
        </div>
      )}
    </section>
  );
}
