'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Plus,
  Filter,
  X,
  Share2,
  Lightbulb,
  Calendar,
  FileText,
  CheckCircle2,
  AtSign,
  Layers,
  Sparkles,
  Archive,
  ArchiveRestore,
} from 'lucide-react';
import type { SocialPlatform, ContentActionType, ContentStatus } from '@/types/database';
import type { ContentItemWithMeta, SocialAccountRow } from '@/lib/services/content-service';
import { deleteContentItemAction, updateContentItemAction } from '@/lib/actions/content-actions';
import { ContentCard } from './ContentCard';
import { CreateContentModal } from './CreateContentModal';
import { ContentDetailModal } from './ContentDetailModal';
import { CreateSocialAccountModal } from './CreateSocialAccountModal';

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
}

type TabKey = 'all' | 'ideas' | 'archived';

export function ContentWorkspace({
  initialItems,
  initialIdeas,
  workspaceId,
  socialAccounts: initialSocialAccounts,
  projects,
  userTimeZone,
}: ContentWorkspaceProps) {
  const router = useRouter();

  // Merge items safely to guarantee no duplicates
  const initialMerged = useMemo(() => {
    const map = new Map<string, ContentItemWithMeta>();
    initialItems.forEach((i) => map.set(i.id, i));
    initialIdeas.forEach((i) => map.set(i.id, i));
    return Array.from(map.values());
  }, [initialItems, initialIdeas]);

  const [items, setItems] = useState<ContentItemWithMeta[]>(initialMerged);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccountRow[]>(initialSocialAccounts);

  // Tab & Filters
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [actionTypeFilter, setActionTypeFilter] = useState<string>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createDefaultStatus, setCreateDefaultStatus] = useState<ContentStatus>('idea');
  const [isCreateAccountOpen, setIsCreateAccountOpen] = useState(false);
  const [selectedContentDetail, setSelectedContentDetail] = useState<ContentItemWithMeta | null>(null);

  // Notifications
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Synchronize when server revalidates or props change
  useEffect(() => {
    setItems(initialMerged);
  }, [initialMerged]);

  useEffect(() => {
    setSocialAccounts(initialSocialAccounts);
  }, [initialSocialAccounts]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => {
      setSuccessMessage(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [successMessage]);

  // Summary statistics
  const stats = useMemo(() => {
    const ideaInboxCount = items.filter((i) => i.status === 'idea' && !i.scheduled_at).length;
    const scheduledCount = items.filter((i) => Boolean(i.scheduled_at) && i.status !== 'archived').length;
    const draftsCount = items.filter((i) => i.status === 'draft').length;
    const archivedCount = items.filter((i) => i.status === 'archived').length;
    const totalCount = items.length;
    const activeCount = items.filter((i) => i.status !== 'archived').length;
    return { ideaInboxCount, scheduledCount, draftsCount, archivedCount, totalCount, activeCount };
  }, [items]);

  // Check if any filter is active
  const isFiltered =
    Boolean(search.trim()) ||
    platformFilter !== 'all' ||
    statusFilter !== 'all' ||
    actionTypeFilter !== 'all' ||
    accountFilter !== 'all';

  const resetFilters = () => {
    setSearch('');
    setPlatformFilter('all');
    setStatusFilter('all');
    setActionTypeFilter('all');
    setAccountFilter('all');
  };

  // Filtered items computation
  const displayedItems = useMemo(() => {
    return items.filter((item) => {
      // Tab filter
      if (activeTab === 'ideas') {
        const isIdeaInbox = item.status === 'idea' && !item.scheduled_at;
        if (!isIdeaInbox) return false;
      } else if (activeTab === 'archived') {
        if (item.status !== 'archived') return false;
      } else if (activeTab === 'all') {
        // By default on 'all' tab, hide archived items unless user explicitly filters by status=archived
        if (statusFilter === 'all' && item.status === 'archived') {
          return false;
        }
      }

      // Status filter
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }

      // Platform filter
      if (platformFilter !== 'all' && item.platform !== platformFilter) {
        return false;
      }

      // Action type filter
      if (actionTypeFilter !== 'all' && item.action_type !== actionTypeFilter) {
        return false;
      }

      // Social account filter
      if (accountFilter !== 'all' && item.social_account_id !== accountFilter) {
        return false;
      }

      // Search query filter (matches title, body, or tags)
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const titleMatch = item.title?.toLowerCase().includes(q) || false;
        const bodyMatch = item.body?.toLowerCase().includes(q) || false;
        const tagMatch = item.tags?.some((t) => t.toLowerCase().includes(q)) || false;
        const handleMatch =
          item.social_account?.account_handle?.toLowerCase().includes(q) || false;
        if (!titleMatch && !bodyMatch && !tagMatch && !handleMatch) {
          return false;
        }
      }

      return true;
    });
  }, [items, activeTab, platformFilter, statusFilter, actionTypeFilter, accountFilter, search]);

  // Item handlers
  const handleContentCreated = (newItem: ContentItemWithMeta) => {
    setItems((prev) => [newItem, ...prev.filter((i) => i.id !== newItem.id)]);
    setSuccessMessage(
      newItem.status === 'idea' && !newItem.scheduled_at
        ? 'Idea captured in Inbox'
        : 'Content item created'
    );
  };

  const handleContentUpdated = (updatedItem: ContentItemWithMeta) => {
    setItems((prev) =>
      prev.map((i) => (i.id === updatedItem.id ? updatedItem : i))
    );
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
      ? (targetItem.scheduled_at ? 'scheduled' : 'draft')
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
    setSuccessMessage(`Social account @${newAccount.account_handle} added`);
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {successMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-neutral-900 border border-emerald-500/40 text-emerald-300 text-xs shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successMessage}</span>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="ml-2 text-neutral-400 hover:text-neutral-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Header & Quick Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-neutral-800/80 pb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-100 flex items-center gap-2.5">
            <Share2 className="w-5 h-5 text-blue-500" />
            <span>Content Engine</span>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Personal editorial planning, idea capture, and cross-platform scheduling.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setIsCreateAccountOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-850 text-neutral-300 text-xs font-medium transition-colors"
          >
            <AtSign className="w-3.5 h-3.5 text-neutral-400" />
            <span>Add social account</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCreateDefaultStatus('idea');
              setIsCreateOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-medium transition-colors"
          >
            <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
            <span>Capture Idea</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCreateDefaultStatus('draft');
              setIsCreateOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>New Content</span>
          </button>
        </div>
      </div>

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800/80">
          <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
            <span>Idea Inbox</span>
            <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <p className="text-xl font-bold text-neutral-100">{stats.ideaInboxCount}</p>
          <p className="text-[10px] text-neutral-500 mt-0.5">Unscheduled sparks</p>
        </div>

        <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800/80">
          <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
            <span>Scheduled</span>
            <Calendar className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <p className="text-xl font-bold text-neutral-100">{stats.scheduledCount}</p>
          <p className="text-[10px] text-neutral-500 mt-0.5">With target publishing slot</p>
        </div>

        <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800/80">
          <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
            <span>Drafts</span>
            <FileText className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <p className="text-xl font-bold text-neutral-100">{stats.draftsCount}</p>
          <p className="text-[10px] text-neutral-500 mt-0.5">In progress / pending</p>
        </div>

        <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800/80">
          <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
            <span>Archived</span>
            <Archive className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <p className="text-xl font-bold text-neutral-100">{stats.archivedCount}</p>
          <p className="text-[10px] text-neutral-500 mt-0.5">Stored & recoverable</p>
        </div>
      </div>

      {/* Tabs & View Switcher */}
      <div className="flex items-center gap-2 border-b border-neutral-800">
        <button
          type="button"
          onClick={() => setActiveTab('all')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
            activeTab === 'all'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
          }`}
        >
          <span>All Content</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-400">
            {stats.activeCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ideas')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
            activeTab === 'ideas'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
          }`}
        >
          <Lightbulb className="w-3.5 h-3.5" />
          <span>Idea Inbox</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
            {stats.ideaInboxCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('archived')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
            activeTab === 'archived'
              ? 'border-neutral-400 text-neutral-200'
              : 'border-transparent text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
          }`}
        >
          <Archive className="w-3.5 h-3.5" />
          <span>Archived</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-400">
            {stats.archivedCount}
          </span>
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800/80 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          {/* Search Input */}
          <div className="relative lg:col-span-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, body, tag..."
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Platform Filter */}
          <div>
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="w-full py-1.5 px-2.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-200 focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="all">All Platforms</option>
              <option value="x">X (Twitter)</option>
              <option value="linkedin">LinkedIn</option>
              <option value="reddit">Reddit</option>
              <option value="threads">Threads</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full py-1.5 px-2.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-200 focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="all">All Statuses</option>
              <option value="idea">Idea</option>
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="archived">Archived</option>
              <optgroup label="Automated Lifecycle (Phase 4)">
                <option value="publishing">Publishing</option>
                <option value="published">Published</option>
                <option value="failed">Failed</option>
              </optgroup>
            </select>
          </div>

          {/* Action Type Filter */}
          <div>
            <select
              value={actionTypeFilter}
              onChange={(e) => setActionTypeFilter(e.target.value)}
              className="w-full py-1.5 px-2.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-200 focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="all">All Action Types</option>
              <option value="post">Post</option>
              <option value="comment">Comment</option>
              <option value="reply">Reply</option>
              <option value="share">Share</option>
              <option value="repost">Repost</option>
              <option value="reaction">Reaction</option>
            </select>
          </div>

          {/* Social Account Filter */}
          <div>
            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="w-full py-1.5 px-2.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-200 focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="all">All Accounts</option>
              {socialAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  @{acc.account_handle} ({acc.platform})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Reset filter toolbar */}
        {isFiltered && (
          <div className="flex items-center justify-between pt-2 border-t border-neutral-800/60 text-xs">
            <span className="text-neutral-400">
              Showing {displayedItems.length} of {items.length} items
            </span>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reset filters</span>
            </button>
          </div>
        )}
      </div>

      {/* Content Stream / Cards List */}
      <div className="space-y-3">
        {displayedItems.length > 0 ? (
          displayedItems.map((item) => (
            <ContentCard
              key={item.id}
              item={item}
              userTimeZone={userTimeZone}
              onOpenDetail={(target) => setSelectedContentDetail(target)}
              onDelete={handleDeleteCard}
              onArchiveToggle={handleArchiveToggle}
            />
          ))
        ) : (
          <div className="p-12 rounded-2xl bg-neutral-950 border border-neutral-800 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-neutral-900 border border-neutral-800 mx-auto flex items-center justify-center text-neutral-500">
              {activeTab === 'ideas' ? (
                <Lightbulb className="w-6 h-6 text-amber-500/70" />
              ) : activeTab === 'archived' ? (
                <Archive className="w-6 h-6 text-neutral-400" />
              ) : (
                <FileText className="w-6 h-6 text-neutral-500" />
              )}
            </div>

            <div className="max-w-md mx-auto space-y-1">
              <h3 className="text-sm font-semibold text-neutral-200">
                {isFiltered
                  ? 'No matching content items'
                  : activeTab === 'ideas'
                  ? 'Idea Inbox is empty'
                  : activeTab === 'archived'
                  ? 'No archived content'
                  : 'No content created yet'}
              </h3>
              <p className="text-xs text-neutral-400">
                {isFiltered
                  ? 'Try broadening your search or resetting the active filters.'
                  : activeTab === 'ideas'
                  ? 'Capture quick content sparks and thoughts without committing to dates.'
                  : activeTab === 'archived'
                  ? 'Archived content remains safely stored here and can be recovered anytime.'
                  : 'Create your first post, schedule an update, or add social accounts.'}
              </p>
            </div>

            <div>
              {isFiltered ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-850 text-neutral-300 text-xs transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Clear Filters</span>
                </button>
              ) : activeTab === 'ideas' ? (
                <button
                  type="button"
                  onClick={() => {
                    setCreateDefaultStatus('idea');
                    setIsCreateOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 text-amber-300 text-xs font-medium transition-colors"
                >
                  <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                  <span>Capture First Idea</span>
                </button>
              ) : activeTab === 'archived' ? (
                <button
                  type="button"
                  onClick={() => setActiveTab('all')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-850 text-neutral-300 text-xs transition-colors"
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
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Content Item</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create Content Modal */}
      <CreateContentModal
        workspaceId={workspaceId}
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onContentCreated={handleContentCreated}
        defaultStatus={createDefaultStatus}
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
