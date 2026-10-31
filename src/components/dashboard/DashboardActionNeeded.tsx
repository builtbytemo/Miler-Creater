import Link from 'next/link';
import {
  AlertCircle,
  Clock,
  CheckCircle2,
  Share2,
  CheckSquare,
  ArrowRight,
} from 'lucide-react';
import type { UrgentTaskItem, UpcomingContentItem } from '@/lib/services/dashboard-service';
import { formatInTimeZone } from '@/lib/temporal/timezone';
import { clsx } from 'clsx';

interface DashboardActionNeededProps {
  urgentTasks: UrgentTaskItem[];
  upcomingContent: UpcomingContentItem[];
  timeZone: string;
  referenceTimeIso: string;
}

export function DashboardActionNeeded({
  urgentTasks,
  upcomingContent,
  timeZone,
  referenceTimeIso,
}: DashboardActionNeededProps) {
  // Content scheduled within 24 hours of reference time
  const refTimeMs = new Date(referenceTimeIso).getTime();
  const in24hMs = refTimeMs + 24 * 60 * 60 * 1000;

  const urgentContent = upcomingContent.filter((c) => {
    if (!c.scheduled_at) return false;
    const itemMs = new Date(c.scheduled_at).getTime();
    return itemMs >= refTimeMs && itemMs <= in24hMs;
  });

  const totalItems = urgentTasks.length + urgentContent.length;

  return (
    <section className="space-y-3" aria-labelledby="action-needed-heading">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center">
            <AlertCircle className="w-3.5 h-3.5" />
          </div>
          <h3 id="action-needed-heading" className="text-sm font-semibold text-neutral-100">
            Action Needed
          </h3>
          <span className="text-[11px] text-neutral-500">
            (Priority tasks & posts in next 24h)
          </span>
        </div>
        {totalItems > 0 && (
          <span className="text-[11px] text-neutral-500 font-mono">
            Showing top {totalItems} items
          </span>
        )}
      </div>

      {totalItems === 0 ? (
        <div className="p-6 rounded-xl bg-neutral-950 border border-neutral-800 text-center space-y-2">
          <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <p className="text-xs font-medium text-neutral-200">All clear</p>
          <p className="text-[11px] text-neutral-500 max-w-sm mx-auto">
            No overdue tasks, tasks due today, or content scheduled in the next 24 hours.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Urgent Task Items */}
          {urgentTasks.map((task) => {
            const isOverdue = task.due_date && task.due_date < referenceTimeIso;
            const priorityColors = {
              urgent: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
              high: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
              medium: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
              low: 'bg-neutral-800 text-neutral-400 border-neutral-700',
            };

            return (
              <Link
                key={`task-${task.id}`}
                href="/tasks"
                className="group p-3.5 rounded-xl bg-neutral-950 border border-neutral-800 hover:border-neutral-700 transition-all focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none flex items-start justify-between gap-3"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-6 h-6 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <CheckSquare className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-medium text-neutral-200 group-hover:text-blue-400 transition-colors truncate">
                      {task.title}
                    </p>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className={clsx('px-1.5 py-0.5 rounded border capitalize font-medium', priorityColors[task.priority])}>
                        {task.priority}
                      </span>
                      {task.due_date ? (
                        <span className={clsx('flex items-center gap-1 font-mono', isOverdue ? 'text-rose-400 font-semibold' : 'text-neutral-400')}>
                          <Clock className="w-3 h-3" />
                          {isOverdue ? 'Overdue: ' : 'Due: '}
                          {formatInTimeZone(task.due_date, timeZone, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      ) : (
                        <span className="text-neutral-500">No due date</span>
                      )}
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-neutral-600 group-hover:text-neutral-300 transition-colors shrink-0 mt-1" />
              </Link>
            );
          })}

          {/* Urgent Content Items (Next 24 Hours) */}
          {urgentContent.map((item) => (
            <Link
              key={`content-${item.id}`}
              href="/content"
              className="group p-3.5 rounded-xl bg-neutral-950 border border-neutral-800 hover:border-neutral-700 transition-all focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none flex items-start justify-between gap-3"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="w-6 h-6 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Share2 className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-medium text-neutral-200 group-hover:text-purple-400 transition-colors truncate">
                    {item.title || 'Untitled Post'}
                  </p>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700 capitalize font-medium">
                      {item.platform}
                    </span>
                    <span className="flex items-center gap-1 text-amber-400 font-mono font-medium">
                      <Clock className="w-3 h-3" />
                      Publishing:{' '}
                      {item.scheduled_at
                        ? formatInTimeZone(item.scheduled_at, timeZone, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Unscheduled'}
                    </span>
                  </div>
                </div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-neutral-600 group-hover:text-neutral-300 transition-colors shrink-0 mt-1" />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
