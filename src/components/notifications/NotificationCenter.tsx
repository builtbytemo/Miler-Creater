'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  BellOff,
  CheckCheck,
  ChevronLeft,
  Filter,
  Loader2,
  RefreshCw,
  Settings,
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
import { ZahiDiamondMark } from '@/components/brand/ZahiBrand';
import { EmptyState } from '@/components/ui/EmptyState';
import { DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';
import clsx from 'clsx';

export interface NotificationCenterProps {
  workspaceId: string;
  workspaceName?: string;
  userTimeZone?: string;
  initialReadFilter?: 'all' | 'unread';
}

type ReadFilter = 'all' | 'unread';
type TypeFilter = 'all' | NotificationEntityType;

export function NotificationCenter({
  workspaceId,
  workspaceName,
  userTimeZone = DEFAULT_TIMEZONE,
  initialReadFilter = 'all',
}: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readFilter, setReadFilter] = useState<ReadFilter>(initialReadFilter);
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
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        void fetchNotifications(1, false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchNotifications]);

  // Keyboard shortcuts: 'u' toggles All / Unread, 'r' refreshes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          target.closest('[role="dialog"]'))
      ) {
        return;
      }

      if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        setReadFilter((prev) => (prev === 'all' ? 'unread' : 'all'));
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        fetchNotifications(1, false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: null } : n)));
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
        setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: nowIso })));
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
      {/* Masthead */}
      <header className="flex flex-col @2xl:flex-row @2xl:items-end justify-between gap-4 pb-5 border-b border-[var(--border-subtle)]">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-xs text-[var(--text-muted)]">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Overview</span>
            </Link>
            <span aria-hidden="true" className="text-[var(--text-tertiary)]">
              /
            </span>
            <ZahiDiamondMark size="xs" tone="accent" />
            <span className="font-mono uppercase tracking-[0.08em] text-[10.5px] font-medium">
              {workspaceName ? `${workspaceName} · Inbox` : 'Workspace Inbox'}
            </span>
            <span aria-hidden="true" className="text-[var(--text-tertiary)]">
              ·
            </span>
            <span className="font-mono text-[11px]">{userTimeZone}</span>
          </div>

          <h1 className="heading-display text-[22px] sm:text-[26px]">Notifications Center</h1>
          <p className="text-xs text-[var(--text-secondary)]">
            Review, filter, and triage alerts across tasks, deadlines, and editorial workflows
            {workspaceName ? ` in ${workspaceName}` : ''}.
          </p>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            type="button"
            onClick={() => fetchNotifications(1, false)}
            disabled={loading}
            className="btn-secondary px-2.5 py-2 text-xs font-medium disabled:opacity-50"
            title="Refresh notifications (r)"
            aria-label="Refresh notifications"
          >
            <RefreshCw
              className={clsx('w-3.5 h-3.5 text-[var(--text-muted)]', loading && 'animate-spin')}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={isMarkingAllRead}
              className="btn-secondary px-3 py-2 text-xs font-medium disabled:opacity-50"
            >
              {isMarkingAllRead ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCheck className="w-3.5 h-3.5 text-[var(--accent-text)]" aria-hidden="true" />
              )}
              <span>Mark all read</span>
            </button>
          )}

          <Link
            href="/settings/notifications"
            className="btn-secondary px-3 py-2 text-xs font-medium"
          >
            <Settings className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
            <span>Preferences</span>
          </Link>
        </div>
      </header>

      {/* Filter Toolbar */}
      <div className="surface-card p-3 flex flex-wrap items-center justify-between gap-3">
        {/* Read / Unread Segmented Tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          <div
            role="group"
            aria-label="Read status filter"
            className="inline-flex items-center gap-0.5 p-0.5 rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)] border border-[var(--border-subtle)] text-xs"
          >
            <button
              type="button"
              aria-pressed={readFilter === 'all'}
              onClick={() => setReadFilter('all')}
              className={clsx(
                'min-h-7 px-3 py-1 rounded-[5px] transition-all',
                readFilter === 'all'
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-semibold shadow-2xs ring-1 ring-[var(--border-subtle)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] font-medium'
              )}
            >
              All
            </button>
            <button
              type="button"
              aria-pressed={readFilter === 'unread'}
              onClick={() => setReadFilter('unread')}
              className={clsx(
                'min-h-7 px-3 py-1 rounded-[5px] inline-flex items-center gap-1.5 transition-all',
                readFilter === 'unread'
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-semibold shadow-2xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] font-medium'
              )}
            >
              <span>Unread</span>
              {unreadCount > 0 && (
                <span
                  className={clsx(
                    'text-[10px] font-mono tabular-nums px-1.5 py-0 rounded-full',
                    readFilter === 'unread'
                      ? 'bg-white/20 text-white'
                      : 'badge-accent border'
                  )}
                >
                  {unreadCount}
                </span>
              )}
            </button>
          </div>

          <span className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">
            {totalCount} {totalCount === 1 ? 'alert' : 'alerts'}
          </span>
        </div>

        {/* Entity Type Filter */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[var(--text-muted)] inline-flex items-center gap-1 text-[11px] font-medium">
            <Filter className="w-3 h-3" aria-hidden="true" />
            <span>Type</span>
          </span>
          <select
            aria-label="Filter notifications by type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="input-control w-auto py-1.5 px-2.5 min-h-8 text-xs leading-tight"
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
        <div
          role="alert"
          className="p-3.5 rounded-[var(--radius-md)] badge-danger border text-xs flex items-center justify-between gap-2"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => fetchNotifications(page, false)}
            className="btn-secondary px-2.5 py-1 text-xs font-medium"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Main List */}
      <div className="space-y-2">
        {loading ? (
          <div className="surface-card flex flex-col items-center justify-center py-20 text-[var(--text-muted)] gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" aria-hidden="true" />
            <span className="text-xs font-medium">Loading notifications...</span>
          </div>
        ) : notifications.length === 0 ? (
          <EmptyState
            showMascot={readFilter === 'all' && typeFilter === 'all'}
            icon={<BellOff className="w-5 h-5 text-[var(--text-muted)]" aria-hidden="true" />}
            title={readFilter === 'unread' ? 'Inbox Zero — no unread alerts' : 'No notifications found'}
            description={
              readFilter === 'unread'
                ? 'You have reviewed every unread notification. Switch to "All" to revisit earlier activity.'
                : 'Task reminders, editorial schedule updates, and system alerts appear here as workspace activity occurs.'
            }
            action={
              readFilter === 'unread' || typeFilter !== 'all' ? (
                <button
                  type="button"
                  onClick={() => {
                    setReadFilter('all');
                    setTypeFilter('all');
                  }}
                  className="btn-secondary px-3.5 py-2 text-xs font-medium"
                >
                  Show all notifications
                </button>
              ) : undefined
            }
          />
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

            {hasMore && (
              <div className="pt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => fetchNotifications(page + 1, true)}
                  disabled={loadingMore}
                  className="btn-secondary px-4 py-2 text-xs font-medium disabled:opacity-50"
                >
                  {loadingMore ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
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
