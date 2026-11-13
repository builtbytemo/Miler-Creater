import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { DashboardNotificationMetrics } from '@/lib/services/dashboard-service';
import { formatInTimeZone } from '@/lib/temporal/timezone';

interface DashboardRecentNotificationsProps {
  notifications: DashboardNotificationMetrics;
  timeZone: string;
}

/**
 * Unread workspace notifications feed on the Overview screen.
 */
export function DashboardRecentNotifications({
  notifications,
  timeZone,
}: DashboardRecentNotificationsProps) {
  return (
    <section className="space-y-3.5 min-w-0" aria-labelledby="notifications-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <h3 id="notifications-heading" className="heading-section text-base sm:text-lg">
            Recent Unread Alerts
          </h3>
          {notifications.unreadCount > 0 && (
            <span className="px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--accent-border)] text-[11px] font-mono font-semibold bg-[var(--accent-subtle)] text-[var(--accent-text)] shrink-0">
              {notifications.unreadCount} new
            </span>
          )}
        </div>
        <Link
          href="/notifications"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent-text)] transition-colors whitespace-nowrap"
        >
          <span>View all alerts</span>
          <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>

      {notifications.recentUnread.length === 0 ? (
        <div className="py-7 px-5 surface-card border-dashed text-center space-y-1">
          <p className="text-sm font-semibold text-[var(--text-primary)]">All caught up</p>
          <p className="text-xs text-[var(--text-muted)] max-w-sm mx-auto">
            You have no unread notifications in this workspace.
          </p>
        </div>
      ) : (
        <div className="surface-card divide-y divide-[var(--border-subtle)] overflow-hidden">
          {notifications.recentUnread.map((item) => (
            <Link
              key={item.id}
              href="/notifications"
              className="group block px-4 sm:px-5 py-3.5 transition-colors hover:bg-[var(--bg-surface-hover)]"
            >
              <div className="flex items-baseline justify-between gap-3 min-w-0">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 rotate-45 bg-[var(--accent)] shrink-0"
                      aria-hidden="true"
                    />
                    <p className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-text)] line-clamp-2 break-words min-w-0 transition-colors">
                      {item.title}
                    </p>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] line-clamp-2 break-words pl-4">
                    {item.message}
                  </p>
                </div>
                <span className="text-[11px] text-[var(--text-muted)] font-mono tabular-nums shrink-0 whitespace-nowrap">
                  {formatInTimeZone(item.created_at, timeZone, {
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
