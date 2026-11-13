import Link from 'next/link';
import { ArrowUpRight, BellOff } from 'lucide-react';
import type { DashboardNotificationMetrics } from '@/lib/services/dashboard-service';
import { formatInTimeZone } from '@/lib/temporal/timezone';

interface DashboardRecentNotificationsProps {
  notifications: DashboardNotificationMetrics;
  timeZone: string;
}

export function DashboardRecentNotifications({
  notifications,
  timeZone,
}: DashboardRecentNotificationsProps) {
  return (
    <section
      className="surface-card overflow-hidden min-w-0"
      aria-labelledby="notifications-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/45">
        <div className="flex items-center gap-2 min-w-0">
          <h2 id="notifications-heading" className="heading-section text-[13px]">
            Recent Unread Alerts
          </h2>
          {notifications.unreadCount > 0 && (
            <span className="inline-flex items-center rounded-[4px] border badge-accent px-1.5 py-0.5 text-[10.5px] font-mono font-semibold leading-none">
              {notifications.unreadCount} new
            </span>
          )}
        </div>
        <Link
          href="/notifications"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
        >
          <span>View all alerts</span>
          <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
        </Link>
      </div>

      {notifications.recentUnread.length === 0 ? (
        <div className="px-4 py-6 text-center space-y-1.5">
          <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-muted)]">
            <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
          <p className="text-[13px] font-semibold text-[var(--text-primary)]">
            All caught up
          </p>
          <p className="text-xs text-[var(--text-muted)] max-w-sm mx-auto">
            You have no unread notifications in this workspace.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--border-subtle)]">
          {notifications.recentUnread.map((item) => (
            <Link
              key={item.id}
              href="/notifications?filter=unread"
              className="group block px-3.5 py-2.5 transition-colors hover:bg-[var(--bg-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
            >
              <div className="flex items-start justify-between gap-3 min-w-0">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shrink-0"
                      aria-hidden="true"
                    />
                    <p className="text-[13px] font-medium text-[var(--text-primary)] truncate min-w-0">
                      {item.title}
                    </p>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] line-clamp-1 pl-3.5">
                    {item.message}
                  </p>
                </div>
                <span className="text-[11px] text-[var(--text-muted)] font-mono tabular-nums shrink-0 whitespace-nowrap pt-0.5">
                  {formatInTimeZone(item.created_at, timeZone, {
                    year: undefined,
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
