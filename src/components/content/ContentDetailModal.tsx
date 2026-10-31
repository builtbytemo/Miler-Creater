'use client';

import { useState, useEffect } from 'react';
import {
  X,
  Calendar,
  Clock,
  AlertCircle,
  Loader2,
  Tag,
  AtSign,
  Link as LinkIcon,
  ExternalLink,
  Edit2,
  Trash2,
  Archive,
  ArchiveRestore,
  Folder,
  FileText,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { SocialPlatform, ContentActionType, ContentStatus } from '@/types/database';
import type { ContentItemWithMeta, SocialAccountRow } from '@/lib/services/content-service';
import { updateContentItemAction, deleteContentItemAction } from '@/lib/actions/content-actions';
import { formatInTimeZone, DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';
import { toLocalDatetimeString, parseLocalDatetimeString } from '@/lib/temporal/calendar';
import { PLATFORM_CONFIG, STATUS_CONFIG, ACTION_CONFIG } from './ContentCard';

interface ProjectOption {
  id: string;
  name: string;
  color: string | null;
}

interface TargetReferenceData {
  url?: string | null;
  post_id?: string | null;
  author_handle?: string | null;
  subreddit?: string | null;
  thread_id?: string | null;
}

function getTargetReference(ref: unknown): TargetReferenceData | null {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null;
  return ref as TargetReferenceData;
}

interface ContentDetailModalProps {
  item: ContentItemWithMeta;
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
  onContentUpdated?: (item: ContentItemWithMeta) => void;
  onContentDeleted?: (id: string) => void;
  socialAccounts?: SocialAccountRow[];
  projects?: ProjectOption[];
  userTimeZone?: string;
}

export const PLATFORM_LIMITS: Record<SocialPlatform, { maxChars: number; label: string }> = {
  x: { maxChars: 280, label: 'X (280 max recommended)' },
  threads: { maxChars: 500, label: 'Threads (500 max recommended)' },
  linkedin: { maxChars: 3000, label: 'LinkedIn (3,000 max recommended)' },
  reddit: { maxChars: 40000, label: 'Reddit (40,000 max recommended)' },
};

export function ContentDetailModal({
  item,
  workspaceId,
  isOpen,
  onClose,
  onContentUpdated,
  onContentDeleted,
  socialAccounts = [],
  projects = [],
  userTimeZone = DEFAULT_TIMEZONE,
}: ContentDetailModalProps) {
  const [currentItem, setCurrentItem] = useState<ContentItemWithMeta>(item);
  const [isEditing, setIsEditing] = useState(false);

  // Edit form states
  const [platform, setPlatform] = useState<SocialPlatform>(item.platform);
  const [actionType, setActionType] = useState<ContentActionType>(item.action_type);
  const [status, setStatus] = useState<ContentStatus>(item.status);
  const [title, setTitle] = useState(item.title || '');
  const [body, setBody] = useState(item.body || '');
  const [scheduledAt, setScheduledAt] = useState(toLocalDatetimeString(item.scheduled_at, userTimeZone));
  const [durationMinutes, setDurationMinutes] = useState(
    item.duration_minutes ? String(item.duration_minutes) : ''
  );
  const [socialAccountId, setSocialAccountId] = useState(item.social_account_id || '');
  const [projectId, setProjectId] = useState(item.project_id || '');
  const [tagsInput, setTagsInput] = useState(item.tags?.join(', ') || '');
  const [notes, setNotes] = useState(item.notes || '');

  const initialTargetRef = getTargetReference(item.target_reference);
  const [isTargetRefOpen, setIsTargetRefOpen] = useState(
    Boolean(
      initialTargetRef?.url ||
        initialTargetRef?.post_id ||
        initialTargetRef?.author_handle ||
        initialTargetRef?.subreddit
    )
  );
  const [targetUrl, setTargetUrl] = useState(initialTargetRef?.url || '');
  const [targetPostId, setTargetPostId] = useState(initialTargetRef?.post_id || '');
  const [targetAuthorHandle, setTargetAuthorHandle] = useState(
    initialTargetRef?.author_handle || ''
  );
  const [subreddit, setSubreddit] = useState(initialTargetRef?.subreddit || '');

  const [isPending, setIsPending] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmingArchive, setIsConfirmingArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when item prop changes
  useEffect(() => {
    const tRef = getTargetReference(item.target_reference);
    setCurrentItem(item);
    setIsEditing(false);
    setIsConfirmingDelete(false);
    setIsConfirmingArchive(false);
    setError(null);
    setPlatform(item.platform);
    setActionType(item.action_type);
    setStatus(item.status);
    setTitle(item.title || '');
    setBody(item.body || '');
    setScheduledAt(toLocalDatetimeString(item.scheduled_at, userTimeZone));
    setDurationMinutes(item.duration_minutes ? String(item.duration_minutes) : '');
    setSocialAccountId(item.social_account_id || '');
    setProjectId(item.project_id || '');
    setTagsInput(item.tags?.join(', ') || '');
    setNotes(item.notes || '');
    setTargetUrl(tRef?.url || '');
    setTargetPostId(tRef?.post_id || '');
    setTargetAuthorHandle(tRef?.author_handle || '');
    setSubreddit(tRef?.subreddit || '');
    setIsTargetRefOpen(
      Boolean(
        tRef?.url ||
          tRef?.post_id ||
          tRef?.author_handle ||
          tRef?.subreddit
      )
    );
  }, [item]);

  if (!isOpen) return null;

  const currentLimit = PLATFORM_LIMITS[isEditing ? platform : currentItem.platform]?.maxChars || 280;
  const activeBody = isEditing ? body : currentItem.body || '';
  const isOverRecommendedLimit = activeBody.length > currentLimit;

  const platformInfo = PLATFORM_CONFIG[currentItem.platform] || {
    label: currentItem.platform,
    badgeClass: 'bg-neutral-800 text-neutral-300 border-neutral-700',
  };
  const statusInfo = STATUS_CONFIG[currentItem.status] || {
    label: currentItem.status,
    badgeClass: 'bg-neutral-800 text-neutral-300 border-neutral-700',
  };
  const actionInfo = ACTION_CONFIG[currentItem.action_type] || {
    label: currentItem.action_type,
  };

  const formattedSchedule = currentItem.scheduled_at
    ? formatInTimeZone(currentItem.scheduled_at, userTimeZone, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
    : null;

  const handleStartEdit = () => {
    setIsEditing(true);
    setError(null);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setError(null);
    setPlatform(currentItem.platform);
    setActionType(currentItem.action_type);
    setStatus(currentItem.status);
    setTitle(currentItem.title || '');
    setBody(currentItem.body || '');
    setScheduledAt(toLocalDatetimeString(currentItem.scheduled_at, userTimeZone));
    setDurationMinutes(
      currentItem.duration_minutes ? String(currentItem.duration_minutes) : ''
    );
    setSocialAccountId(currentItem.social_account_id || '');
    setProjectId(currentItem.project_id || '');
    setTagsInput(currentItem.tags?.join(', ') || '');
    setNotes(currentItem.notes || '');
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !body.trim()) {
      setError('Content must include either a title or body');
      return;
    }

    try {
      setIsPending(true);
      setError(null);

      const tags = tagsInput
        .split(',')
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean);

      let scheduledIso: string | null = null;
      if (scheduledAt) {
        const parsed = parseLocalDatetimeString(scheduledAt, userTimeZone);
        if (parsed) {
          scheduledIso = parsed.toISOString();
        }
      }

      let target_reference: Record<string, unknown> | null = null;
      if (
        targetUrl.trim() ||
        targetPostId.trim() ||
        targetAuthorHandle.trim() ||
        subreddit.trim()
      ) {
        target_reference = {
          url: targetUrl.trim() || null,
          post_id: targetPostId.trim() || null,
          author_handle: targetAuthorHandle.trim() || null,
          subreddit: subreddit.trim() || null,
        };
      }

      const res = await updateContentItemAction({
        workspace_id: workspaceId,
        content_id: currentItem.id,
        platform,
        action_type: actionType,
        status,
        title: title.trim() || null,
        body,
        scheduled_at: scheduledIso,
        duration_minutes: durationMinutes ? parseInt(durationMinutes, 10) : null,
        social_account_id: socialAccountId || null,
        project_id: projectId || null,
        tags,
        notes: notes.trim() || null,
        target_reference,
      });

      if (res.error) {
        setError(res.error);
        return;
      }

      if (res.data) {
        setCurrentItem(res.data);
        onContentUpdated?.(res.data);
      }
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update content item');
    } finally {
      setIsPending(false);
    }
  };

  const handleDelete = async () => {
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      setIsConfirmingArchive(false);
      return;
    }

    try {
      setIsDeleting(true);
      setError(null);
      const res = await deleteContentItemAction(workspaceId, currentItem.id);
      if (res.error) {
        setError(res.error);
        setIsConfirmingDelete(false);
        return;
      }
      onContentDeleted?.(currentItem.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete content item');
      setIsConfirmingDelete(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleArchive = async () => {
    if (!isConfirmingArchive) {
      setIsConfirmingArchive(true);
      setIsConfirmingDelete(false);
      return;
    }

    try {
      setIsPending(true);
      setError(null);
      const res = await updateContentItemAction({
        workspace_id: workspaceId,
        content_id: currentItem.id,
        status: 'archived',
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.data) {
        setCurrentItem(res.data);
        onContentUpdated?.(res.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive content item');
    } finally {
      setIsPending(false);
      setIsConfirmingArchive(false);
    }
  };

  const handleUnarchive = async () => {
    try {
      setIsPending(true);
      setError(null);
      const targetStatus: ContentStatus = currentItem.scheduled_at ? 'scheduled' : 'draft';
      const res = await updateContentItemAction({
        workspace_id: workspaceId,
        content_id: currentItem.id,
        status: targetStatus,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.data) {
        setCurrentItem(res.data);
        onContentUpdated?.(res.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unarchive content item');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending && !isDeleting) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-2xl rounded-2xl bg-neutral-950 border border-neutral-800 p-6 space-y-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150 my-8 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${platformInfo.badgeClass}`}
            >
              {platformInfo.label}
            </span>
            <span
              className={`text-xs px-2.5 py-1 rounded-md border ${statusInfo.badgeClass}`}
            >
              {statusInfo.label}
            </span>
            <span className="text-xs px-2.5 py-1 rounded-md border border-neutral-800 bg-neutral-900 text-neutral-300">
              {actionInfo.label}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!isEditing && (
              <button
                type="button"
                onClick={handleStartEdit}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-800 text-xs font-medium text-neutral-300 hover:text-neutral-100 hover:bg-neutral-900 transition-colors"
              >
                <Edit2 className="w-3.5 h-3.5 text-neutral-400" />
                <span>Edit</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={isPending || isDeleting}
              className="p-1 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 transition-colors disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Error notification */}
        {error && (
          <div className="p-3 rounded-lg bg-red-950/40 border border-red-800 text-red-200 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Body Container (Scrollable) */}
        <div className="flex-1 overflow-y-auto space-y-5 pr-1">
          {isEditing ? (
            /* ================= EDIT MODE ================= */
            <form id="edit-content-form" onSubmit={handleUpdate} className="space-y-4 text-xs">
              {/* Platform Selector */}
              <div className="space-y-1.5">
                <label className="font-medium text-neutral-300">Platform</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['x', 'linkedin', 'reddit', 'threads'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPlatform(p)}
                      className={`py-2 px-3 rounded-lg border text-xs font-medium capitalize text-center transition-all ${
                        platform === p
                          ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                          : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-850'
                      }`}
                    >
                      {p === 'x' ? 'X (Twitter)' : p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Type & Status Row */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-medium text-neutral-300">Action Type</label>
                  <select
                    value={actionType}
                    onChange={(e) => setActionType(e.target.value as ContentActionType)}
                    className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-blue-500 transition-colors"
                  >
                    <option value="post">Post / Update</option>
                    <option value="comment">Comment</option>
                    <option value="reply">Reply</option>
                    <option value="share">Share</option>
                    <option value="repost">Repost</option>
                    <option value="reaction">Reaction</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-medium text-neutral-300">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as ContentStatus)}
                    className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-blue-500 transition-colors"
                  >
                    <option value="idea">Idea (Inbox)</option>
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="archived">Archived</option>
                    {(['publishing', 'published', 'failed'] as ContentStatus[]).includes(currentItem.status) && (
                      <option value={currentItem.status} disabled>
                        {STATUS_CONFIG[currentItem.status]?.label || currentItem.status} (Automated lifecycle - Read only)
                      </option>
                    )}
                  </select>
                  <p className="text-[10px] text-neutral-500">
                    Publishing, Published, and Failed statuses are managed automatically by publishing integrations (Phase 4) and cannot be set manually.
                  </p>
                </div>
              </div>

              {/* Title */}
              <div className="space-y-1.5">
                <label className="font-medium text-neutral-300">
                  Headline / Title <span className="text-neutral-500 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Announcing our new open-source roadmap"
                  className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              {/* Content Body */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-medium text-neutral-300">Content Body</label>
                  <span
                    className={`text-[11px] font-mono ${
                      isOverRecommendedLimit ? 'text-amber-400 font-medium' : 'text-neutral-500'
                    }`}
                  >
                    {body.length} / {currentLimit} chars
                  </span>
                </div>
                <textarea
                  rows={6}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Compose your post, comment, or editorial note..."
                  className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition-colors resize-y leading-relaxed"
                />
                {isOverRecommendedLimit && (
                  <p className="text-[11px] text-amber-400/90 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Exceeds standard {PLATFORM_CONFIG[platform]?.label || platform} character
                      limit. Publishing will not be blocked (editorial advisory).
                    </span>
                  </p>
                )}
              </div>

              {/* Schedule and Duration */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-medium text-neutral-300 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Scheduled Date & Time</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  <p className="text-[10px] text-neutral-500">Leave blank for unscheduled idea</p>
                </div>

                <div className="space-y-1.5">
                  <label className="font-medium text-neutral-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Duration (Minutes)</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10080"
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(e.target.value)}
                    placeholder="e.g. 30"
                    className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>

              {/* Target Social Account & Project Link */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-medium text-neutral-300 flex items-center gap-1.5">
                    <AtSign className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Target Social Account</span>
                  </label>
                  <select
                    value={socialAccountId}
                    onChange={(e) => setSocialAccountId(e.target.value)}
                    className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-blue-500 transition-colors"
                  >
                    <option value="">None (Personal / Unassigned)</option>
                    {socialAccounts
                      .filter((a) => a.platform === platform)
                      .map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          @{acc.account_handle} {acc.account_name ? `(${acc.account_name})` : ''}
                        </option>
                      ))}
                  </select>
                  <p className="text-[10px] text-neutral-500">
                    Destination profile for this {platform.toUpperCase()} content
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="font-medium text-neutral-300 flex items-center gap-1.5">
                    <Folder className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Linked Project</span>
                  </label>
                  <select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-blue-500 transition-colors"
                  >
                    <option value="">None</option>
                    {projects.map((proj) => (
                      <option key={proj.id} value={proj.id}>
                        {proj.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Tags & Editorial Notes */}
              <div className="space-y-1.5">
                <label className="font-medium text-neutral-300 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-neutral-400" />
                  <span>Tags</span>
                </label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="engineering, devrel, launch (comma-separated)"
                  className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-medium text-neutral-300 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-neutral-400" />
                  <span>Editorial Notes / Context</span>
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Internal notes, context, or talking points..."
                  className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition-colors resize-y"
                />
              </div>

              {/* Target Reference (Collapsible) */}
              <div className="border border-neutral-800 rounded-lg p-3 bg-neutral-900/50 space-y-3">
                <button
                  type="button"
                  onClick={() => setIsTargetRefOpen(!isTargetRefOpen)}
                  className="w-full flex items-center justify-between text-left text-neutral-300 font-medium"
                >
                  <span className="flex items-center gap-1.5">
                    <LinkIcon className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Target Reference (For comments, replies, reposts)</span>
                  </span>
                  {isTargetRefOpen ? (
                    <ChevronUp className="w-4 h-4 text-neutral-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-neutral-400" />
                  )}
                </button>

                {isTargetRefOpen && (
                  <div className="pt-2 border-t border-neutral-800/60 space-y-3">
                    <div className="space-y-1">
                      <label className="text-[11px] text-neutral-400">Target Post URL</label>
                      <input
                        type="url"
                        value={targetUrl}
                        onChange={(e) => setTargetUrl(e.target.value)}
                        placeholder="https://x.com/username/status/123456"
                        className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[11px] text-neutral-400">Target Post ID</label>
                        <input
                          type="text"
                          value={targetPostId}
                          onChange={(e) => setTargetPostId(e.target.value)}
                          placeholder="e.g. 182749102834012"
                          className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] text-neutral-400">Target Author Handle</label>
                        <input
                          type="text"
                          value={targetAuthorHandle}
                          onChange={(e) => setTargetAuthorHandle(e.target.value)}
                          placeholder="e.g. @rauchg"
                          className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    {platform === 'reddit' && (
                      <div className="space-y-1">
                        <label className="text-[11px] text-neutral-400">Subreddit</label>
                        <input
                          type="text"
                          value={subreddit}
                          onChange={(e) => setSubreddit(e.target.value)}
                          placeholder="e.g. r/webdev"
                          className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </form>
          ) : (
            /* ================= VIEW MODE ================= */
            <div className="space-y-5 text-sm">
              {/* Title / Headline */}
              <div>
                <h3 className="text-base font-semibold text-neutral-100 leading-snug">
                  {currentItem.title || (
                    <span className="text-neutral-500 italic font-normal">
                      (No headline / title)
                    </span>
                  )}
                </h3>
              </div>

              {/* Body */}
              <div className="rounded-xl bg-neutral-900/60 border border-neutral-800/80 p-4 space-y-3">
                <p className="whitespace-pre-wrap text-neutral-200 leading-relaxed font-sans text-xs md:text-sm selection:bg-blue-600/30">
                  {currentItem.body || (
                    <span className="text-neutral-500 italic">No content body provided.</span>
                  )}
                </p>

                <div className="pt-2 border-t border-neutral-800/60 flex items-center justify-between text-xs font-mono text-neutral-400">
                  <span className="text-[11px] text-neutral-500">Character count:</span>
                  <span
                    className={
                      isOverRecommendedLimit ? 'text-amber-400 font-semibold' : 'text-neutral-400'
                    }
                  >
                    {activeBody.length} / {currentLimit} chars
                    {isOverRecommendedLimit && (
                      <span className="ml-1.5 text-[10px] text-amber-500 font-sans">
                        (Over advisory limit)
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {/* Metadata Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {/* Schedule & Timezone */}
                <div className="p-3 rounded-lg bg-neutral-900/40 border border-neutral-800/60 space-y-1">
                  <div className="flex items-center gap-1.5 text-neutral-400 font-medium">
                    <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Scheduled Slot</span>
                  </div>
                  <p className="text-neutral-200 font-medium">
                    {formattedSchedule || (
                      <span className="text-neutral-500">Unscheduled (Idea / Draft)</span>
                    )}
                  </p>
                  {currentItem.duration_minutes && (
                    <p className="text-[11px] text-neutral-400">
                      Duration: {currentItem.duration_minutes} minutes
                    </p>
                  )}
                </div>

                {/* Social Account Handle */}
                <div className="p-3 rounded-lg bg-neutral-900/40 border border-neutral-800/60 space-y-1">
                  <div className="flex items-center gap-1.5 text-neutral-400 font-medium">
                    <AtSign className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Author / Handle</span>
                  </div>
                  <p className="text-neutral-200 font-medium">
                    {currentItem.social_account ? (
                      `@${currentItem.social_account.account_handle}`
                    ) : (
                      <span className="text-neutral-500">Not assigned</span>
                    )}
                  </p>
                  {currentItem.social_account?.account_name && (
                    <p className="text-[11px] text-neutral-400">
                      {currentItem.social_account.account_name}
                    </p>
                  )}
                </div>

                {/* Project Link */}
                <div className="p-3 rounded-lg bg-neutral-900/40 border border-neutral-800/60 space-y-1">
                  <div className="flex items-center gap-1.5 text-neutral-400 font-medium">
                    <Folder className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Project</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {currentItem.project ? (
                      <>
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{
                            backgroundColor: currentItem.project.color || '#3b82f6',
                          }}
                        />
                        <span className="text-neutral-200 font-medium">
                          {currentItem.project.name}
                        </span>
                      </>
                    ) : (
                      <span className="text-neutral-500">None</span>
                    )}
                  </div>
                </div>

                {/* Created Date */}
                <div className="p-3 rounded-lg bg-neutral-900/40 border border-neutral-800/60 space-y-1">
                  <div className="flex items-center gap-1.5 text-neutral-400 font-medium">
                    <Clock className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Created At</span>
                  </div>
                  <p className="text-neutral-300">
                    {currentItem.created_at
                      ? formatInTimeZone(currentItem.created_at, userTimeZone, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true,
                        })
                      : '—'}
                  </p>
                </div>
              </div>

              {/* Target Reference Info (if present) */}
              {(() => {
                const targetRef = getTargetReference(currentItem.target_reference);
                if (
                  !targetRef ||
                  (!targetRef.url &&
                    !targetRef.post_id &&
                    !targetRef.author_handle &&
                    !targetRef.subreddit)
                ) {
                  return null;
                }
                return (
                  <div className="p-3.5 rounded-lg bg-neutral-900/40 border border-neutral-800/60 space-y-2">
                    <div className="flex items-center gap-1.5 text-neutral-400 font-medium text-xs">
                      <LinkIcon className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Target Post Reference</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      {targetRef.author_handle && (
                        <div>
                          <span className="text-neutral-500">Author: </span>
                          <span className="text-neutral-200 font-mono">
                            {targetRef.author_handle}
                          </span>
                        </div>
                      )}
                      {targetRef.post_id && (
                        <div>
                          <span className="text-neutral-500">Post ID: </span>
                          <span className="text-neutral-200 font-mono">
                            {targetRef.post_id}
                          </span>
                        </div>
                      )}
                      {targetRef.subreddit && (
                        <div>
                          <span className="text-neutral-500">Subreddit: </span>
                          <span className="text-orange-400 font-medium">
                            {targetRef.subreddit}
                          </span>
                        </div>
                      )}
                    </div>

                    {targetRef.url && (
                      <div className="pt-1.5 border-t border-neutral-800/60">
                        <a
                          href={targetRef.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline break-all"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          <span>{targetRef.url}</span>
                        </a>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Tags */}
              {currentItem.tags && currentItem.tags.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-neutral-400 font-medium">
                    <Tag className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Tags</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {currentItem.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-xs px-2.5 py-0.5 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-300"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Editorial Notes */}
              {currentItem.notes && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-neutral-400 font-medium">
                    <FileText className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Editorial Notes</span>
                  </div>
                  <div className="p-3 rounded-lg bg-neutral-900/40 border border-neutral-800/60 text-xs text-neutral-300 whitespace-pre-wrap leading-relaxed">
                    {currentItem.notes}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-800 pt-4 flex items-center justify-between shrink-0">
          <div>
            {isEditing ? (
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={isPending}
                className="px-3.5 py-2 rounded-lg border border-neutral-800 text-xs font-medium text-neutral-300 hover:text-neutral-100 hover:bg-neutral-900 transition-colors disabled:opacity-50"
              >
                Cancel Edit
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting || isPending}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isConfirmingDelete
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'text-red-400 hover:text-red-300 hover:bg-red-950/40 border border-transparent hover:border-red-900/50'
                  }`}
                >
                  {isDeleting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isConfirmingDelete ? 'Click again to confirm delete' : 'Delete'}
                  </span>
                </button>

                {currentItem.status === 'archived' ? (
                  <button
                    type="button"
                    onClick={handleUnarchive}
                    disabled={isPending || isDeleting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-950/40 border border-blue-900/50 transition-colors disabled:opacity-50"
                  >
                    {isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ArchiveRestore className="w-3.5 h-3.5" />
                    )}
                    <span>Unarchive</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleArchive}
                    disabled={isPending || isDeleting}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                      isConfirmingArchive
                        ? 'bg-amber-600 text-white hover:bg-amber-700'
                        : 'text-amber-400 hover:text-amber-300 hover:bg-amber-950/40 border border-transparent hover:border-amber-900/50'
                    }`}
                  >
                    {isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Archive className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {isConfirmingArchive ? 'Click again to archive' : 'Archive'}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isEditing ? (
              <button
                type="submit"
                form="edit-content-form"
                disabled={isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-sm transition-colors disabled:opacity-50"
              >
                {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Save Changes</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-neutral-900 border border-neutral-800 text-xs font-medium text-neutral-300 hover:text-neutral-100 hover:bg-neutral-850 transition-colors"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
