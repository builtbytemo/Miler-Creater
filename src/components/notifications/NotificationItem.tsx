'use client';

import Link from 'next/link';
import {
  Bell,
  Check,
  CheckSquare,
  ExternalLink,
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
}

export function NotificationItem({
  notification,
  userTimeZone = DEFAULT_TIMEZONE,
  isProcessing = false,
  onMarkRead,
  onMarkUnread,
  onDismiss,
}: NotificationItemProps) {
  const isUnread = !notification.read_at;

  const formattedTime = formatInTimeZone(notification.created_at, userTimeZone, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const getEntityIcon = () => {
    switch (notification.entity_type) {
      case 'task':
        return <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />;
      case 'content_item':
        return <Share2 className="w-4 h-4 text-purple-400 shrink-0" aria-hidden="true" />;
      case 'ai_request':
        return <Sparkles className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />;
      default:
        return <Bell className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />;
    }
  };

  const getEntityLink = () => {
    if (!notification.entity_id) return null;
    if (notification.entity_type === 'task') {
      return (
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 hover:underline mt-1"
        >
          <span>View Task</span>
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </Link>
      );
    }
    if (notification.entity_type === 'content_item') {
      return (
        <Link
          href="/content"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-400 hover:text-purple-300 hover:underline mt-1"
        >
          <span>View Content</span>
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </Link>
      );
    }
    return null;
  };

  return (
    <div
      data-testid={`notification-item-${notification.id}`}
      className={clsx(
        'group relative p-3.5 rounded-lg border transition-all text-xs flex gap-3',
        isUnread
          ? 'bg-neutral-900 border-neutral-700/80 shadow-xs'
          : 'bg-neutral-950/60 border-neutral-800/60 opacity-85 hover:opacity-100'
      )}
    >
      {/* Unread dot indicator */}
      {isUnread && (
        <span
          className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1 shadow-xs shadow-blue-500/50"
          title="Unread notification"
          aria-label="Unread"
        />
      )}

      {/* Entity icon */}
      <div className="mt-0.5">{getEntityIcon()}</div>

      {/* Content */}
      <div className="flex-1 min-w-0 pr-1">
        <div className="flex items-baseline justify-between gap-2">
          <h4
            className={clsx(
              'leading-snug truncate',
              isUnread ? 'font-semibold text-neutral-100' : 'font-medium text-neutral-300'
            )}
          >
            {notification.title}
          </h4>
          <span className="text-[10px] text-neutral-400 font-mono shrink-0 whitespace-nowrap">
            {formattedTime}
          </span>
        </div>

        <p className="text-neutral-400 mt-1 line-clamp-2 leading-relaxed break-words">
          {notification.message}
        </p>

        {getEntityLink()}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 self-start shrink-0 ml-1">
        {isProcessing ? (
          <div className="p-1 text-neutral-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          </div>
        ) : (
          <>
            {isUnread ? (
              <button
                type="button"
                onClick={() => onMarkRead(notification.id)}
                className="p-1 rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                title="Mark as read"
                aria-label={`Mark "${notification.title}" as read`}
              >
                <Check className="w-3.5 h-3.5 text-neutral-300 hover:text-white" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onMarkUnread(notification.id)}
                className="p-1 rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                title="Mark as unread"
                aria-label={`Mark "${notification.title}" as unread`}
              >
                <RotateCcw className="w-3.5 h-3.5 text-neutral-400 hover:text-white" />
              </button>
            )}

            <button
              type="button"
              onClick={() => onDismiss(notification.id)}
              className="p-1 rounded text-neutral-400 hover:text-rose-400 hover:bg-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-500"
              title="Dismiss notification"
              aria-label={`Dismiss "${notification.title}"`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
