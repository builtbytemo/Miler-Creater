import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { UrgentTaskItem, UpcomingContentItem } from '@/lib/services/dashboard-service';
import { formatInTimeZone } from '@/lib/temporal/timezone';
import { clsx } from 'clsx';
import { EmptyState } from '@/components/ui/EmptyState';

interface DashboardActionNeededProps {
  urgentTasks: UrgentTaskItem[];
  upcomingContent: UpcomingContentItem[];
  timeZone: string;
  referenceTimeIso: string;
}

/**
 * Primary Overview execution queue combining overdue/priority tasks and next-24h publishing items.
 */
export function DashboardActionNeeded({
  urgentTasks,
  upcomingContent,
  timeZone,
  referenceTimeIso,
}: DashboardActionNeededProps) {
  const refTimeMs = new Date(referenceTimeIso).getTime();
  const in24hMs = refTimeMs + 24 * 60 * 60 * 1000;

  const urgentContent = upcomingContent.filter((c) => {
    if (!c.scheduled_at) return false;
    const itemMs = new Date(c.scheduled_at).getTime();
    return itemMs >= refTimeMs && itemMs <= in24hMs;
  });

  const totalItems = urgentTasks.length + urgentContent.length;

  return (
    <section className="space-y-3.5 min-w-0" aria-labelledby="action-needed-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
        <div className="flex flex-wrap items-baseline gap-2 min-w-0">
          <h3 id="action-needed-heading" className="heading-section text-base sm:text-lg">
            Action Needed
          </h3>
          <span className="text-xs text-[var(--text-muted)]">
            (Priority tasks &amp; posts in next 24h)
          </span>
        </div>
        {totalItems > 0 && (
          <span className="text-xs text-[var(--text-muted)] font-mono tabular-nums shrink-0">
            Showing top {totalItems} items
          </span>
        )}
      </div>

      {totalItems === 0 ? (
        <EmptyState
          showMascot={true}
          title="All clear"
          description="No overdue tasks, tasks due today, or content scheduled in the next 24 hours."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link href="/tasks" className="btn-secondary px-3.5 py-1.5 text-xs">
                Open tasks
              </Link>
              <Link href="/calendar" className="btn-secondary px-3.5 py-1.5 text-xs">
                Plan calendar
              </Link>
            </div>
          }
        />
      ) : (
        <div className="surface-card divide-y divide-[var(--border-subtle)] overflow-hidden">
          {urgentTasks.map((task) => {
            const isOverdue = task.due_date && task.due_date < referenceTimeIso;
            const priorityStyles = {
              urgent: 'badge-danger',
              high: 'badge-warning',
              medium: 'badge-info',
              low: 'badge-neutral',
            };

            return (
              <Link
                key={`task-${task.id}`}
                href="/tasks"
                className="group flex items-center justify-between gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 transition-colors hover:bg-[var(--bg-surface-hover)]"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span
                      aria-hidden="true"
                      className={clsx(
                        'mt-1.5 h-1.5 w-1.5 rotate-45 shrink-0',
                        isOverdue
                          ? 'bg-[var(--status-danger-text)]'
                          : 'bg-[var(--accent)]'
                      )}
                    />
                    <p className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-text)] line-clamp-2 break-words min-w-0 transition-colors">
                      {task.title}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-4 text-xs">
                    <span
                      className={clsx(
                        'px-2 py-0.5 rounded-[var(--radius-sm)] border text-[11px] capitalize font-medium shrink-0',
                        priorityStyles[task.priority]
                      )}
                    >
                      {task.priority}
                    </span>
                    {task.due_date ? (
                      <span
                        className={clsx(
                          'font-mono text-[11px] tabular-nums',
                          isOverdue
                            ? 'text-[var(--status-danger-text)] font-medium'
                            : 'text-[var(--text-muted)]'
                        )}
                      >
                        {isOverdue ? 'Overdue · ' : 'Due · '}
                        {formatInTimeZone(task.due_date, timeZone, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    ) : (
                      <span className="text-[11px] text-[var(--text-muted)]">
                        No due date
                      </span>
                    )}
                  </div>
                </div>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-transparent text-[var(--text-muted)] group-hover:border-[var(--accent-border)] group-hover:bg-[var(--accent)] group-hover:text-[var(--accent-ink)] transition-colors">
                  <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                </span>
              </Link>
            );
          })}

          {urgentContent.map((item) => (
            <Link
              key={`content-${item.id}`}
              href="/calendar"
              className="group flex items-center justify-between gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 transition-colors hover:bg-[var(--bg-surface-hover)]"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-start gap-2.5 min-w-0">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 h-1.5 w-1.5 rotate-45 bg-[var(--status-editorial-text)] shrink-0"
                  />
                  <p className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-text)] line-clamp-2 break-words min-w-0 transition-colors">
                    {item.title || 'Untitled Post'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-4 text-xs">
                  <span className="px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] text-[11px] capitalize font-medium shrink-0">
                    {item.platform}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)] font-mono tabular-nums">
                    Publishing ·{' '}
                    {item.scheduled_at
                      ? formatInTimeZone(item.scheduled_at, timeZone, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'Unscheduled'}
                  </span>
                </div>
              </div>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-transparent text-[var(--text-muted)] group-hover:border-[var(--accent-border)] group-hover:bg-[var(--accent)] group-hover:text-[var(--accent-ink)] transition-colors">
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
