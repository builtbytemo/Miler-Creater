'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Bell,
  BellOff,
  CheckCheck,
  CheckSquare,
  ChevronLeft,
  Filter,
  Loader2,
  RefreshCw,
  Settings,
  Share2,
  Sparkles,
} from 'lucide-react';
import type { NotificationRow } from '@/lib/services/notification-service';
import type { NotificationEntityType } from '@/lib/validation/notification';
import {
  getNotificationsAction,
  markNotificationAsReadAction,
  markNotificationAsUnreadAction,
  markAllNotificationsAsReadAction,
  dismissNotificationAction,
} from '@/lib/actions/notification-actions';
import { NotificationItem } from './NotificationItem';
import clsx from 'clsx';

export interface NotificationCenterProps {
  workspaceId: string;
  workspaceName?: string;
  userTimeZone?: string;
}

type ReadFilter = 'all' | 'unread';
type TypeFilter = 'all' | NotificationEntityType;

export function NotificationCenter({
  workspaceId,
  workspaceName,
  userTimeZone,
}: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [page, setPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);

  const PAGE_LIMIT = 15;

  const fetchNotifications = useCallback(
    async (targetPage = 1, append = false) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const filterInput: {
          page: number;
          limit: number;
          unread_only?: boolean;
          entity_type?: NotificationEntityType;
        } = {
          page: targetPage,
          limit: PAGE_LIMIT,
        };

        if (readFilter === 'unread') {
          filterInput.unread_only = true;
        }

        if (typeFilter !== 'all') {
          filterInput.entity_type = typeFilter;
        }

        const res = await getNotificationsAction(workspaceId, filterInput);

        if (res.error) {
          setError(res.error);
        } else if (res.data) {
          if (append) {
            setNotifications((prev) => {
              const existingIds = new Set(prev.map((n) => n.id));
              const newItems = res.data!.notifications.filter((n) => !existingIds.has(n.id));
              return [...prev, ...newItems];
            });
          } else {
            setNotifications(res.data.notifications);
          }
          setHasMore(res.data.hasMore);
          setTotalCount(res.data.total);
          setPage(targetPage);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch notifications');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [workspaceId, readFilter, typeFilter]
  );

  useEffect(() => {
    fetchNotifications(1, false);
  }, [fetchNotifications]);

  const notifyChange = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cc:notifications-updated'));
    }
  };

  const handleMarkRead = async (id: string) => {
    if (processingId) return;
    setProcessingId(id);
    try {
      const res = await markNotificationAsReadAction(workspaceId, id);
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
      const res = await markNotificationAsUnreadAction(workspaceId, id);
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
      const res = await dismissNotificationAction(workspaceId, id);
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
    if (isMarkingAllRead) return;
    setIsMarkingAllRead(true);
    try {
      const res = await markAllNotificationsAsReadAction(workspaceId);
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

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-800">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Back to Overview</span>
            </Link>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-neutral-100">
                Notifications Center
              </h1>
              <p className="text-xs text-neutral-400">
                Review, filter, and manage alerts across tasks and social content
                {workspaceName ? ` in ${workspaceName}` : ''}.
              </p>
            </div>
          </div>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={isMarkingAllRead}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-800 transition-colors disabled:opacity-50"
            >
              {isMarkingAllRead ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCheck className="w-3.5 h-3.5 text-blue-400" />
              )}
              <span>Mark all read</span>
            </button>
          )}

          <Link
            href="/settings/notifications"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 transition-colors"
          >
            <Settings className="w-3.5 h-3.5 text-neutral-400" />
            <span>Preferences</span>
          </Link>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-neutral-950 border border-neutral-800">
        {/* Read / Unread Tabs */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-neutral-900 border border-neutral-800 text-xs">
          <button
            type="button"
            onClick={() => setReadFilter('all')}
            className={clsx(
              'px-3 py-1 rounded-md font-medium transition-colors',
              readFilter === 'all'
                ? 'bg-neutral-800 text-white shadow-xs'
                : 'text-neutral-400 hover:text-neutral-200'
            )}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setReadFilter('unread')}
            className={clsx(
              'px-3 py-1 rounded-md font-medium transition-colors',
              readFilter === 'unread'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-neutral-400 hover:text-neutral-200'
            )}
          >
            Unread
          </button>
        </div>

        {/* Entity Type Filter */}
        <div className="flex items-center gap-1 text-xs">
          <span className="text-neutral-500 mr-1 flex items-center gap-1">
            <Filter className="w-3 h-3" /> Type:
          </span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1 text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All Types</option>
            <option value="task">Tasks</option>
            <option value="content_item">Content</option>
            <option value="ai_request">AI Confirmation</option>
            <option value="system">System</option>
          </select>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-900/60 text-rose-200 text-xs flex items-center justify-between gap-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => fetchNotifications(page, false)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-900/50 hover:bg-rose-900 text-rose-100"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Main List */}
      <div className="space-y-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-neutral-500 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            <span className="text-sm">Loading notification center...</span>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-neutral-500 p-6 rounded-xl bg-neutral-950 border border-neutral-850">
            <div className="w-12 h-12 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center mb-3">
              <BellOff className="w-6 h-6 text-neutral-400" />
            </div>
            <h3 className="text-sm font-semibold text-neutral-200">
              {readFilter === 'unread' ? 'No unread notifications' : 'No notifications found'}
            </h3>
            <p className="text-xs text-neutral-400 mt-1 max-w-sm">
              {readFilter === 'unread'
                ? 'You have read all active notifications. Switch to "All" to inspect previous updates.'
                : 'Task and content lifecycle events will appear here when updates occur in your workspace.'}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  userTimeZone={userTimeZone}
                  isProcessing={processingId === n.id}
                  onMarkRead={handleMarkRead}
                  onMarkUnread={handleMarkUnread}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>

            {/* Load more / Pagination button */}
            {hasMore && (
              <div className="pt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => fetchNotifications(page + 1, true)}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-800 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <span>Load More Notifications</span>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
