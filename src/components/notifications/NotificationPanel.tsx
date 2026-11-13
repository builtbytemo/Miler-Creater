'use client';

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  ArrowUpRight,
  Bell,
  BellOff,
  CheckCheck,
  Loader2,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react';
import type { NotificationRow } from '@/lib/services/notification-service';
import {
  getNotificationsAction,
  markNotificationAsReadAction,
  markNotificationAsUnreadAction,
  markAllNotificationsAsReadAction,
  dismissNotificationAction,
} from '@/lib/actions/notification-actions';
import { NotificationItem } from './NotificationItem';
import clsx from 'clsx';

export interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId?: string;
  userTimeZone?: string;
  onNotificationsMutated?: () => void;
  align?: 'left' | 'right' | 'responsive';
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

export interface NotificationPanelLayout {
  isMobile: boolean;
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function computeNotificationPanelLayout({
  triggerRect,
  viewportWidth,
  viewportHeight,
  align = 'responsive',
  navRightEdge = null,
}: {
  triggerRect: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'> | null;
  viewportWidth: number;
  viewportHeight: number;
  align?: 'left' | 'right' | 'responsive';
  navRightEdge?: number | null;
}): NotificationPanelLayout {
  if (viewportWidth < 640) {
    const top = triggerRect
      ? Math.max(52, Math.min(Math.round(triggerRect.bottom) + 8, 96))
      : 56;
    return {
      isMobile: true,
      top,
      left: 12,
      width: Math.max(260, viewportWidth - 24),
      maxHeight: Math.max(220, Math.min(560, viewportHeight - top - 16)),
    };
  }

  const width = Math.min(416, viewportWidth - 24);
  let left = 16;
  let preferredTop = 56;

  if (triggerRect) {
    const isCollapsedRailTrigger =
      triggerRect.left < 96 && viewportWidth >= 768 && align !== 'right';
    if (isCollapsedRailTrigger) {
      const preferredRailLeft =
        navRightEdge !== null && navRightEdge !== undefined
          ? Math.max(Math.round(triggerRect.right) + 12, Math.round(navRightEdge) + 8)
          : Math.round(triggerRect.right) + 12;
      left = Math.min(preferredRailLeft, viewportWidth - width - 12);
      preferredTop = Math.max(12, Math.round(triggerRect.top));
    } else if (align === 'right' || triggerRect.right > viewportWidth - 220) {
      left = Math.max(12, Math.round(triggerRect.right) - width);
      preferredTop = Math.round(triggerRect.bottom) + 8;
    } else {
      left = Math.max(
        12,
        Math.min(Math.round(triggerRect.left), viewportWidth - width - 12)
      );
      preferredTop = Math.round(triggerRect.bottom) + 8;
    }
  }

  const top = Math.max(12, Math.min(preferredTop, Math.max(12, viewportHeight - 260)));
  const maxHeight = Math.max(220, Math.min(560, viewportHeight - top - 16));

  return {
    isMobile: false,
    top,
    left,
    width,
    maxHeight,
  };
}

export function NotificationPanel({
  isOpen,
  onClose,
  workspaceId,
  userTimeZone,
  onNotificationsMutated,
  align = 'responsive',
  triggerRef,
}: NotificationPanelProps) {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [layout, setLayout] = useState<NotificationPanelLayout>({
    isMobile: false,
    top: 56,
    left: 16,
    width: 400,
    maxHeight: 540,
  });

  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const closeAndRestoreFocus = useCallback(() => {
    onCloseRef.current();
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        triggerRef?.current?.focus();
      });
    }
  }, [triggerRef]);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const updatePosition = useCallback(() => {
    if (typeof window === 'undefined') return;
    const triggerEl = triggerRef?.current ?? null;
    const rect = triggerEl?.getBoundingClientRect() ?? null;
    const navRightEdge =
      triggerEl?.closest('[data-app-nav]')?.getBoundingClientRect().right ?? null;
    setLayout(
      computeNotificationPanelLayout({
        triggerRect: rect,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        align,
        navRightEdge,
      })
    );
  }, [align, triggerRef]);

  useIsomorphicLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();

    let rafId = 0;
    const scheduleUpdate = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        updatePosition();
      });
    };

    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
    };
  }, [isOpen, updatePosition]);

  const loadRecentNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getNotificationsAction(workspaceId, { limit: 25 });
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setNotifications(res.data.notifications);
        setTotalCount(res.data.total ?? res.data.notifications.length);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void getNotificationsAction(workspaceId, { limit: 25 })
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setError(res.error);
        } else if (res.data) {
          setError(null);
          setNotifications(res.data.notifications);
          setTotalCount(res.data.total ?? res.data.notifications.length);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load notifications');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, workspaceId]);

  // Focus entry, focus trap, Escape dismissal, and outside click handling
  useEffect(() => {
    if (!isOpen) return;

    const dialogEl = panelRef.current;
    if (dialogEl) {
      requestAnimationFrame(() => {
        dialogEl.focus({ preventScroll: true });
      });
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAndRestoreFocus();
        return;
      }

      if (e.key === 'Tab' && panelRef.current) {
        const focusable = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.getClientRects().length > 0);

        if (focusable.length === 0) {
          e.preventDefault();
          panelRef.current.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === panelRef.current) {
            e.preventDefault();
            last.focus();
          }
        } else if (
          document.activeElement === last ||
          !panelRef.current.contains(document.activeElement)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    const handleMouseDownOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef?.current?.contains(target)) {
        return;
      }
      if (panelRef.current && !panelRef.current.contains(target)) {
        onCloseRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDownOutside);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDownOutside);
    };
  }, [isOpen, closeAndRestoreFocus, triggerRef]);

  const notifyChange = () => {
    onNotificationsMutated?.();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cc:notifications-updated'));
    }
  };

  const handleMarkRead = async (id: string) => {
    if (processingId) return;
    setProcessingId(id);
    try {
      const item = notifications.find((n) => n.id === id);
      const targetWs = item?.workspace_id || workspaceId;
      const res = await markNotificationAsReadAction(targetWs, id);
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read_at: res.data!.read_at } : n))
        );
        notifyChange();
      }
    } catch {
      setError('Unable to mark notification as read');
    } finally {
      setProcessingId(null);
    }
  };

  const handleMarkUnread = async (id: string) => {
    if (processingId) return;
    setProcessingId(id);
    try {
      const item = notifications.find((n) => n.id === id);
      const targetWs = item?.workspace_id || workspaceId;
      const res = await markNotificationAsUnreadAction(targetWs, id);
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read_at: null } : n))
        );
        notifyChange();
      }
    } catch {
      setError('Unable to mark notification as unread');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDismiss = async (id: string) => {
    if (processingId) return;
    setProcessingId(id);
    try {
      const item = notifications.find((n) => n.id === id);
      const targetWs = item?.workspace_id || workspaceId;
      const res = await dismissNotificationAction(targetWs, id);
      if (res.error) {
        setError(res.error);
      } else {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        setTotalCount((prev) => Math.max(0, prev - 1));
        notifyChange();
      }
    } catch {
      setError('Unable to dismiss notification');
    } finally {
      setProcessingId(null);
    }
  };

  const handleMarkAllRead = async () => {
    if (isMarkingAllRead || unreadCount === 0) return;
    setIsMarkingAllRead(true);
    try {
      const targetWs = notifications[0]?.workspace_id || workspaceId;
      const res = await markAllNotificationsAsReadAction(targetWs);
      if (res.error) {
        setError(res.error);
      } else {
        const nowIso = new Date().toISOString();
        setNotifications((prev) =>
          prev.map((n) => (n.read_at ? n : { ...n, read_at: nowIso }))
        );
        notifyChange();
      }
    } catch {
      setError('Failed to mark all as read');
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  if (!isOpen) return null;

  const hasMoreThanShown = totalCount > notifications.length;

  const panelMarkup = (
    <div className="fixed inset-0 z-[90] pointer-events-none">
      {/* Narrow-screen interactive scrim for sheet presentation */}
      {layout.isMobile && (
        <div
          aria-hidden="true"
          onClick={() => onCloseRef.current()}
          className="fixed inset-0 bg-black/35 backdrop-blur-[2px] pointer-events-auto"
        />
      )}

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Notifications Panel"
        style={{
          top: `${layout.top}px`,
          left: `${layout.left}px`,
          width: `${layout.width}px`,
          maxHeight: `${layout.maxHeight}px`,
        }}
        className={clsx(
          'fixed pointer-events-auto outline-none',
          'surface-elevated flex flex-col overflow-hidden text-[var(--text-primary)]'
        )}
      >
        {/* Panel Header */}
        <div className="px-3.5 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/45 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-ink)]">
              <Bell className="w-3.5 h-3.5" aria-hidden="true" />
            </span>
            <h3 className="heading-section text-[13px] truncate">Notifications</h3>
            {unreadCount > 0 && (
              <span
                className="inline-flex items-center rounded-[4px] border badge-accent px-1.5 py-0.5 text-[10px] font-mono font-semibold leading-none shrink-0 tabular-nums"
                title={`${unreadCount} unread`}
              >
                {unreadCount}
                <span className="hidden sm:inline">&nbsp;unread</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={isMarkingAllRead}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-1.5 sm:px-2 py-1 rounded-[var(--radius-sm)] hover:bg-[var(--bg-surface-hover)] transition-colors disabled:opacity-50"
                title="Mark all notifications as read"
              >
                {isMarkingAllRead ? (
                  <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCheck className="w-3 h-3" aria-hidden="true" />
                )}
                <span className="hidden sm:inline">Mark all read</span>
                <span className="sm:hidden">Read all</span>
              </button>
            )}

            <Link
              href="/settings/notifications"
              onClick={() => onCloseRef.current()}
              className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition-colors"
              title="Notification Settings"
              aria-label="Notification Settings"
            >
              <Settings className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>

            <button
              type="button"
              onClick={closeAndRestoreFocus}
              className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition-colors"
              aria-label="Close notifications panel"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div
            role="alert"
            className="px-3.5 py-2 badge-danger border-b text-xs flex items-center justify-between gap-2 shrink-0"
          >
            <span className="truncate">{error}</span>
            <button
              type="button"
              onClick={loadRecentNotifications}
              className="inline-flex items-center gap-1 text-[11px] font-medium hover:opacity-80 shrink-0"
              title="Retry"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Notifications Scroll Area */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-2.5 space-y-1.5 min-h-[160px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-40 text-[var(--text-muted)] gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--text-primary)]" aria-hidden="true" />
              <span className="text-xs">Loading notifications…</span>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-9 text-center text-[var(--text-muted)] px-4">
              <div className="w-9 h-9 rounded-full bg-[var(--bg-surface-muted)] border border-[var(--border-subtle)] flex items-center justify-center mb-2.5">
                <BellOff className="w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
              </div>
              <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                All caught up
              </p>
              <p className="text-[11.5px] text-[var(--text-muted)] mt-1 max-w-[230px] leading-relaxed">
                No recent alerts in this workspace. Task reminders and publishing updates appear here.
              </p>
            </div>
          ) : (
            notifications.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                userTimeZone={userTimeZone}
                isProcessing={processingId === n.id}
                onMarkRead={handleMarkRead}
                onMarkUnread={handleMarkUnread}
                onDismiss={handleDismiss}
                onNavigate={() => onCloseRef.current()}
              />
            ))
          )}
        </div>

        {/* Panel Footer */}
        <div className="px-3.5 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/45 flex items-center justify-between gap-2 text-xs shrink-0">
          <Link
            href="/notifications"
            onClick={() => onCloseRef.current()}
            className="inline-flex items-center gap-1 font-medium text-[var(--text-primary)] hover:text-[var(--accent-text)] transition-colors"
          >
            <span>
              {hasMoreThanShown
                ? `View all ${totalCount} notifications`
                : 'View all notifications'}
            </span>
            <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
          </Link>
          <Link
            href="/settings/notifications"
            onClick={() => onCloseRef.current()}
            className="text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            Briefing &amp; alerts
          </Link>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(panelMarkup, document.body);
  }

  return panelMarkup;
}
