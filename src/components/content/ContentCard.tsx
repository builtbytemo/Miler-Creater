'use client';

import { useState } from 'react';
import {
  Calendar,
  Clock,
  ExternalLink,
  MessageSquare,
  Share2,
  Trash2,
  Tag,
  AtSign,
  AlertCircle,
  Folder,
  Archive,
  ArchiveRestore,
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

// Brand-consistent platform styling
export const PLATFORM_CONFIG: Record<
  SocialPlatform,
  { label: string; badgeClass: string; borderClass: string }
> = {
  x: {
    label: 'X (Twitter)',
    badgeClass: 'bg-neutral-800 text-neutral-100 border-neutral-700',
    borderClass: 'hover:border-neutral-600',
  },
  linkedin: {
    label: 'LinkedIn',
    badgeClass: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    borderClass: 'hover:border-sky-800/60',
  },
  reddit: {
    label: 'Reddit',
    badgeClass: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    borderClass: 'hover:border-orange-800/60',
  },
  threads: {
    label: 'Threads',
    badgeClass: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    borderClass: 'hover:border-purple-800/60',
  },
};

// Status styling
export const STATUS_CONFIG: Record<
  ContentStatus,
  { label: string; badgeClass: string }
> = {
  idea: { label: 'Idea', badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  draft: { label: 'Draft', badgeClass: 'bg-neutral-800 text-neutral-300 border-neutral-700' },
  scheduled: { label: 'Scheduled', badgeClass: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  publishing: { label: 'Publishing', badgeClass: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  published: { label: 'Published', badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  failed: { label: 'Failed', badgeClass: 'bg-red-500/10 text-red-400 border-red-500/20' },
  archived: { label: 'Archived', badgeClass: 'bg-neutral-900 text-neutral-500 border-neutral-800' },
};

// Action type formatting
export const ACTION_CONFIG: Record<ContentActionType, { label: string }> = {
  post: { label: 'Post' },
  comment: { label: 'Comment' },
  reply: { label: 'Reply' },
  share: { label: 'Share' },
  repost: { label: 'Repost' },
  reaction: { label: 'Reaction' },
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
    badgeClass: 'bg-neutral-800 text-neutral-300 border-neutral-700',
    borderClass: 'hover:border-neutral-700',
  };

  const statusInfo = STATUS_CONFIG[item.status] || {
    label: item.status,
    badgeClass: 'bg-neutral-800 text-neutral-300 border-neutral-700',
  };

  const actionInfo = ACTION_CONFIG[item.action_type] || { label: item.action_type };

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

  // Structured target reference preview
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
      className={`p-4 rounded-xl bg-neutral-950 border border-neutral-800/80 transition-all cursor-pointer space-y-3 group text-left ${platformInfo.borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
    >
      {/* Top Meta: Platform, Action Type, Status, and Actions */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Platform Badge */}
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${platformInfo.badgeClass}`}
          >
            {platformInfo.label}
          </span>

          {/* Action Type Pill */}
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-neutral-900 border border-neutral-800 text-neutral-300">
            {actionInfo.label}
          </span>

          {/* Status Badge */}
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${statusInfo.badgeClass}`}
          >
            {statusInfo.label}
          </span>
        </div>

        {/* Action Controls: Archive/Unarchive & Delete */}
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {/* Archive / Unarchive */}
          {item.status === 'archived' ? (
            <button
              type="button"
              disabled={isArchiving}
              onClick={handleUnarchiveClick}
              className="p-1 rounded text-neutral-400 hover:text-blue-400 hover:bg-neutral-900 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
              title="Unarchive content item"
              aria-label="Unarchive content item"
            >
              <ArchiveRestore className="w-3.5 h-3.5" />
            </button>
          ) : isConfirmingArchive ? (
            <div className="flex items-center gap-1 text-[11px]">
              <span className="text-amber-400 text-[10px]">Archive?</span>
              <button
                type="button"
                disabled={isArchiving}
                onClick={handleArchiveClick}
                className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-medium text-[10px] transition-colors disabled:opacity-50"
              >
                {isArchiving ? '...' : 'Yes'}
              </button>
              <button
                type="button"
                onClick={handleCancelArchive}
                className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] transition-colors"
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleArchiveClick}
              className="p-1 rounded text-neutral-500 hover:text-amber-400 hover:bg-neutral-900 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              title="Archive content item"
              aria-label="Archive content item"
            >
              <Archive className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Delete Control */}
          {isConfirmingDelete ? (
            <div className="flex items-center gap-1 text-[11px]">
              <span className="text-red-400 text-[10px]">Delete?</span>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDeleteClick}
                className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white font-medium text-[10px] transition-colors disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Yes'}
              </button>
              <button
                type="button"
                onClick={handleCancelDelete}
                className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] transition-colors"
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleDeleteClick}
              className="p-1 rounded text-neutral-500 hover:text-red-400 hover:bg-neutral-900 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              title="Delete content item"
              aria-label="Delete content item"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Title & Body Preview */}
      <div className="space-y-1">
        {item.title ? (
          <h3 className="text-sm font-semibold text-neutral-100 line-clamp-1 group-hover:text-blue-400 transition-colors">
            {item.title}
          </h3>
        ) : null}
        {item.body ? (
          <p className="text-xs text-neutral-400 line-clamp-3 leading-relaxed whitespace-pre-line">
            {item.body}
          </p>
        ) : (
          <p className="text-xs text-neutral-600 italic">No content body</p>
        )}
      </div>

      {/* Target Reference context badge if present */}
      {targetRef && (targetRef.url || targetRef.post_id || targetRef.author_handle) && (
        <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 bg-neutral-900/60 px-2 py-1 rounded border border-neutral-800/60 truncate font-mono">
          <MessageSquare className="w-3 h-3 text-neutral-500 shrink-0" />
          <span className="text-neutral-500">Target:</span>
          {targetRef.author_handle && <span>{targetRef.author_handle}</span>}
          {targetRef.subreddit && <span>r/{targetRef.subreddit}</span>}
          {targetRef.post_id && <span className="text-neutral-500">#{targetRef.post_id}</span>}
        </div>
      )}

      {/* Bottom Metadata: Schedule, Handle, Tags, Project */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-neutral-900 text-xs text-neutral-400 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Scheduled Date/Time or Unscheduled Indicator */}
          {formattedSchedule ? (
            <div className="flex items-center gap-1.5 text-[11px] text-blue-400 font-medium">
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              <span>{formattedSchedule}</span>
              {item.duration_minutes ? (
                <span className="text-neutral-500 flex items-center gap-0.5">
                  <Clock className="w-3 h-3" />
                  {item.duration_minutes}m
                </span>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 font-mono">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>Unscheduled</span>
            </div>
          )}

          {/* Social Account Handle */}
          {item.social_account && (
            <div className="flex items-center gap-1 text-[11px] text-neutral-400">
              <AtSign className="w-3 h-3 text-neutral-500" />
              <span>{item.social_account.account_handle}</span>
            </div>
          )}

          {/* Project Pill */}
          {item.project && (
            <div className="flex items-center gap-1 text-[11px] text-neutral-300">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: item.project.color || '#2563eb' }}
              />
              <span className="truncate max-w-[120px]">{item.project.name}</span>
            </div>
          )}
        </div>

        {/* Tags */}
        {item.tags && item.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {item.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-400"
              >
                #{tag}
              </span>
            ))}
            {item.tags.length > 3 && (
              <span className="text-[10px] text-neutral-500">+{item.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
