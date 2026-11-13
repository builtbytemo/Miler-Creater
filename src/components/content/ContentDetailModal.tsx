'use client';

import { useState, useId } from 'react';
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
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useDialog } from '@/lib/hooks/use-dialog';

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
  const [scheduledAt, setScheduledAt] = useState(
    toLocalDatetimeString(item.scheduled_at, userTimeZone)
  );
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
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmingArchive, setIsConfirmingArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleId = useId();
  const dialogRef = useDialog(
    isOpen && !isDeleteConfirmOpen,
    onClose,
    isPending || isDeleting
  );

  // Reset form state synchronously during render when item or timezone changes
  const [prevItem, setPrevItem] = useState(item);
  const [prevUserTimeZone, setPrevUserTimeZone] = useState(userTimeZone);
  if (prevItem !== item || prevUserTimeZone !== userTimeZone) {
    setPrevItem(item);
    setPrevUserTimeZone(userTimeZone);
    const tRef = getTargetReference(item.target_reference);
    setCurrentItem(item);
    setIsEditing(false);
    setIsDeleteConfirmOpen(false);
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
  }

  if (!isOpen) return null;

  const currentLimit =
    PLATFORM_LIMITS[isEditing ? platform : currentItem.platform]?.maxChars || 280;
  const activeBody = isEditing ? body : currentItem.body || '';
  const isOverRecommendedLimit = activeBody.length > currentLimit;

  const platformInfo = PLATFORM_CONFIG[currentItem.platform] || {
    label: currentItem.platform,
    badgeClass: 'badge-neutral',
  };
  const statusInfo = STATUS_CONFIG[currentItem.status] || {
    label: currentItem.status,
    badgeClass: 'badge-neutral',
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

  const handleConfirmDelete = async () => {
    try {
      setIsDeleting(true);
      setError(null);
      const res = await deleteContentItemAction(workspaceId, currentItem.id);
      if (res.error) {
        setError(res.error);
        setIsDeleteConfirmOpen(false);
        return;
      }
      setIsDeleteConfirmOpen(false);
      onContentDeleted?.(currentItem.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete content item');
      setIsDeleteConfirmOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleArchive = async () => {
    if (!isConfirmingArchive) {
      setIsConfirmingArchive(true);
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

  const inputCls = 'input-control w-full px-3 py-2 text-xs';

  return (
    <div
      className="fixed inset-0 bg-black/55 dark:bg-black/75 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending && !isDeleting) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-2xl surface-elevated rounded-[var(--radius-lg)] p-5 sm:p-6 space-y-5 my-6 max-h-[90vh] flex flex-col focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4 shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-[var(--radius-xs)] border ${platformInfo.badgeClass}`}
            >
              {platformInfo.label}
            </span>
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-[var(--radius-xs)] border ${statusInfo.badgeClass}`}
            >
              {statusInfo.label}
            </span>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-[var(--radius-xs)] border badge-neutral">
              {actionInfo.label}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!isEditing && (
              <button
                type="button"
                onClick={handleStartEdit}
                className="btn-secondary px-3 py-1.5 text-xs font-medium"
              >
                <Edit2 className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                <span>Edit</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={isPending || isDeleting}
              aria-label="Close dialog"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] transition-colors disabled:opacity-50"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Error notification */}
        {error && (
          <div
            role="alert"
            className="p-3 rounded-[var(--radius-sm)] badge-danger border text-xs flex items-center gap-2 shrink-0"
          >
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Body Container (Scrollable) */}
        <div className="flex-1 overflow-y-auto space-y-5 pr-1">
          {isEditing ? (
            /* ================= EDIT MODE ================= */
            <form id="edit-content-form" onSubmit={handleUpdate} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="block font-medium text-[var(--text-secondary)]">Platform</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {(['x', 'linkedin', 'reddit', 'threads'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPlatform(p)}
                      aria-pressed={platform === p}
                      className={`py-2 px-3 rounded-[var(--radius-sm)] border text-xs font-medium capitalize text-center transition-colors ${
                        platform === p
                          ? 'bg-[var(--text-primary)] border-[var(--text-primary)] text-[var(--bg-canvas)] font-semibold'
                          : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      {p === 'x' ? 'X (Twitter)' : p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Type & Status Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <label htmlFor="detail-action-type" className="block font-medium text-[var(--text-secondary)]">
                    Action Type
                  </label>
                  <select
                    id="detail-action-type"
                    value={actionType}
                    onChange={(e) => setActionType(e.target.value as ContentActionType)}
                    className={inputCls}
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
                  <label htmlFor="detail-status" className="block font-medium text-[var(--text-secondary)]">
                    Status
                  </label>
                  <select
                    id="detail-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as ContentStatus)}
                    className={inputCls}
                  >
                    <option value="idea">Idea (Inbox)</option>
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="archived">Archived</option>
                    {(['publishing', 'published', 'failed'] as ContentStatus[]).includes(
                      currentItem.status
                    ) && (
                      <option value={currentItem.status} disabled>
                        {STATUS_CONFIG[currentItem.status]?.label || currentItem.status} (Automated
                        lifecycle - Read only)
                      </option>
                    )}
                  </select>
                  <p className="text-[10.5px] text-[var(--text-muted)]">
                    Publishing, Published, and Failed states are managed by integrations and cannot
                    be selected manually.
                  </p>
                </div>
              </div>

              {/* Title */}
              <div className="space-y-1.5">
                <label htmlFor="detail-title" className="block font-medium text-[var(--text-secondary)]">
                  Headline / Title{' '}
                  <span className="text-[var(--text-muted)] font-normal">(Optional)</span>
                </label>
                <input
                  id="detail-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Announcing our new open-source roadmap"
                  className={inputCls}
                />
              </div>

              {/* Content Body */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="detail-body" className="font-medium text-[var(--text-secondary)]">
                    Content Body
                  </label>
                  <span
                    className={`text-[11px] font-mono tabular-nums ${
                      isOverRecommendedLimit
                        ? 'text-[var(--status-warning-text)] font-semibold'
                        : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {body.length} / {currentLimit} chars
                  </span>
                </div>
                <textarea
                  id="detail-body"
                  rows={6}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Compose your post, comment, or editorial note..."
                  className={`${inputCls} resize-y leading-relaxed`}
                />
                {isOverRecommendedLimit && (
                  <p className="text-[11px] text-[var(--status-warning-text)] flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      Exceeds standard {PLATFORM_CONFIG[platform]?.label || platform} character
                      limit (advisory only).
                    </span>
                  </p>
                )}
              </div>

              {/* Schedule and Duration */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 p-3.5 rounded-[var(--radius-md)] bg-[var(--bg-surface-muted)] border border-[var(--border-subtle)]">
                <div className="space-y-1.5">
                  <label
                    htmlFor="detail-schedule"
                    className="font-medium text-[var(--text-secondary)] flex items-center gap-1.5"
                  >
                    <Calendar className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                    <span>Scheduled Date &amp; Time</span>
                  </label>
                  <input
                    id="detail-schedule"
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className={`${inputCls} font-mono`}
                  />
                  <p className="text-[10.5px] text-[var(--text-muted)]">
                    Leave blank for unscheduled idea ({userTimeZone})
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="detail-duration"
                    className="font-medium text-[var(--text-secondary)] flex items-center gap-1.5"
                  >
                    <Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                    <span>Duration (Minutes)</span>
                  </label>
                  <input
                    id="detail-duration"
                    type="number"
                    min="1"
                    max="10080"
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(e.target.value)}
                    placeholder="e.g. 30"
                    className={`${inputCls} font-mono`}
                  />
                </div>
              </div>

              {/* Target Social Account & Project Link */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <label
                    htmlFor="detail-social-account"
                    className="font-medium text-[var(--text-secondary)] flex items-center gap-1.5"
                  >
                    <AtSign className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                    <span>Target Social Account</span>
                  </label>
                  <select
                    id="detail-social-account"
                    value={socialAccountId}
                    onChange={(e) => setSocialAccountId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">None (Personal / Unassigned)</option>
                    {socialAccounts
                      .filter((a) => a.platform === platform)
                      .map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          @{acc.account_handle.replace(/^@/, '')}{' '}
                          {acc.account_name ? `(${acc.account_name})` : ''}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="detail-project"
                    className="font-medium text-[var(--text-secondary)] flex items-center gap-1.5"
                  >
                    <Folder className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                    <span>Linked Project</span>
                  </label>
                  <select
                    id="detail-project"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className={inputCls}
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
                <label
                  htmlFor="detail-tags"
                  className="font-medium text-[var(--text-secondary)] flex items-center gap-1.5"
                >
                  <Tag className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                  <span>Tags</span>
                </label>
                <input
                  id="detail-tags"
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="engineering, devrel, launch (comma-separated)"
                  className={inputCls}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="detail-notes"
                  className="font-medium text-[var(--text-secondary)] flex items-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                  <span>Editorial Notes / Context</span>
                </label>
                <textarea
                  id="detail-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Internal notes, context, or talking points..."
                  className={`${inputCls} resize-y`}
                />
              </div>

              {/* Target Reference (Collapsible) */}
              <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-3.5 bg-[var(--bg-surface-muted)] space-y-3">
                <button
                  type="button"
                  onClick={() => setIsTargetRefOpen(!isTargetRefOpen)}
                  className="w-full flex items-center justify-between text-left text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-semibold"
                >
                  <span className="flex items-center gap-1.5">
                    <LinkIcon className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                    <span>Target Reference (For comments, replies, reposts)</span>
                  </span>
                  {isTargetRefOpen ? (
                    <ChevronUp className="w-4 h-4 text-[var(--text-muted)]" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
                  )}
                </button>

                {isTargetRefOpen && (
                  <div className="pt-2.5 border-t border-[var(--border-subtle)] space-y-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-[var(--text-secondary)]">
                        Target Post URL
                      </label>
                      <input
                        type="url"
                        value={targetUrl}
                        onChange={(e) => setTargetUrl(e.target.value)}
                        placeholder="https://x.com/username/status/123456"
                        className={inputCls}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-[var(--text-secondary)]">
                          Target Post ID
                        </label>
                        <input
                          type="text"
                          value={targetPostId}
                          onChange={(e) => setTargetPostId(e.target.value)}
                          placeholder="e.g. 182749102834012"
                          className={inputCls}
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-[var(--text-secondary)]">
                          Target Author Handle
                        </label>
                        <input
                          type="text"
                          value={targetAuthorHandle}
                          onChange={(e) => setTargetAuthorHandle(e.target.value)}
                          placeholder="e.g. @rauchg"
                          className={inputCls}
                        />
                      </div>
                    </div>

                    {platform === 'reddit' && (
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-[var(--text-secondary)]">
                          Subreddit
                        </label>
                        <input
                          type="text"
                          value={subreddit}
                          onChange={(e) => setSubreddit(e.target.value)}
                          placeholder="e.g. r/webdev"
                          className={inputCls}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </form>
          ) : (
            /* ================= VIEW MODE ================= */
            <div className="space-y-4 text-sm">
              {/* Title / Headline */}
              <div>
                <h2
                  id={titleId}
                  className="heading-section text-base sm:text-lg text-[var(--text-primary)] leading-snug"
                >
                  {currentItem.title || (
                    <span className="text-[var(--text-muted)] italic font-normal">
                      (No headline / title)
                    </span>
                  )}
                </h2>
              </div>

              {/* Body */}
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-surface-muted)] border border-[var(--border-subtle)] p-4 space-y-3">
                <p className="whitespace-pre-wrap text-[var(--text-primary)] leading-relaxed font-sans text-xs sm:text-sm">
                  {currentItem.body || (
                    <span className="text-[var(--text-muted)] italic">
                      No content body provided.
                    </span>
                  )}
                </p>

                <div className="pt-2.5 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs font-mono tabular-nums">
                  <span className="text-[11px] text-[var(--text-muted)]">Character count</span>
                  <span
                    className={
                      isOverRecommendedLimit
                        ? 'text-[var(--status-warning-text)] font-semibold'
                        : 'text-[var(--text-secondary)]'
                    }
                  >
                    {activeBody.length} / {currentLimit} chars
                    {isOverRecommendedLimit && (
                      <span className="ml-1.5 text-[10.5px] font-sans">(Over advisory limit)</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Metadata Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)]/60 border border-[var(--border-subtle)] space-y-1">
                  <div className="flex items-center gap-1.5 text-[var(--text-muted)] font-medium text-[11px]">
                    <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Scheduled Slot ({userTimeZone})</span>
                  </div>
                  <p className="text-[var(--text-primary)] font-medium font-mono tabular-nums">
                    {formattedSchedule || (
                      <span className="text-[var(--text-muted)] font-sans">
                        Unscheduled (Idea / Draft)
                      </span>
                    )}
                  </p>
                  {currentItem.duration_minutes && (
                    <p className="text-[11px] text-[var(--text-secondary)] font-mono">
                      Duration: {currentItem.duration_minutes} minutes
                    </p>
                  )}
                </div>

                <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)]/60 border border-[var(--border-subtle)] space-y-1">
                  <div className="flex items-center gap-1.5 text-[var(--text-muted)] font-medium text-[11px]">
                    <AtSign className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Author / Handle</span>
                  </div>
                  <p className="text-[var(--text-primary)] font-medium font-mono">
                    {currentItem.social_account ? (
                      `@${currentItem.social_account.account_handle.replace(/^@/, '')}`
                    ) : (
                      <span className="text-[var(--text-muted)] font-sans">Not assigned</span>
                    )}
                  </p>
                  {currentItem.social_account?.account_name && (
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      {currentItem.social_account.account_name}
                    </p>
                  )}
                </div>

                <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)]/60 border border-[var(--border-subtle)] space-y-1">
                  <div className="flex items-center gap-1.5 text-[var(--text-muted)] font-medium text-[11px]">
                    <Folder className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Project</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {currentItem.project ? (
                      <>
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{
                            backgroundColor: currentItem.project.color || 'var(--accent)',
                          }}
                        />
                        <span className="text-[var(--text-primary)] font-medium">
                          {currentItem.project.name}
                        </span>
                      </>
                    ) : (
                      <span className="text-[var(--text-muted)]">None</span>
                    )}
                  </div>
                </div>

                <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)]/60 border border-[var(--border-subtle)] space-y-1">
                  <div className="flex items-center gap-1.5 text-[var(--text-muted)] font-medium text-[11px]">
                    <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Created At</span>
                  </div>
                  <p className="text-[var(--text-secondary)] font-mono tabular-nums">
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

              {/* Target Reference Info */}
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
                  <div className="p-3.5 rounded-[var(--radius-md)] bg-[var(--bg-surface-muted)]/60 border border-[var(--border-subtle)] space-y-2">
                    <div className="flex items-center gap-1.5 text-[var(--text-muted)] font-medium text-xs">
                      <LinkIcon className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Target Post Reference</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {targetRef.author_handle && (
                        <div>
                          <span className="text-[var(--text-muted)]">Author: </span>
                          <span className="text-[var(--text-primary)] font-mono">
                            {targetRef.author_handle}
                          </span>
                        </div>
                      )}
                      {targetRef.post_id && (
                        <div>
                          <span className="text-[var(--text-muted)]">Post ID: </span>
                          <span className="text-[var(--text-primary)] font-mono">
                            {targetRef.post_id}
                          </span>
                        </div>
                      )}
                      {targetRef.subreddit && (
                        <div>
                          <span className="text-[var(--text-muted)]">Subreddit: </span>
                          <span className="text-[var(--status-warning-text)] font-medium">
                            {targetRef.subreddit}
                          </span>
                        </div>
                      )}
                    </div>

                    {targetRef.url && (
                      <div className="pt-2 border-t border-[var(--border-subtle)]">
                        <a
                          href={targetRef.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-[var(--accent-text)] hover:underline break-all"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
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
                  <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-medium">
                    <Tag className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Tags</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {currentItem.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[11px] px-2.5 py-0.5 rounded-[var(--radius-xs)] badge-neutral border font-mono"
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
                  <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-medium">
                    <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Editorial Notes</span>
                  </div>
                  <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)]/60 border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                    {currentItem.notes}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border-subtle)] pt-4 flex items-center justify-between gap-2 shrink-0 flex-wrap">
          <div>
            {isEditing ? (
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={isPending}
                className="btn-secondary px-3.5 py-2 text-xs font-medium disabled:opacity-50"
              >
                Cancel Edit
              </button>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setIsDeleteConfirmOpen(true)}
                  disabled={isDeleting || isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-medium badge-danger border transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Delete</span>
                </button>

                {currentItem.status === 'archived' ? (
                  <button
                    type="button"
                    onClick={handleUnarchive}
                    disabled={isPending || isDeleting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-medium badge-info border transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <ArchiveRestore className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>Unarchive</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleArchive}
                    disabled={isPending || isDeleting}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-medium border transition-colors disabled:opacity-50 ${
                      isConfirmingArchive
                        ? 'badge-warning font-semibold'
                        : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--status-warning-text)] hover:border-[var(--status-warning-border)]'
                    }`}
                  >
                    {isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>{isConfirmingArchive ? 'Click again to archive' : 'Archive'}</span>
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
                className="btn-accent px-4 py-2 text-xs font-semibold disabled:opacity-50"
              >
                {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                <span>Save Changes</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary px-4 py-2 text-xs font-medium"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={isDeleteConfirmOpen}
        onCancel={() => setIsDeleteConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Content Item"
        description={`Are you sure you want to delete "${currentItem.title || 'this content draft'}"? This action cannot be undone.`}
        confirmLabel="Delete Content"
        cancelLabel="Cancel"
        tone="danger"
        isPending={isDeleting}
      />
    </div>
  );
}
