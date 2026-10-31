'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  X,
  Calendar as CalendarIcon,
  Search,
  Lightbulb,
  FileText,
  Clock,
  ExternalLink,
  Plus,
  AtSign,
  Tag,
} from 'lucide-react';
import type { ContentItemWithMeta } from '@/lib/services/content-service';
import type { SocialPlatform } from '@/types/database';
import { PLATFORM_CONFIG, STATUS_CONFIG, ACTION_CONFIG } from '@/components/content/ContentCard';
import clsx from 'clsx';

interface UnscheduledContentDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: ContentItemWithMeta[];
  userTimeZone: string;
  onSelectItem: (item: ContentItemWithMeta) => void;
  onScheduleItem: (item: ContentItemWithMeta) => void;
  onCaptureNewIdea?: () => void;
}

type TabFilter = 'all' | 'ideas' | 'drafts';

export function UnscheduledContentDrawer({
  isOpen,
  onClose,
  items,
  userTimeZone,
  onSelectItem,
  onScheduleItem,
  onCaptureNewIdea,
}: UnscheduledContentDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');

  if (!isOpen) return null;

  // Filter strictly for active unscheduled backlog items:
  // Must have scheduled_at === null, excluding archived and automated lifecycle statuses (publishing/published/failed)
  const activeUnscheduled = items.filter(
    (item) => item.scheduled_at === null && (item.status === 'idea' || item.status === 'draft')
  );

  const ideasCount = activeUnscheduled.filter((item) => item.status === 'idea').length;
  const draftsCount = activeUnscheduled.filter((item) => item.status === 'draft').length;

  // Apply filters
  const filteredItems = activeUnscheduled.filter((item) => {
    // Tab filter: strictly 'idea' for ideas, strictly 'draft' for drafts
    if (activeTab === 'ideas' && item.status !== 'idea') return false;
    if (activeTab === 'drafts' && item.status !== 'draft') return false;

    // Platform filter
    if (selectedPlatform !== 'all' && item.platform !== selectedPlatform) return false;

    // Search query
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase().trim();
      const titleMatch = item.title?.toLowerCase().includes(q) || false;
      const bodyMatch = item.body?.toLowerCase().includes(q) || false;
      const tagMatch = item.tags?.some((t) => t.toLowerCase().includes(q)) || false;
      if (!titleMatch && !bodyMatch && !tagMatch) return false;
    }

    return true;
  });

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-neutral-950 border-l border-neutral-800 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-modal="true"
        aria-label="Unscheduled Content Backlog"
      >
        {/* Drawer Header */}
        <div className="p-4 sm:p-5 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-sm font-bold text-white">Unscheduled Backlog</h2>
              <p className="text-[11px] text-neutral-400">
                Ideas and drafts without a scheduled time.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-neutral-900 border border-neutral-800 text-neutral-300">
              {activeUnscheduled.length}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
              aria-label="Close drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Filters: All, Ideas, Drafts */}
        <div className="px-4 sm:px-5 pt-3 pb-2 border-b border-neutral-800/80 bg-neutral-900/40">
          <div className="flex items-center gap-1.5 p-1 rounded-lg bg-neutral-900 border border-neutral-800 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={clsx(
                'flex-1 py-1.5 px-2 rounded-md font-medium transition-colors text-center',
                activeTab === 'all'
                  ? 'bg-neutral-800 text-white shadow-xs'
                  : 'text-neutral-400 hover:text-neutral-200'
              )}
            >
              All ({activeUnscheduled.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ideas')}
              className={clsx(
                'flex-1 py-1.5 px-2 rounded-md font-medium transition-colors text-center flex items-center justify-center gap-1',
                activeTab === 'ideas'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-neutral-400 hover:text-neutral-200'
              )}
            >
              <Lightbulb className="w-3 h-3 text-amber-400" />
              <span>Ideas ({ideasCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('drafts')}
              className={clsx(
                'flex-1 py-1.5 px-2 rounded-md font-medium transition-colors text-center flex items-center justify-center gap-1',
                activeTab === 'drafts'
                  ? 'bg-neutral-800 text-white shadow-xs'
                  : 'text-neutral-400 hover:text-neutral-200'
              )}
            >
              <FileText className="w-3 h-3 text-neutral-400" />
              <span>Drafts ({draftsCount})</span>
            </button>
          </div>

          {/* Search & Platform Filter Row */}
          <div className="flex items-center gap-2 mt-3 mb-1">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search unscheduled..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 text-xs"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 focus:outline-none focus:border-blue-500"
              aria-label="Filter by platform"
            >
              <option value="all">All Channels</option>
              <option value="linkedin">LinkedIn</option>
              <option value="reddit">Reddit</option>
              <option value="threads">Threads</option>
              <option value="x">X</option>
            </select>
          </div>
        </div>

        {/* Backlog Item List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5">
          {filteredItems.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center p-6 text-center border border-dashed border-neutral-800 rounded-xl">
              <Clock className="w-8 h-8 text-neutral-600 mb-2" />
              <p className="text-xs font-semibold text-neutral-300 mb-1">
                {searchQuery
                  ? 'No matching unscheduled items'
                  : activeTab === 'ideas'
                    ? 'No unscheduled ideas'
                    : activeTab === 'drafts'
                      ? 'No unscheduled drafts'
                      : 'No unscheduled items'}
              </p>
              <p className="text-[11px] text-neutral-500 max-w-xs mb-3">
                {searchQuery
                  ? 'Try clearing your search query or platform filter.'
                  : 'Capture ideas or compose drafts to schedule them onto your calendar.'}
              </p>
              {onCaptureNewIdea && (
                <button
                  type="button"
                  onClick={onCaptureNewIdea}
                  className="px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Capture New Idea</span>
                </button>
              )}
            </div>
          ) : (
            filteredItems.map((item) => {
              const platformInfo = PLATFORM_CONFIG[item.platform];
              const statusInfo = STATUS_CONFIG[item.status];
              const actionInfo = ACTION_CONFIG[item.action_type];

              return (
                <div
                  key={item.id}
                  data-testid={`unscheduled-item-${item.id}`}
                  className="p-3.5 rounded-xl border border-neutral-800 bg-neutral-900/70 hover:border-neutral-700 transition-all space-y-2.5 group"
                >
                  {/* Top Metadata */}
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={clsx(
                          'px-2 py-0.5 rounded text-[10px] font-medium border',
                          platformInfo?.badgeClass || 'bg-neutral-800 text-neutral-300'
                        )}
                      >
                        {platformInfo?.label.split(' ')[0] || item.platform}
                      </span>

                      <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 text-[10px] font-mono">
                        {actionInfo?.label || item.action_type}
                      </span>

                      <span
                        className={clsx(
                          'px-1.5 py-0.5 rounded border text-[10px] font-mono',
                          statusInfo?.badgeClass || 'bg-neutral-800 text-neutral-300'
                        )}
                      >
                        {statusInfo?.label || item.status}
                      </span>
                    </div>

                    {item.social_account && (
                      <span className="text-[10px] text-neutral-400 flex items-center gap-0.5 truncate max-w-[120px]">
                        <AtSign className="w-2.5 h-2.5 text-neutral-500" />
                        <span className="truncate">{item.social_account.account_handle}</span>
                      </span>
                    )}
                  </div>

                  {/* Title & Body */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectItem(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectItem(item);
                      }
                    }}
                    className="cursor-pointer text-left focus:outline-none"
                  >
                    <h3 className="text-xs font-semibold text-neutral-200 hover:text-white transition-colors line-clamp-2">
                      {item.title || item.body || 'Untitled Content'}
                    </h3>
                    {item.title && item.body && (
                      <p className="text-[11px] text-neutral-400 line-clamp-2 mt-1">
                        {item.body}
                      </p>
                    )}
                  </div>

                  {/* Footer Actions: Inspect & Schedule */}
                  <div className="flex items-center justify-between pt-1 border-t border-neutral-800/60 text-xs">
                    <button
                      type="button"
                      onClick={() => onSelectItem(item)}
                      className="text-neutral-400 hover:text-neutral-200 text-[11px] font-medium transition-colors"
                    >
                      Inspect / Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => onScheduleItem(item)}
                      className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium flex items-center gap-1 transition-colors shadow-xs"
                      title="Set a scheduled date and time"
                    >
                      <CalendarIcon className="w-3 h-3" />
                      <span>Schedule</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Drawer Footer Link to Content Workspace */}
        <div className="p-3.5 border-t border-neutral-800 bg-neutral-900/60 flex items-center justify-between text-xs">
          <span className="text-[11px] text-neutral-500">Need full backlog management?</span>
          <Link
            href="/content"
            className="text-blue-400 hover:text-blue-300 font-medium inline-flex items-center gap-1 text-[11px]"
          >
            <span>Open Content Workspace</span>
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
