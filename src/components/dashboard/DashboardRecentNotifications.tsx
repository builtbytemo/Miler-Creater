import Link from 'next/link';
import { Bell, ArrowRight, CheckCircle2 } from 'lucide-react';
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
    <section className="space-y-3" aria-labelledby="notifications-heading">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center">
            <Bell className="w-3.5 h-3.5" />
          </div>
          <h3 id="notifications-heading" className="text-sm font-semibold text-neutral-100">
            Recent Unread Alerts
          </h3>
          {notifications.unreadCount > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
              {notifications.unreadCount} new
            </span>
          )}
        </div>
        <Link
          href="/notifications"
          className="text-xs text-neutral-400 hover:text-neutral-200 flex items-center gap-1 transition-colors"
        >
          <span>View all alerts</span>
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {notifications.recentUnread.length === 0 ? (
        <div className="p-6 rounded-xl bg-neutral-950 border border-neutral-800 text-center space-y-2">
          <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <p className="text-xs font-medium text-neutral-200">All caught up</p>
          <p className="text-[11px] text-neutral-500 max-w-sm mx-auto">
            You have no unread notifications in this workspace.
          </p>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2.5">
          {notifications.recentUnread.map((item) => (
            <Link
              key={item.id}
              href="/notifications"
              className="group block p-2.5 rounded-lg bg-neutral-900 border border-neutral-850 hover:border-neutral-750 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-xs font-medium text-neutral-200 group-hover:text-blue-400 truncate transition-colors">
                    {item.title}
                  </p>
                  <p className="text-[11px] text-neutral-400 line-clamp-1">
                    {item.message}
                  </p>
                </div>
                <span className="text-[10px] text-neutral-500 font-mono shrink-0 whitespace-nowrap">
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
