'use client';

import { useState, useMemo } from 'react';
import {
  Inbox,
  Search,
  CalendarPlus,
  X,
  AtSign,
  Folder,
  Sparkles,
  FileEdit,
  Share2,
} from 'lucide-react';
import type { ContentItemWithMeta } from '@/lib/services/content-service';
import type { SocialPlatform } from '@/types/database';
import { ACTION_CONFIG } from '@/components/content/ContentCard';
import {
  resolveCalendarItemColor,
  type CalendarItemColorMap,
} from '@/lib/calendar/item-colors';

interface UnscheduledContentDrawerProps {
  items: ContentItemWithMeta[];
  isOpen: boolean;
  itemColorMap?: CalendarItemColorMap;
  onClose: () => void;
  onScheduleItem: (item: ContentItemWithMeta) => void;
  onOpenDetail: (item: ContentItemWithMeta) => void;
}

const PLATFORM_PILL_MAP: Record<SocialPlatform, { label: string; badgeClass: string }> = {
  x: {
    label: 'X (Twitter)',
    badgeClass: 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border-[var(--border-strong)]',
  },
  linkedin: {
    label: 'LinkedIn',
    badgeClass: 'badge-info',
  },
  reddit: {
    label: 'Reddit',
    badgeClass: 'badge-warning',
  },
  threads: {
    label: 'Threads',
    badgeClass: 'badge-neutral',
  },
};

