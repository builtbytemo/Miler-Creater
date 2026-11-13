'use client';

import { useState } from 'react';
import {
  Calendar,
  Clock,
  MessageSquare,
  AtSign,
  Archive,
  ArchiveRestore,
  Trash2,
  ArrowUpRight,
} from 'lucide-react';
import type { ContentItemWithMeta } from '@/lib/services/content-service';
import type { SocialPlatform, ContentActionType, ContentStatus } from '@/types/database';
import { formatInTimeZone, DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';

interface ContentCardProps {
  item: ContentItemWithMeta;
  userTimeZone?: string;
  onOpenDetail: (item: ContentItemWithMeta) => void;
  onDelete: (id: string) => Promise<void>;
  onArchiveToggle?: (item: ContentItemWithMeta) => Promise<void>;
}

/** Light + Dark theme-aware platform badges preserving semantic identity. */
export const PLATFORM_CONFIG: Record<
  SocialPlatform,
  { label: string; badgeClass: string; borderClass: string }
> = {
  x: {
    label: 'X (Twitter)',
    badgeClass: 'badge-neutral',
    borderClass: 'hover:border-[var(--border-strong)]',
  },
  linkedin: {
    label: 'LinkedIn',
    badgeClass: 'badge-info',
    borderClass: 'hover:border-[var(--status-info-border)]',
  },
  reddit: {
    label: 'Reddit',
    badgeClass: 'badge-warning',
    borderClass: 'hover:border-[var(--status-warning-border)]',
  },
  threads: {
    label: 'Threads',
    badgeClass: 'badge-editorial',
    borderClass: 'hover:border-[var(--status-editorial-border)]',
  },
};

/** Status badge mapping built on Zahi semantic status tokens. */
export const STATUS_CONFIG: Record<ContentStatus, { label: string; badgeClass: string }> = {
  idea: { label: 'Idea', badgeClass: 'badge-warning' },
  draft: { label: 'Draft', badgeClass: 'badge-neutral' },
  scheduled: { label: 'Scheduled', badgeClass: 'badge-info' },
  publishing: { label: 'Publishing', badgeClass: 'badge-accent' },
  published: { label: 'Published', badgeClass: 'badge-success' },
  failed: { label: 'Failed', badgeClass: 'badge-danger' },
  archived: { label: 'Archived', badgeClass: 'badge-neutral opacity-75' },
};

/** Editorial interaction types. */
export const ACTION_CONFIG: Record<ContentActionType, { label: string }> = {
  post: { label: 'Post' },
  comment: { label: 'Comment' },
  reply: { label: 'Reply' },
  share: { label: 'Share' },
  repost: { label: 'Repost' },
  reaction: { label: 'Reaction' },
};

const PLATFORM_STRIPE_CLASS: Record<SocialPlatform, string> = {
  x: 'border-l-[var(--text-primary)]',
  linkedin: 'border-l-[var(--status-info-text)]',
  reddit: 'border-l-[var(--status-warning-text)]',
  threads: 'border-l-[var(--status-editorial-text)]',
};

export function ContentCard({
  item,
  userTimeZone = DEFAULT_TIMEZONE,
  onOpenDetail,
  onDelete,
  onArchiveToggle,
}: ContentCardProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmingArchive, setIsConfirmingArchive] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const platformInfo = PLATFORM_CONFIG[item.platform] || {
    label: item.platform,
    badgeClass: 'badge-neutral',
    borderClass: 'hover:border-[var(--border-strong)]',
  };

  const statusInfo = STATUS_CONFIG[item.status] || {
    label: item.status,
    badgeClass: 'badge-neutral',
  };

  const actionInfo = ACTION_CONFIG[item.action_type] || { label: item.action_type };
  const stripeClass = PLATFORM_STRIPE_CLASS[item.platform] || 'border-l-[var(--border-strong)]';

  const formattedSchedule = item.scheduled_at
    ? formatInTimeZone(item.scheduled_at, userTimeZone, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
    : null;

  const handleDeleteClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      setIsConfirmingArchive(false);
      return;
    }

    try {
      setIsDeleting(true);
      await onDelete(item.id);
    } finally {
      setIsDeleting(false);
      setIsConfirmingDelete(false);
    }
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsConfirmingDelete(false);
  };

  const handleArchiveClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isConfirmingArchive) {
      setIsConfirmingArchive(true);
      setIsConfirmingDelete(false);
      return;
    }

    try {
      setIsArchiving(true);
      await onArchiveToggle?.(item);
    } finally {
      setIsArchiving(false);
      setIsConfirmingArchive(false);
    }
  };

  const handleCancelArchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsConfirmingArchive(false);
  };

  const handleUnarchiveClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setIsArchiving(true);
      await onArchiveToggle?.(item);
    } finally {
      setIsArchiving(false);
    }
  };

  const targetRef = item.target_reference as {
    url?: string;
    post_id?: string;
    author_handle?: string;
    subreddit?: string;
  } | null;

  return (
    <div
      onClick={() => onOpenDetail(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenDetail(item);
        }
      }}
      className={`surface-card-interactive border-l-[3px] ${stripeClass} ${platformInfo.borderClass} p-4 cursor-pointer space-y-3 group text-left flex flex-col justify-between focus:outline-none focus:ring-2 focus:ring-[var(--accent)]`}
    >
      <div className="space-y-2.5">
        {/* Top Meta: Platform, Action Type, Status, and Quick Actions */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`px-2 py-0.5 rounded-[var(--radius-xs)] text-[10.5px] font-semibold border ${platformInfo.badgeClass}`}
            >
              {platformInfo.label}
            </span>

            <span className="px-2 py-0.5 rounded-[var(--radius-xs)] text-[10.5px] font-medium badge-neutral border">
              {actionInfo.label}
            </span>

            <span
              className={`px-2 py-0.5 rounded-[var(--radius-xs)] text-[10.5px] font-semibold border ${statusInfo.badgeClass}`}
            >
              {statusInfo.label}
            </span>
          </div>

          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {item.status === 'archived' ? (
              <button
                type="button"
                disabled={isArchiving}
                onClick={handleUnarchiveClick}
                className="p-1.5 rounded-[var(--radius-xs)] text-[var(--text-muted)] hover:text-[var(--accent-text)] hover:bg-[var(--bg-surface-muted)] transition-colors sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
                title="Unarchive content item"
                aria-label="Unarchive content item"
              >
                <ArchiveRestore className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            ) : isConfirmingArchive ? (
              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-[var(--status-warning-text)] font-medium text-[10.5px]">
                  Archive?
                </span>
                <button
                  type="button"
                  disabled={isArchiving}
                  onClick={handleArchiveClick}
                  className="px-2 py-0.5 rounded-[var(--radius-xs)] badge-warning border font-semibold text-[10.5px] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {isArchiving ? '...' : 'Yes'}
                </button>
                <button
                  type="button"
                  onClick={handleCancelArchive}
                  className="px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--bg-surface-muted)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] text-[10.5px] transition-colors"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleArchiveClick}
                className="p-1.5 rounded-[var(--radius-xs)] text-[var(--text-muted)] hover:text-[var(--status-warning-text)] hover:bg-[var(--bg-surface-muted)] transition-colors sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                title="Archive content item"
                aria-label="Archive content item"
              >
                <Archive className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}

            {isConfirmingDelete ? (
              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-[var(--status-danger-text)] font-medium text-[10.5px]">
                  Delete?
                </span>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleDeleteClick}
                  className="px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--status-danger-text)] text-white font-semibold text-[10.5px] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {isDeleting ? '...' : 'Yes'}
                </button>
                <button
                  type="button"
                  onClick={handleCancelDelete}
                  className="px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--bg-surface-muted)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] text-[10.5px] transition-colors"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleDeleteClick}
                className="p-1.5 rounded-[var(--radius-xs)] text-[var(--text-muted)] hover:text-[var(--status-danger-text)] hover:bg-[var(--bg-surface-muted)] transition-colors sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                title="Delete content item"
                aria-label="Delete content item"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}

            <ArrowUpRight
              className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--accent-text)] transition-colors ml-0.5"
              aria-hidden="true"
            />
          </div>
        </div>

        {/* Title & Body Preview */}
        <div className="space-y-1 min-w-0">
          {item.title ? (
            <h3 className="text-[13.5px] font-semibold text-[var(--text-primary)] line-clamp-1 group-hover:text-[var(--accent-text)] transition-colors">
              {item.title}
            </h3>
          ) : null}
          {item.body ? (
            <p className="text-xs text-[var(--text-secondary)] line-clamp-3 leading-relaxed whitespace-pre-line">
              {item.body}
            </p>
          ) : (
            <p className="text-xs text-[var(--text-muted)] italic">No content body</p>
          )}
        </div>

        {/* Target Reference context badge if present */}
        {targetRef && (targetRef.url || targetRef.post_id || targetRef.author_handle) && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] bg-[var(--bg-surface-muted)] px-2.5 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] truncate font-mono">
            <MessageSquare className="w-3 h-3 text-[var(--text-muted)] shrink-0" aria-hidden="true" />
            <span className="text-[var(--text-muted)]">Target:</span>
            {targetRef.author_handle && <span>{targetRef.author_handle}</span>}
            {targetRef.subreddit && <span>r/{targetRef.subreddit}</span>}
            {targetRef.post_id && <span className="text-[var(--text-muted)]">#{targetRef.post_id}</span>}
          </div>
        )}
      </div>

      {/* Bottom Metadata: Schedule, Handle, Tags, Project */}
      <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] flex-wrap">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          {formattedSchedule ? (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--accent-text)] font-mono tabular-nums font-medium">
              <Calendar className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{formattedSchedule}</span>
              {item.duration_minutes ? (
                <span className="text-[var(--text-muted)] inline-flex items-center gap-0.5">
                  <Clock className="w-3 h-3" aria-hidden="true" />
                  {item.duration_minutes}m
                </span>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] font-mono">
              <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Unscheduled</span>
            </div>
          )}

          {item.social_account && (
            <div className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] font-mono">
              <AtSign className="w-3 h-3 text-[var(--text-muted)]" aria-hidden="true" />
              <span>{item.social_account.account_handle.replace(/^@/, '')}</span>
            </div>
          )}

          {item.project && (
            <div className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: item.project.color || 'var(--accent)' }}
              />
              <span className="truncate max-w-[120px]">{item.project.name}</span>
            </div>
          )}
        </div>

        {item.tags && item.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {item.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10.5px] px-1.5 py-0.5 rounded-[var(--radius-xs)] bg-[var(--bg-surface-muted)] border border-[var(--border-subtle)] text-[var(--text-muted)] font-mono"
              >
                #{tag}
              </span>
            ))}
            {item.tags.length > 3 && (
              <span className="text-[10.5px] text-[var(--text-muted)] font-mono">
                +{item.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
