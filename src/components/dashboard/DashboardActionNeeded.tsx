import Link from 'next/link';
import { ArrowUpRight, CheckCircle2 } from 'lucide-react';
import type { UrgentTaskItem, UpcomingContentItem } from '@/lib/services/dashboard-service';
import { formatInTimeZone } from '@/lib/temporal/timezone';
import { clsx } from 'clsx';

interface DashboardActionNeededProps {
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

export function DashboardActionNeeded({
  urgentTasks,
  upcomingContent,
  timeZone,
  referenceTimeIso,
}: DashboardActionNeededProps) {
  const refTimeMs = new Date(referenceTimeIso).getTime();
  const contentWithin24Hours = upcomingContent.filter((item) => {
    if (!item.scheduled_at) return false;
    const schedMs = new Date(item.scheduled_at).getTime();
    return schedMs >= refTimeMs && schedMs <= refTimeMs + 24 * 60 * 60 * 1000;
  });

  const totalActionItems = urgentTasks.length + contentWithin24Hours.length;

  return (
    <section
      className="surface-card overflow-hidden min-w-0"
      aria-labelledby="action-needed-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/45">
        <div className="flex items-center gap-2 min-w-0">
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
          {urgentTasks.map((task) => {
            const isOverdue = task.due_date ? new Date(task.due_date).getTime() < refTimeMs : false;
            const isBlocked = task.status === 'blocked';
            const badgeText = isOverdue
              ? 'OVERDUE'
              : isBlocked
                ? 'BLOCKED'
                : task.priority.toUpperCase();

            return (
              <Link
                key={task.id}
                href="/tasks"
                className="group flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2.5 transition-colors hover:bg-[var(--bg-surface-hover)] min-w-0"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span
                    aria-hidden="true"
                    className={clsx(
                      'h-1.5 w-1.5 rounded-full shrink-0',
                      isOverdue || task.priority === 'urgent'
                        ? 'bg-[var(--status-danger-text)]'
                        : isBlocked || task.priority === 'high'
                          ? 'bg-[var(--status-warning-text)]'
                          : 'bg-[var(--text-muted)]'
                    )}
                  />

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

                  <p className="text-[13px] font-medium text-[var(--text-primary)] truncate min-w-0">
                    {task.title}
                  </p>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 pl-4 sm:pl-0 shrink-0">
                  <span className="text-[11px] font-mono text-[var(--text-muted)] whitespace-nowrap">
                    {statusLabel[task.status] ?? task.status.replace('_', ' ')}
                  </span>
                  {task.due_date && (
                    <span
                      className={clsx(
                        'text-[11px] font-mono tabular-nums whitespace-nowrap',
                        isOverdue
                          ? 'font-semibold text-[var(--status-danger-text)]'
                          : 'text-[var(--text-secondary)]'
                      )}
                    >
                      {formatInTimeZone(task.due_date, timeZone, {
                        year: undefined,
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                  <ArrowUpRight
                    aria-hidden="true"
                    className="h-3.5 w-3.5 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hidden sm:block"
                  />
                </div>
              </Link>
            );
          })}

          {contentWithin24Hours.length > 0 && (
            <>
              <div className="bg-[var(--bg-surface-muted)]/30 px-3.5 py-1.5 flex items-center justify-between text-[10.5px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                <span>Scheduled within 24 hours</span>
                <span>{contentWithin24Hours.length} queued</span>
              </div>
              {contentWithin24Hours.map((item) => (
                <Link
                  key={item.id}
                  href="/content"
                  className="group flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2.5 transition-colors hover:bg-[var(--bg-surface-hover)] min-w-0"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shrink-0"
                    />
                    <span className="inline-flex shrink-0 items-center justify-center min-w-[26px] rounded-[4px] border badge-accent px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase leading-none">
                      {platformTag[item.platform]}
                    </span>
                    <p className="text-[13px] font-medium text-[var(--text-primary)] truncate min-w-0">
                      {item.title}
                    </p>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 pl-4 sm:pl-0 shrink-0">
                    <span className="text-[11px] font-mono text-[var(--text-muted)] uppercase">
                      {item.action_type}
                    </span>
                    <span className="text-[11px] font-mono tabular-nums text-[var(--text-secondary)] whitespace-nowrap">
                      {item.scheduled_at
                        ? formatInTimeZone(item.scheduled_at, timeZone, {
                            year: undefined,
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Scheduled'}
                    </span>
                    <ArrowUpRight
                      aria-hidden="true"
                      className="h-3.5 w-3.5 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hidden sm:block"
                    />
                  </div>
                </Link>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