export function UnscheduledContentDrawer({
  items,
  isOpen,
  itemColorMap,
  onClose,
  onScheduleItem,
  onOpenDetail,
}: UnscheduledContentDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<SocialPlatform | ''>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'idea' | 'draft'>('all');

  // Strict Backlog Filter: Only include unscheduled items that are actively in 'idea' or 'draft' status.
  const activeUnscheduledItems = useMemo(() => {
    return items.filter(
      (item) =>
        item.scheduled_at === null && (item.status === 'idea' || item.status === 'draft')
    );
  }, [items]);

  const filteredItems = useMemo(() => {
    return activeUnscheduledItems.filter((item) => {
      if (platformFilter && item.platform !== platformFilter) return false;
      if (statusFilter === 'idea' && item.status !== 'idea') return false;
      if (statusFilter === 'draft' && item.status !== 'draft') return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = item.title?.toLowerCase().includes(q);
        const matchBody = item.body.toLowerCase().includes(q);
        const matchTags = item.tags.some((t) => t.toLowerCase().includes(q));
        if (!matchTitle && !matchBody && !matchTags) return false;
      }

      return true;
    });
  }, [activeUnscheduledItems, platformFilter, statusFilter, searchQuery]);

  const ideaCount = useMemo(
    () => activeUnscheduledItems.filter((i) => i.status === 'idea').length,
    [activeUnscheduledItems]
  );
  const draftCount = useMemo(
    () => activeUnscheduledItems.filter((i) => i.status === 'draft').length,
    [activeUnscheduledItems]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/45 backdrop-blur-xs"
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md h-full bg-[var(--bg-surface)] border-l border-[var(--border-default)] shadow-2xl flex flex-col overflow-hidden"
        aria-label="Unscheduled content backlog"
        data-testid="unscheduled-content-drawer"
      >
      {/* Drawer Header */}
      <div className="px-4 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]/55 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] shrink-0">
            <Inbox className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <span>Unscheduled Backlog</span>
              <span className="px-2 py-0.2 rounded-full text-[11px] font-mono font-semibold bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                {activeUnscheduledItems.length}
              </span>
            </h3>
            <p className="text-[11px] text-[var(--text-tertiary)] truncate">
              {ideaCount} ideas · {draftCount} drafts ready to schedule
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          aria-label="Close unscheduled drawer"
          data-testid="close-unscheduled-drawer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Filters & Search */}
      <div className="p-3.5 border-b border-[var(--border-subtle)] space-y-2.5 bg-[var(--bg-surface)]">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[var(--text-tertiary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search unscheduled drafts & ideas..."
            aria-label="Search unscheduled backlog"
            className="w-full pl-8 pr-3 py-1.5 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-full text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--border-strong)]"
          />
        </div>

        {/* Status Pills & Platform Select */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1 p-0.5 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                statusFilter === 'all'
                  ? 'bg-[var(--text-primary)] text-[var(--bg-canvas)] font-semibold'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              All ({activeUnscheduledItems.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('idea')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium flex items-center gap-1 transition-colors ${
                statusFilter === 'idea'
                  ? 'bg-[var(--text-primary)] text-[var(--bg-canvas)] font-semibold'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Sparkles className="w-2.5 h-2.5" />
              Ideas ({ideaCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('draft')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium flex items-center gap-1 transition-colors ${
                statusFilter === 'draft'
                  ? 'bg-[var(--text-primary)] text-[var(--bg-canvas)] font-semibold'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <FileEdit className="w-2.5 h-2.5" />
              Drafts ({draftCount})
            </button>
          </div>

          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value as SocialPlatform | '')}
            aria-label="Filter unscheduled by platform"
            className="px-2.5 py-1 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-full text-[11px] font-medium text-[var(--text-secondary)] focus:outline-none focus:border-[var(--border-strong)]"
          >
            <option value="">All Platforms</option>
            <option value="x">X (Twitter)</option>
            <option value="linkedin">LinkedIn</option>
            <option value="reddit">Reddit</option>
            <option value="threads">Threads</option>
          </select>
        </div>
      </div>

      {/* Unscheduled Items List */}
      <div className="flex-1 p-3.5 space-y-2.5 overflow-y-auto bg-[var(--bg-surface)]">
        {filteredItems.length === 0 ? (
          <div className="py-10 px-4 text-center rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--bg-subtle)]/35 space-y-1.5">
            <Inbox className="w-6 h-6 text-[var(--text-tertiary)] mx-auto mb-1" />
            <p className="text-xs font-semibold text-[var(--text-secondary)]">
              {activeUnscheduledItems.length === 0
                ? 'No unscheduled items in backlog'
                : 'No items match your filters'}
            </p>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              {activeUnscheduledItems.length === 0
                ? 'All ideas and drafts have been scheduled onto the calendar.'
                : 'Try clearing your search or switching platform filters.'}
            </p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const colorToken = resolveCalendarItemColor('content', item, itemColorMap);
            const platformInfo = PLATFORM_PILL_MAP[item.platform] || {
              label: item.platform,
              badgeClass: 'badge-neutral',
            };
            const actionInfo = ACTION_CONFIG[item.action_type] || {
              label: item.action_type,
            };

            return (
              <div
                key={item.id}
                onClick={() => onOpenDetail(item)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenDetail(item);
                  }
                }}
                data-testid={`unscheduled-item-${item.id}`}
                data-cal-color={colorToken.name}
                className={`p-3.5 rounded-2xl border border-l-4 transition-all cursor-pointer space-y-2 group text-left ${colorToken.colorClass} cal-card-surface`}
              >
                {/* Badges Row */}
                <div className="flex items-center justify-between gap-1.5 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className="w-2 h-2 rounded-full shrink-0 cal-swatch-dot"
                      aria-hidden="true"
                    />
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${platformInfo.badgeClass}`}
                    >
                      <Share2 className="w-2.5 h-2.5 shrink-0" />
                      {platformInfo.label}
                    </span>
                    <span className="text-[10px] font-medium text-[var(--text-tertiary)]">
                      {actionInfo.label}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        item.status === 'idea' ? 'badge-warning' : 'badge-neutral'
                      }`}
                    >
                      {item.status === 'idea' ? 'Idea' : 'Draft'}
                    </span>
                  </div>

                  {/* Quick Schedule Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onScheduleItem(item);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90 transition-opacity shadow-xs"
                    title="Schedule onto calendar"
                  >
                    <CalendarPlus className="w-3 h-3" />
                    <span>Schedule</span>
                  </button>
                </div>

                {/* Title & Body Preview */}
                <div className="space-y-0.5">
                  {item.title && (
                    <h4 className="text-xs font-semibold text-[var(--text-primary)] line-clamp-1 group-hover:underline">
                      {item.title}
                    </h4>
                  )}
                  <p className="text-[11px] text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
                    {item.body || 'No content body'}
                  </p>
                </div>

                {/* Account & Project Metadata */}
                {(item.social_account || item.project) && (
                  <div className="flex items-center gap-3 pt-1.5 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-tertiary)]">
                    {item.social_account && (
                      <span className="flex items-center gap-0.5 truncate max-w-[120px] font-mono">
                        <AtSign className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">
                          {item.social_account.account_handle.replace(/^@/, '')}
                        </span>
                      </span>
                    )}
                    {item.project && (
                      <span className="flex items-center gap-1 truncate max-w-[120px]">
                        <Folder className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{item.project.name}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      </aside>
    </div>
  );
}
