'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Bell } from 'lucide-react';
import { getUnreadNotificationCountAction } from '@/lib/actions/notification-actions';
import { NotificationPanel } from './NotificationPanel';
import clsx from 'clsx';

export interface NotificationBellProps {
  workspaceId?: string;
  userTimeZone?: string;
  className?: string;
}

export function NotificationBell({
  workspaceId,
  userTimeZone,
  className,
}: NotificationBellProps) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isOpen, setIsOpen] = useState<boolean>(false);

  // Safety: never render on public or auth pages
  const isPublicOrAuthPage = pathname === '/' || pathname.startsWith('/auth');

  const fetchUnreadCount = useCallback(async () => {
    if (isPublicOrAuthPage) return;
    try {
      const res = await getUnreadNotificationCountAction(workspaceId);
      if (res.success && typeof res.data === 'number') {
        setUnreadCount(Math.max(0, res.data));
      }
    } catch {
      // Non-blocking background fetch failure
    }
  }, [workspaceId, isPublicOrAuthPage]);

  // Initial load
  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  // Event-driven refresh without aggressive polling
  useEffect(() => {
    if (isPublicOrAuthPage) return;

    const handleNotificationsUpdated = () => {
      fetchUnreadCount();
    };

    const handleWindowFocus = () => {
      fetchUnreadCount();
    };

    window.addEventListener('cc:notifications-updated', handleNotificationsUpdated);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      window.removeEventListener('cc:notifications-updated', handleNotificationsUpdated);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [fetchUnreadCount, isPublicOrAuthPage]);

  if (isPublicOrAuthPage) {
    return null;
  }

  const formattedBadgeCount = unreadCount > 99 ? '99+' : unreadCount.toString();
  const ariaLabel =
    unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications, 0 unread';

  return (
    <div className={clsx('relative inline-flex items-center', className)}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title={ariaLabel}
        className={clsx(
          'relative p-2 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950',
          isOpen && 'bg-neutral-900 text-neutral-100'
        )}
      >
        <Bell className="w-4 h-4" aria-hidden="true" />

        {/* Unread badge: only rendered when count > 0 */}
        {unreadCount > 0 && (
          <span
            data-testid="notification-unread-badge"
            className={clsx(
              'absolute -top-1 -right-1 flex items-center justify-center',
              'min-w-4 h-4 px-1 rounded-full text-[10px] font-bold font-mono',
              'bg-red-500 text-white shadow-xs ring-2 ring-neutral-950 animate-in zoom-in-75 duration-150'
            )}
          >
            {formattedBadgeCount}
          </span>
        )}
      </button>

      <NotificationPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        workspaceId={workspaceId}
        userTimeZone={userTimeZone}
        onNotificationsMutated={fetchUnreadCount}
      />
    </div>
  );
}
