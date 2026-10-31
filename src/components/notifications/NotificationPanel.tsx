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
}

export function NotificationPanel({
  isOpen,
  onClose,
  workspaceId,
  userTimeZone,
  onNotificationsMutated,
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
    if (isOpen) {
      loadRecentNotifications();
    }
  }, [isOpen, loadRecentNotifications]);

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
    // Delay outside click listener slightly so opening click does not immediately close it
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

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Notifications Panel"
      className={clsx(
        'absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] sm:w-96 max-w-sm',
        'bg-neutral-950 border border-neutral-800 rounded-xl shadow-2xl z-50',
        'flex flex-col max-h-[85vh] sm:max-h-[560px] animate-in fade-in zoom-in-95 duration-150 text-neutral-100'
      )}
    >
      {/* Panel Header */}
      <div className="p-4 border-b border-neutral-800 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-blue-400" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-neutral-100">Notifications</h3>
          {unreadCount > 0 && (
            <span
              className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20"
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
              className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-400 hover:text-neutral-200 px-2 py-1 rounded hover:bg-neutral-900 transition-colors disabled:opacity-50"
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
            className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 rounded-md transition-colors"
            title="Notification Settings"
            aria-label="Notification Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </Link>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 rounded-md transition-colors"
            aria-label="Close notifications panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-rose-950/40 border-b border-rose-900/60 text-rose-300 text-xs flex items-center justify-between gap-2">
          <span className="truncate">{error}</span>
          <button
            type="button"
            onClick={loadRecentNotifications}
            className="p-1 hover:text-white"
            title="Retry"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Notifications List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 divide-y divide-transparent min-h-[160px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-48 text-neutral-500 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            <span className="text-xs">Loading notifications...</span>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-neutral-500 p-4">
            <div className="w-10 h-10 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center mb-2">
              <BellOff className="w-5 h-5 text-neutral-400" />
            </div>
            <p className="text-xs font-medium text-neutral-300">No notifications yet</p>
            <p className="text-[11px] text-neutral-400 mt-1 max-w-[200px]">
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
      <div className="p-3 border-t border-neutral-800/80 bg-neutral-900/40 flex items-center justify-between text-xs shrink-0">
        <Link
          href="/notifications"
          onClick={onClose}
          className="font-medium text-blue-400 hover:text-blue-300 hover:underline inline-flex items-center gap-1"
        >
          <span>View all notifications</span>
        </Link>
        <Link
          href="/settings/notifications"
          onClick={onClose}
          className="text-neutral-400 hover:text-neutral-200"
        >
          <span>Preferences</span>
        </Link>
      </div>
    </div>
  );
}
