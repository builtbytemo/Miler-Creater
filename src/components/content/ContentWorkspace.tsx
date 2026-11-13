'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  Plus,
  X,
  Lightbulb,
  Calendar,
  FileText,
  CheckCircle2,
  AtSign,
  Archive,
} from 'lucide-react';
import type { ContentStatus } from '@/types/database';
import type { ContentItemWithMeta, SocialAccountRow } from '@/lib/services/content-service';
import { deleteContentItemAction, updateContentItemAction } from '@/lib/actions/content-actions';
import { ContentCard } from './ContentCard';
import { CreateContentModal } from './CreateContentModal';
import { ContentDetailModal } from './ContentDetailModal';
import { CreateSocialAccountModal } from './CreateSocialAccountModal';
import { ZahiDiamondMark } from '@/components/brand/ZahiBrand';
import { EmptyState } from '@/components/ui/EmptyState';

interface ProjectOption {
  id: string;
  name: string;
  color: string | null;
}

interface ContentWorkspaceProps {
  initialItems: ContentItemWithMeta[];
  initialIdeas: ContentItemWithMeta[];
  workspaceId: string;
  socialAccounts: SocialAccountRow[];
  projects: ProjectOption[];
  userTimeZone: string;
  initialTab?: string;
  initialPlatform?: string;
  initialStatusFilter?: string;
  initialContentId?: string;
}

type TabKey = 'all' | 'ideas' | 'drafts' | 'scheduled' | 'archived';

const VALID_TABS: readonly TabKey[] = ['all', 'ideas', 'drafts', 'scheduled', 'archived'];
const VALID_PLATFORMS = new Set([
  'x',
  'linkedin',
  'reddit',
  'threads',
  'instagram',
  'youtube',
  'tiktok',
  'newsletter',
  'blog',
  'other',
]);
const VALID_CONTENT_STATUSES = new Set(['idea', 'draft', 'scheduled', 'published', 'archived']);

