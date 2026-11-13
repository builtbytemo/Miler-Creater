'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { Bell } from 'lucide-react';
import { getUnreadNotificationCountAction } from '@/lib/actions/notification-actions';
import { NotificationPanel } from './NotificationPanel';
import clsx from 'clsx';

export interface NotificationBellProps {
  workspaceId?: string;
  userTimeZone?: string;
  className?: string;
  panelAlign?: 'left' | 'right' | 'responsive';
}

export function NotificationBell({
  workspaceId,
  userTimeZone,
  className,
  panelAlign = 'responsive',
}: NotificationBellProps) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  // Initial load & event-driven refresh without aggressive polling
  useEffect(() => {
    if (isPublicOrAuthPage) return;

    let cancelled = false;
    void getUnreadNotificationCountAction(workspaceId)
      .then((res) => {
        if (!cancelled && res.success && typeof res.data === 'number') {
          setUnreadCount(Math.max(0, res.data));
        }
      })
      .catch(() => {
        // Non-blocking background fetch failure
      });

    const handleNotificationsUpdated = () => {
      fetchUnreadCount();
    };

    const handleWindowFocus = () => {
      fetchUnreadCount();
    };

    window.addEventListener('cc:notifications-updated', handleNotificationsUpdated);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      cancelled = true;
      window.removeEventListener('cc:notifications-updated', handleNotificationsUpdated);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [fetchUnreadCount, isPublicOrAuthPage, workspaceId]);

  if (isPublicOrAuthPage) {
    return null;
  }

  const formattedBadgeCount = unreadCount > 99 ? '99+' : unreadCount.toString();
  const ariaLabel =
    unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications, 0 unread';

  return (
    <div className={clsx('relative inline-flex items-center', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title={ariaLabel}
        className={clsx(
          'relative inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border transition-colors',
          'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
          'hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]',
          isOpen && 'border-[var(--border-strong)] bg-[var(--bg-surface-hover)] text-[var(--text-primary)]'
        )}
      >
        <Bell className="w-3.5 h-3.5" aria-hidden="true" />

        {/* Unread badge: only rendered when count > 0 */}
        {unreadCount > 0 && (
          <span
            data-testid="notification-unread-badge"
            className={clsx(
              'absolute -top-1 -right-1 flex items-center justify-center pointer-events-none',
              'min-w-4 h-4 px-1 rounded-full text-[10px] font-bold font-mono leading-none',
              'bg-[var(--accent)] text-[var(--accent-ink)] ring-2 ring-[var(--bg-sidebar)]'
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
        align={panelAlign}
        triggerRef={triggerRef}
      />
    </div>
  );
}
