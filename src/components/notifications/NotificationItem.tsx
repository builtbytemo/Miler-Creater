'use client';

import Link from 'next/link';
import {
  Bell,
  Check,
  CheckSquare,
  ArrowUpRight,
  RotateCcw,
  Share2,
  Sparkles,
  X,
  Loader2,
} from 'lucide-react';
import type { NotificationRow } from '@/lib/services/notification-service';
import { formatInTimeZone, DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';
import clsx from 'clsx';

export interface NotificationItemProps {
  notification: NotificationRow;
  userTimeZone?: string;
  isProcessing?: boolean;
  onMarkRead: (id: string) => void | Promise<void>;
  onMarkUnread: (id: string) => void | Promise<void>;
  onDismiss: (id: string) => void | Promise<void>;
  onNavigate?: () => void;
}

export function NotificationItem({
  notification,
  userTimeZone = DEFAULT_TIMEZONE,
  isProcessing = false,
  onMarkRead,
  onMarkUnread,
  onDismiss,
  onNavigate,
}: NotificationItemProps) {
  const isUnread = !notification.read_at;

  const formattedTime = formatInTimeZone(notification.created_at, userTimeZone, {
    year: undefined,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const getEntityIcon = () => {
    switch (notification.entity_type) {
      case 'task':
        return (
          <CheckSquare
            className="w-3.5 h-3.5 text-[var(--status-success-text)] shrink-0"
            aria-hidden="true"
          />
        );
      case 'content_item':
        return (
          <Share2
            className="w-3.5 h-3.5 text-[var(--status-editorial-text)] shrink-0"
            aria-hidden="true"
          />
        );
      case 'ai_request':
        return (
          <Sparkles
            className="w-3.5 h-3.5 text-[var(--status-warning-text)] shrink-0"
            aria-hidden="true"
          />
        );
      default:
        return (
          <Bell
            className="w-3.5 h-3.5 text-[var(--status-info-text)] shrink-0"
            aria-hidden="true"
          />
        );
    }
  };

  const getEntityLink = () => {
    if (!notification.entity_id) return null;
    if (notification.entity_type === 'task') {
      return (
        <Link
          href="/tasks"
          onClick={onNavigate}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent-text)] hover:underline mt-1.5"
        >
          <span>Open task</span>
          <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
        </Link>
      );
    }
    if (notification.entity_type === 'content_item') {
      return (
        <Link
          href="/content"
          onClick={onNavigate}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent-text)] hover:underline mt-1.5"
        >
          <span>Open content</span>
          <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
        </Link>
      );
    }
    return null;
  };

  return (
    <div
      data-testid={`notification-item-${notification.id}`}
      data-read-state={isUnread ? 'unread' : 'read'}
      className={clsx(
        'group relative px-3 py-2.5 rounded-[var(--radius-md)] border transition-colors text-xs flex items-start gap-2.5',
        isUnread
          ? 'bg-[var(--bg-surface)] border-[var(--border-strong)] border-l-[2.5px] border-l-[var(--accent)]'
          : 'bg-[var(--bg-surface-muted)]/45 border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]'
      )}
    >
      {/* Child 0: Unread dot indicator (kept in slot 0 for UI structure invariants) */}
      {isUnread ? (
        <span
          className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0 mt-1.5"
          title="Unread notification"
          aria-label="Unread"
        />
      ) : null}

      {/* Child 1: Entity icon */}
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface-subtle)]">
        {getEntityIcon()}
      </div>

      {/* Child 2: Content hierarchy (slot 2 link checked by unit tests) */}
      <div className="flex-1 min-w-0 pr-1">
        <div className="flex items-baseline justify-between gap-2 min-w-0">
          <h4
            className={clsx(
              'text-[12.5px] leading-snug truncate',
              isUnread
                ? 'font-semibold text-[var(--text-primary)]'
                : 'font-medium text-[var(--text-secondary)]'
            )}
          >
            {notification.title}
          </h4>
          <span className="text-[10.5px] text-[var(--text-muted)] font-mono tabular-nums shrink-0 whitespace-nowrap">
            {formattedTime}
          </span>
        </div>

        <p
          className={clsx(
            'mt-1 text-[11.5px] line-clamp-2 leading-relaxed break-words',
            isUnread ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'
          )}
        >
          {notification.message}
        </p>

        {getEntityLink()}
      </div>

      {/* Child 3: Row-level quick actions */}
      <div className="flex items-center gap-0.5 self-start shrink-0">
        {isProcessing ? (
          <div className="inline-flex h-6 w-6 items-center justify-center text-[var(--text-muted)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          </div>
        ) : (
          <>
            {isUnread ? (
              <button
                type="button"
                onClick={() => onMarkRead(notification.id)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] transition-colors"
                title="Mark as read"
                aria-label={`Mark "${notification.title}" as read`}
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onMarkUnread(notification.id)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] transition-colors"
                title="Mark as unread"
                aria-label={`Mark "${notification.title}" as unread`}
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}

            <button
              type="button"
              onClick={() => onDismiss(notification.id)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--status-danger-text)] hover:bg-[var(--bg-surface-muted)] transition-colors"
              title="Dismiss notification"
              aria-label={`Dismiss "${notification.title}"`}
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