export function ContentWorkspace({
  initialItems,
  initialIdeas,
  workspaceId,
  socialAccounts: initialSocialAccounts,
  projects,
  userTimeZone,
  initialTab,
  initialPlatform,
  initialStatusFilter,
  initialContentId,
}: ContentWorkspaceProps) {
  const initialMerged = useMemo(() => {
    const map = new Map<string, ContentItemWithMeta>();
    initialItems.filter((i) => i.created_from !== 'calendar').forEach((i) => map.set(i.id, i));
    initialIdeas.filter((i) => i.created_from !== 'calendar').forEach((i) => map.set(i.id, i));
    return Array.from(map.values());
  }, [initialItems, initialIdeas]);

  const [items, setItems] = useState<ContentItemWithMeta[]>(initialMerged);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccountRow[]>(initialSocialAccounts);

  // Tab & Filters
  const [activeTab, setActiveTab] = useState<TabKey>(() =>
    initialTab && VALID_TABS.includes(initialTab as TabKey) ? (initialTab as TabKey) : 'all'
  );
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>(() =>
    initialPlatform && VALID_PLATFORMS.has(initialPlatform) ? initialPlatform : 'all'
  );
  const [statusFilter, setStatusFilter] = useState<string>(() =>
    initialStatusFilter && VALID_CONTENT_STATUSES.has(initialStatusFilter)
      ? initialStatusFilter
      : 'all'
  );
  const [actionTypeFilter, setActionTypeFilter] = useState<string>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createDefaultStatus, setCreateDefaultStatus] = useState<ContentStatus>('idea');
  const [isCreateAccountOpen, setIsCreateAccountOpen] = useState(false);
  const [selectedContentDetail, setSelectedContentDetail] = useState<ContentItemWithMeta | null>(
    () => (initialContentId ? initialMerged.find((item) => item.id === initialContentId) ?? null : null)
  );

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [prevInitialMerged, setPrevInitialMerged] = useState(initialMerged);
  if (prevInitialMerged !== initialMerged) {
    setPrevInitialMerged(initialMerged);
    setItems(initialMerged);
  }

  const [prevSocialAccounts, setPrevSocialAccounts] = useState(initialSocialAccounts);
  if (prevSocialAccounts !== initialSocialAccounts) {
    setPrevSocialAccounts(initialSocialAccounts);
    setSocialAccounts(initialSocialAccounts);
  }

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4500);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const resetFilters = () => {
    setSearch('');
    setPlatformFilter('all');
    setStatusFilter('all');
    setActionTypeFilter('all');
    setAccountFilter('all');
  };

  // Global keyboard shortcuts ('/' search, 'c' create content, 'i' capture idea, '1'-'5' tabs)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isCreateOpen || isCreateAccountOpen || Boolean(selectedContentDetail)) return;

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

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setCreateDefaultStatus('draft');
        setIsCreateOpen(true);
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        setCreateDefaultStatus('idea');
        setIsCreateOpen(true);
      } else if (e.key === '1') {
        resetFilters();
        setActiveTab('all');
      } else if (e.key === '2') {
        resetFilters();
        setActiveTab('ideas');
      } else if (e.key === '3') {
        resetFilters();
        setActiveTab('drafts');
      } else if (e.key === '4') {
        resetFilters();
        setActiveTab('scheduled');
      } else if (e.key === '5') {
        resetFilters();
        setActiveTab('archived');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCreateOpen, isCreateAccountOpen, selectedContentDetail]);

  const stats = useMemo(() => {
    const ideaInboxCount = items.filter((i) => i.status === 'idea' && !i.scheduled_at).length;
    const scheduledCount = items.filter(
      (i) => Boolean(i.scheduled_at) && i.status !== 'archived'
    ).length;
    const draftsCount = items.filter((i) => i.status === 'draft').length;
    const archivedCount = items.filter((i) => i.status === 'archived').length;
    const totalCount = items.length;
    const activeCount = items.filter((i) => i.status !== 'archived').length;
    return { ideaInboxCount, scheduledCount, draftsCount, archivedCount, totalCount, activeCount };
  }, [items]);

  const isFiltered =
    Boolean(search.trim()) ||
    platformFilter !== 'all' ||
    statusFilter !== 'all' ||
    actionTypeFilter !== 'all' ||
    accountFilter !== 'all';

  const displayedItems = useMemo(() => {
    return items.filter((item) => {
      if (activeTab === 'drafts') {
        if (item.status !== 'draft') return false;
      } else if (activeTab === 'scheduled') {
        if (!item.scheduled_at || item.status === 'archived') return false;
      } else if (activeTab === 'ideas') {
        const isIdeaInbox = item.status === 'idea' && !item.scheduled_at;
        if (!isIdeaInbox) return false;
      } else if (activeTab === 'archived') {
        if (item.status !== 'archived') return false;
      } else if (activeTab === 'all') {
        if (statusFilter === 'all' && item.status === 'archived') {
          return false;
        }
      }

      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (platformFilter !== 'all' && item.platform !== platformFilter) return false;
      if (actionTypeFilter !== 'all' && item.action_type !== actionTypeFilter) return false;
      if (accountFilter !== 'all' && item.social_account_id !== accountFilter) return false;

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const titleMatch = item.title?.toLowerCase().includes(q) || false;
        const bodyMatch = item.body?.toLowerCase().includes(q) || false;
        const tagMatch = item.tags?.some((t) => t.toLowerCase().includes(q)) || false;
        const handleMatch = item.social_account?.account_handle?.toLowerCase().includes(q) || false;
        if (!titleMatch && !bodyMatch && !tagMatch && !handleMatch) {
          return false;
        }
      }

      return true;
    });
  }, [items, activeTab, platformFilter, statusFilter, actionTypeFilter, accountFilter, search]);

  const handleContentCreated = (newItem: ContentItemWithMeta) => {
    setItems((prev) => [newItem, ...prev.filter((i) => i.id !== newItem.id)]);
    resetFilters();
    setActiveTab(
      newItem.scheduled_at
        ? 'scheduled'
        : newItem.status === 'idea'
          ? 'ideas'
          : newItem.status === 'draft'
            ? 'drafts'
            : 'all'
    );
    setSuccessMessage(
      newItem.status === 'idea' && !newItem.scheduled_at
        ? 'Idea captured in Inbox'
        : 'Content item created'
    );
  };

  const handleContentUpdated = (updatedItem: ContentItemWithMeta) => {
    setItems((prev) => prev.map((i) => (i.id === updatedItem.id ? updatedItem : i)));
    if (selectedContentDetail?.id === updatedItem.id) {
      setSelectedContentDetail(updatedItem);
    }
    setSuccessMessage(
      updatedItem.status === 'archived'
        ? 'Content item archived'
        : 'Content updated successfully'
    );
  };

  const handleContentDeleted = (deletedId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== deletedId));
    if (selectedContentDetail?.id === deletedId) {
      setSelectedContentDetail(null);
    }
    setSuccessMessage('Content item deleted');
  };

  const handleDeleteCard = async (id: string) => {
    const res = await deleteContentItemAction(workspaceId, id);
    if (res.error) {
      throw new Error(res.error);
    }
    handleContentDeleted(id);
  };

  const handleArchiveToggle = async (targetItem: ContentItemWithMeta) => {
    const isCurrentlyArchived = targetItem.status === 'archived';
    const targetStatus: ContentStatus = isCurrentlyArchived
      ? targetItem.scheduled_at
        ? 'scheduled'
        : 'draft'
      : 'archived';

    const res = await updateContentItemAction({
      workspace_id: workspaceId,
      content_id: targetItem.id,
      status: targetStatus,
    });

    if (res.error) {
      throw new Error(res.error);
    }

    if (res.data) {
      handleContentUpdated(res.data);
      setSuccessMessage(
        isCurrentlyArchived ? 'Content restored from archive' : 'Content item archived'
      );
    }
  };

  const handleAccountCreated = (newAccount: SocialAccountRow) => {
    setSocialAccounts((prev) => [newAccount, ...prev.filter((a) => a.id !== newAccount.id)]);
    setSuccessMessage(`Social account @${newAccount.account_handle.replace(/^@/, '')} added`);
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {successMessage && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 surface-elevated border-[var(--status-success-border)] px-4 py-3 rounded-[var(--radius-md)] text-xs text-[var(--status-success-text)] flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="font-medium">{successMessage}</span>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            aria-label="Dismiss notification"
            className="ml-2 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Header & Quick Action Buttons */}
      <header className="flex flex-col @3xl:flex-row @3xl:items-end justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] flex-wrap">
            <ZahiDiamondMark size="xs" tone="accent" />
            <span className="font-mono uppercase tracking-[0.08em] text-[10.5px] font-medium">
              Editorial Pipeline
            </span>
            <span aria-hidden="true" className="text-[var(--text-tertiary)]">
              ·
            </span>
            <span className="font-mono text-[11px]">{userTimeZone}</span>
          </div>
          <h1 className="heading-display text-[22px] sm:text-[26px]">Content</h1>
          <p className="text-xs text-[var(--text-secondary)]">
            Capture sparks, refine drafts across channels, and queue scheduled releases.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            type="button"
            onClick={() => setIsCreateAccountOpen(true)}
            className="btn-secondary px-3 py-2 text-xs font-medium"
          >
            <AtSign className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
            <span>Add account</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCreateDefaultStatus('idea');
              setIsCreateOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-sm)] badge-warning border text-xs font-medium transition-opacity hover:opacity-90"
          >
            <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Capture Idea</span>
            <kbd
              aria-hidden="true"
              className="hidden sm:inline-flex items-center rounded-[4px] border border-current/25 px-1 py-0 text-[10px] font-mono opacity-80"
            >
              i
            </kbd>
          </button>

          <button
            type="button"
            onClick={() => {
              setCreateDefaultStatus('draft');
              setIsCreateOpen(true);
            }}
            className="btn-accent px-3.5 py-2 text-xs font-semibold shadow-2xs"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>New Content</span>
            <kbd
              aria-hidden="true"
              className="hidden sm:inline-flex items-center rounded-[4px] border border-white/25 px-1 py-0 text-[10px] font-mono opacity-90"
            >
              c
            </kbd>
          </button>
        </div>
      </header>

      {/* Interactive Metric Filter Cards */}
      <div className="grid grid-cols-2 @2xl:grid-cols-4 gap-3">
        {(
          [
            {
              tab: 'ideas' as TabKey,
              label: 'Idea Inbox',
              count: stats.ideaInboxCount,
              hint: 'Unscheduled sparks',
              icon: <Lightbulb className="w-3.5 h-3.5 text-[var(--status-warning-text)]" aria-hidden="true" />,
            },
            {
              tab: 'scheduled' as TabKey,
              label: 'Scheduled',
              count: stats.scheduledCount,
              hint: 'Queued publishing slots',
              icon: <Calendar className="w-3.5 h-3.5 text-[var(--status-info-text)]" aria-hidden="true" />,
            },
            {
              tab: 'drafts' as TabKey,
              label: 'Drafts',
              count: stats.draftsCount,
              hint: 'Works in progress',
              icon: <FileText className="w-3.5 h-3.5 text-[var(--text-secondary)]" aria-hidden="true" />,
            },
            {
              tab: 'archived' as TabKey,
              label: 'Archived',
              count: stats.archivedCount,
              hint: 'Stored & recoverable',
              icon: <Archive className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />,
            },
          ] as const
        ).map((metric) => {
          const isSelected = activeTab === metric.tab;
          return (
            <button
              key={metric.tab}
              type="button"
              onClick={() => {
                resetFilters();
                setActiveTab(isSelected ? 'all' : metric.tab);
              }}
              aria-pressed={isSelected}
              className={`text-left p-3.5 rounded-[var(--radius-md)] border transition-all ${
                isSelected
                  ? 'bg-[var(--bg-surface)] border-[var(--accent)] ring-1 ring-[var(--accent-border)] shadow-[var(--shadow-card)]'
                  : 'surface-card-interactive'
              }`}
            >
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mb-1">
                <span className="font-medium">{metric.label}</span>
                {metric.icon}
              </div>
              <p className="text-xl font-semibold text-[var(--text-primary)] font-mono tabular-nums">
                {metric.count}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{metric.hint}</p>
            </button>
          );
        })}
      </div>

      {/* Pipeline Navigation Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border-subtle)] [&>button]:shrink-0">
        {(
          [
            { id: 'all', label: 'All Content', count: stats.activeCount },
            { id: 'ideas', label: 'Idea Inbox', count: stats.ideaInboxCount },
            { id: 'drafts', label: 'Drafts', count: stats.draftsCount },
            { id: 'scheduled', label: 'Scheduled', count: stats.scheduledCount },
            { id: 'archived', label: 'Archived', count: stats.archivedCount },
          ] as const
        ).map((tab) => {
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => {
                resetFilters();
                setActiveTab(tab.id);
              }}
              className={`flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs transition-colors ${
                isSelected
                  ? 'border-[var(--accent)] text-[var(--text-primary)] font-semibold'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] font-medium'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`text-[10.5px] px-1.5 py-0.2 rounded-[var(--radius-xs)] border font-mono tabular-nums ${
                  isSelected
                    ? 'badge-accent'
                    : 'badge-neutral'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filter Toolbar (@container responsive) */}
      <div className="surface-card p-3.5 space-y-3">
        <div className="grid grid-cols-1 @md:grid-cols-2 @4xl:grid-cols-5 gap-2.5">
          {/* Search Input */}
          <div className="relative @md:col-span-2 @4xl:col-span-1">
            <Search
              className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search content"
              placeholder="Search title, body, tag..."
              className="input-control w-full pl-8.5 pr-10 py-1.5 min-h-8 text-xs"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-[var(--radius-xs)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            ) : (
              <kbd
                aria-hidden="true"
                className="pointer-events-none hidden sm:inline-flex items-center justify-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-muted)] absolute right-2 top-1/2 -translate-y-1/2"
              >
                /
              </kbd>
            )}
          </div>

          <select
            aria-label="Filter by platform"
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="input-control w-full py-1.5 px-2.5 min-h-8 text-xs leading-tight"
          >
            <option value="all">All Platforms</option>
            <option value="x">X (Twitter)</option>
            <option value="linkedin">LinkedIn</option>
            <option value="reddit">Reddit</option>
            <option value="threads">Threads</option>
          </select>

          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input-control w-full py-1.5 px-2.5 min-h-8 text-xs leading-tight"
          >
            <option value="all">All Statuses</option>
            <option value="idea">Idea</option>
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="archived">Archived</option>
            <optgroup label="Automated Lifecycle">
              <option value="publishing">Publishing</option>
              <option value="published">Published</option>
              <option value="failed">Failed</option>
            </optgroup>
          </select>

          <select
            aria-label="Filter by action type"
            value={actionTypeFilter}
            onChange={(e) => setActionTypeFilter(e.target.value)}
            className="input-control w-full py-1.5 px-2.5 min-h-8 text-xs leading-tight"
          >
            <option value="all">All Action Types</option>
            <option value="post">Post</option>
            <option value="comment">Comment</option>
            <option value="reply">Reply</option>
            <option value="share">Share</option>
            <option value="repost">Repost</option>
            <option value="reaction">Reaction</option>
          </select>

          <select
            aria-label="Filter by social account"
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="input-control w-full py-1.5 px-2.5 min-h-8 text-xs leading-tight"
          >
            <option value="all">All Accounts</option>
            {socialAccounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                @{acc.account_handle.replace(/^@/, '')} ({acc.platform})
              </option>
            ))}
          </select>
        </div>

        {isFiltered && (
          <div className="flex items-center justify-between pt-2.5 border-t border-[var(--border-subtle)] text-xs">
            <span className="text-[var(--text-muted)] font-mono tabular-nums">
              Showing {displayedItems.length} of {items.length} items
            </span>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-text)] hover:underline"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reset filters</span>
            </button>
          </div>
        )}
      </div>

      {/* Content Stream / Editorial Cards */}
      {displayedItems.length > 0 ? (
        <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-3">
          {displayedItems.map((item) => (
            <ContentCard
              key={item.id}
              item={item}
              userTimeZone={userTimeZone}
              onOpenDetail={(target) => setSelectedContentDetail(target)}
              onDelete={handleDeleteCard}
              onArchiveToggle={handleArchiveToggle}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          showMascot={!isFiltered && activeTab === 'all'}
          icon={
            isFiltered ? undefined : activeTab === 'ideas' ? (
              <Lightbulb className="w-5 h-5 text-[var(--status-warning-text)]" aria-hidden="true" />
            ) : activeTab === 'archived' ? (
              <Archive className="w-5 h-5 text-[var(--text-muted)]" aria-hidden="true" />
            ) : (
              <FileText className="w-5 h-5 text-[var(--text-muted)]" aria-hidden="true" />
            )
          }
          title={
            isFiltered
              ? 'No matching content items'
              : activeTab === 'ideas'
                ? 'Idea Inbox is empty'
                : activeTab === 'archived'
                  ? 'No archived content'
                  : activeTab === 'drafts'
                    ? 'No drafts yet'
                    : activeTab === 'scheduled'
                      ? 'Nothing scheduled yet'
                      : 'No content created yet'
          }
          description={
            isFiltered
              ? 'Try broadening your search or resetting the active filters.'
              : activeTab === 'ideas'
                ? 'Capture quick content sparks and thoughts without committing to publishing dates.'
                : activeTab === 'archived'
                  ? 'Archived content remains safely stored here and can be recovered anytime.'
                  : activeTab === 'drafts'
                    ? 'Start a draft and iterate on headlines, tags, and channels at your own pace.'
                    : activeTab === 'scheduled'
                      ? 'Assign a scheduled slot to any draft to place it into your release queue.'
                      : 'Create your first post, capture an editorial spark, or save social account handles.'
          }
          action={
            isFiltered ? (
              <button
                type="button"
                onClick={resetFilters}
                className="btn-secondary px-3.5 py-2 text-xs font-medium"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Clear Filters</span>
              </button>
            ) : activeTab === 'ideas' ? (
              <button
                type="button"
                onClick={() => {
                  setCreateDefaultStatus('idea');
                  setIsCreateOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-sm)] badge-warning border text-xs font-semibold transition-opacity hover:opacity-90"
              >
                <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Capture First Idea</span>
              </button>
            ) : activeTab === 'archived' ? (
              <button
                type="button"
                onClick={() => {
                  resetFilters();
                  setActiveTab('all');
                }}
                className="btn-secondary px-3.5 py-2 text-xs font-medium"
              >
                <span>View Active Content</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCreateDefaultStatus('draft');
                  setIsCreateOpen(true);
                }}
                className="btn-accent px-4 py-2 text-xs font-semibold"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Create Content Item</span>
              </button>
            )
          }
        />
      )}

      {/* Create Content Modal */}
      <CreateContentModal
        workspaceId={workspaceId}
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onContentCreated={handleContentCreated}
        defaultStatus={createDefaultStatus}
        userTimeZone={userTimeZone}
        socialAccounts={socialAccounts}
        projects={projects}
      />

      {/* Detail & Edit Modal */}
      {selectedContentDetail && (
        <ContentDetailModal
          item={selectedContentDetail}
          workspaceId={workspaceId}
          isOpen={Boolean(selectedContentDetail)}
          onClose={() => setSelectedContentDetail(null)}
          onContentUpdated={handleContentUpdated}
          onContentDeleted={handleContentDeleted}
          socialAccounts={socialAccounts}
          projects={projects}
          userTimeZone={userTimeZone}
        />
      )}

      {/* Create Social Account Handle Modal */}
      <CreateSocialAccountModal
        workspaceId={workspaceId}
        isOpen={isCreateAccountOpen}
        onClose={() => setIsCreateAccountOpen(false)}
        onAccountCreated={handleAccountCreated}
      />
    </div>
  );
}
