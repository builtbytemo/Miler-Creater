'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
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
}

export function NotificationPanel({
  isOpen,
  onClose,
  workspaceId,
  userTimeZone,
  onNotificationsMutated,
  align = 'responsive',
}: NotificationPanelProps) {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const loadRecentNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getNotificationsAction(workspaceId, { limit: 8 });
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setNotifications(res.data.notifications);
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
    void getNotificationsAction(workspaceId, { limit: 8 })
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setError(res.error);
        } else if (res.data) {
          setNotifications(res.data.notifications);
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

  // Handle outside click and Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
    }, 10);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleClickOutside);
      clearTimeout(timer);
    };
  }, [isOpen, onClose]);

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

  const alignClasses =
    align === 'left'
      ? 'sm:left-0 sm:right-auto'
      : align === 'right'
        ? 'sm:right-0 sm:left-auto'
        : 'sm:right-0 lg:left-0 lg:right-auto';

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Notifications Panel"
      className={clsx(
        'fixed inset-x-3 top-15 w-auto max-w-none sm:absolute sm:inset-x-auto sm:top-full sm:mt-2 sm:w-96 sm:max-w-sm',
        alignClasses,
        'bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-2xl shadow-[var(--shadow-elevated)] z-50',
        'flex flex-col max-h-[80vh] sm:max-h-[540px] text-[var(--text-primary)] overflow-hidden'
      )}
    >
      {/* Panel Header */}
      <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)]">
            <Bell className="w-3.5 h-3.5" aria-hidden="true" />
          </span>
          <h3 className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
            Notifications
          </h3>
          {unreadCount > 0 && (
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold badge-info border"
              title={`${unreadCount} unread`}
            >
              {unreadCount} unread
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={isMarkingAllRead}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-2.5 py-1 rounded-full hover:bg-[var(--bg-surface-muted)] transition-colors disabled:opacity-50"
              title="Mark all notifications as read"
            >
              {isMarkingAllRead ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <CheckCheck className="w-3 h-3" />
              )}
              <span>Mark all read</span>
            </button>
          )}

          <Link
            href="/settings/notifications"
            onClick={onClose}
            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] rounded-full transition-colors"
            title="Notification Settings"
            aria-label="Notification Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </Link>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] rounded-full transition-colors"
            aria-label="Close notifications panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 badge-danger border-b text-xs flex items-center justify-between gap-2">
          <span className="truncate">{error}</span>
          <button
            type="button"
            onClick={loadRecentNotifications}
            className="p-1 hover:opacity-80"
            title="Retry"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Notifications List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[160px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-44 text-[var(--text-muted)] gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--text-primary)]" />
            <span className="text-xs">Loading notifications...</span>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-44 text-center text-[var(--text-muted)] p-4">
            <div className="w-10 h-10 rounded-full bg-[var(--bg-surface-muted)] border border-[var(--border-subtle)] flex items-center justify-center mb-2">
              <BellOff className="w-4 h-4 text-[var(--text-muted)]" />
            </div>
            <p className="text-xs font-semibold text-[var(--text-primary)]">No notifications yet</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-1 max-w-[210px]">
              You&apos;re all caught up! Updates about your tasks and content will appear here.
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
            />
          ))
        )}
      </div>

      {/* Panel Footer */}
      <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/60 flex items-center justify-between text-xs shrink-0">
        <Link
          href="/notifications"
          onClick={onClose}
          className="font-semibold text-[var(--text-primary)] hover:underline inline-flex items-center gap-1"
        >
          <span>View all notifications</span>
        </Link>
        <Link
          href="/settings/notifications"
          onClick={onClose}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <span>Preferences</span>
        </Link>
      </div>
    </div>
  );
}
