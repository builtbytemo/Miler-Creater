'use client';

import { useState, useId } from 'react';
import { useDialog } from '@/lib/hooks/use-dialog';
import {
  X,
  AlertCircle,
  Loader2,
  Link as LinkIcon,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { SocialPlatform, ContentActionType, ContentStatus } from '@/types/database';
import type { ContentItemWithMeta, SocialAccountRow } from '@/lib/services/content-service';
import { createContentItemAction } from '@/lib/actions/content-actions';
import {
  toLocalDatetimeString,
  parseLocalDatetimeString,
} from '@/lib/temporal/calendar';
import { DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';

interface ProjectOption {
  id: string;
  name: string;
  color: string | null;
}

interface CreateContentModalProps {
  createdFrom?: 'content' | 'calendar';
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
  onContentCreated: (item: ContentItemWithMeta) => void;
  defaultStatus?: ContentStatus;
  initialScheduledAt?: string | null;
  userTimeZone?: string;
  socialAccounts?: SocialAccountRow[];
  projects?: ProjectOption[];
}

const PLATFORM_LIMITS: Record<SocialPlatform, { maxChars: number; label: string }> = {
  x: { maxChars: 280, label: 'X (280 max recommended)' },
  threads: { maxChars: 500, label: 'Threads (500 max recommended)' },
  linkedin: { maxChars: 3000, label: 'LinkedIn (3,000 max recommended)' },
  reddit: { maxChars: 40000, label: 'Reddit (40,000 max recommended)' },
};

export function CreateContentModal({
  createdFrom = 'content',
  workspaceId,
  isOpen,
  onClose,
  onContentCreated,
  defaultStatus = 'idea',
  initialScheduledAt = null,
  userTimeZone = DEFAULT_TIMEZONE,
  socialAccounts = [],
  projects = [],
}: CreateContentModalProps) {
  const [platform, setPlatform] = useState<SocialPlatform>('x');
  const [actionType, setActionType] = useState<ContentActionType>('post');
  const [status, setStatus] = useState<ContentStatus>(defaultStatus);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [socialAccountId, setSocialAccountId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [notes, setNotes] = useState('');

  // Target reference state
  const [isTargetRefOpen, setIsTargetRefOpen] = useState(false);
  const [targetUrl, setTargetUrl] = useState('');
  const [targetPostId, setTargetPostId] = useState('');
  const [targetAuthorHandle, setTargetAuthorHandle] = useState('');
  const [subreddit, setSubreddit] = useState('');

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronize initial state when modal opens or defaultStatus/initialScheduledAt changes
  const syncKey = `${isOpen}:${defaultStatus}:${initialScheduledAt ?? ''}:${userTimeZone}`;
  const [prevSyncKey, setPrevSyncKey] = useState(syncKey);
  if (prevSyncKey !== syncKey) {
    setPrevSyncKey(syncKey);
    if (isOpen) {
      const initialLocal = initialScheduledAt
        ? toLocalDatetimeString(initialScheduledAt, userTimeZone)
        : '';
      setScheduledAt(initialLocal);
      setStatus(initialLocal ? 'scheduled' : defaultStatus);
      setPlatform('x');
      setActionType('post');
      setTitle('');
      setBody('');
      setDurationMinutes('');
      setSocialAccountId('');
      setProjectId('');
      setTagsInput('');
      setNotes('');
      setTargetUrl('');
      setTargetPostId('');
      setTargetAuthorHandle('');
      setSubreddit('');
      setIsTargetRefOpen(false);
      setError(null);
    }
  }

  const handlePlatformChange = (newPlatform: SocialPlatform) => {
    setPlatform(newPlatform);
    if (socialAccountId) {
      const acc = socialAccounts.find((a) => a.id === socialAccountId);
      if (acc && acc.platform !== newPlatform) {
        setSocialAccountId('');
      }
    }
  };

  const dialogRef = useDialog(isOpen, onClose, isPending);
  const titleId = useId();

  if (!isOpen) return null;

  const currentLimit = PLATFORM_LIMITS[platform]?.maxChars || 280;
  const isOverRecommendedLimit = body.length > currentLimit;
  const isContextualAction = actionType !== 'post';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !body.trim()) {
      setError('Content must include either a title/headline or a body');
      return;
    }

    try {
      setIsPending(true);
      setError(null);

      // Parse tags
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean);

      // Parse local datetime using user timezone into UTC ISO
      let scheduledIso: string | null = null;
      if (scheduledAt) {
        const parsed = parseLocalDatetimeString(scheduledAt, userTimeZone);
        if (parsed) {
          scheduledIso = parsed.toISOString();
        }
      }

      // If status is scheduled, require scheduled date & time
      if (status === 'scheduled' && !scheduledIso) {
        setError('Please choose a scheduled date and time for scheduled content, or select Draft or Idea to leave it unscheduled.');
        return;
      }

      // Synchronize status with scheduling: if scheduled date is provided, status should be scheduled
      let finalStatus = status;
      if (scheduledIso && (status === 'idea' || status === 'draft')) {
        finalStatus = 'scheduled';
      }

      // Build target reference if populated
      let target_reference: Record<string, unknown> | null = null;
      if (targetUrl.trim() || targetPostId.trim() || targetAuthorHandle.trim() || subreddit.trim()) {
        target_reference = {
          url: targetUrl.trim() || null,
          post_id: targetPostId.trim() || null,
          author_handle: targetAuthorHandle.trim() || null,
          subreddit: subreddit.trim() || null,
        };
      }

      const res = await createContentItemAction({
        ...(createdFrom === 'calendar' ? { created_from: createdFrom } : {}),
        workspace_id: workspaceId,
        platform,
        action_type: actionType,
        status: finalStatus,
        title: title.trim() || null,
        body: body,
        scheduled_at: scheduledIso,
        duration_minutes: durationMinutes ? parseInt(durationMinutes, 10) : null,
        social_account_id: socialAccountId || null,
        project_id: projectId || null,
        tags,
        notes: notes.trim() || null,
        target_reference: target_reference as unknown as null,
      });

      if (res.error) {
        setError(res.error);
        return;
      }

      if (res.data) {
        onContentCreated(res.data);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create content item');
    } finally {
      setIsPending(false);
    }
  };

  const inputBaseClass =
    'w-full px-3.5 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-strong)] focus:outline-none focus:border-[var(--border-strong)] text-xs transition-colors';

  return (
    <div
      className="fixed inset-0 bg-black/55 dark:bg-black/75 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      onClick={() => {
        if (!isPending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-2xl surface-elevated bg-[var(--bg-surface-elevated)] border border-[var(--border-strong)] text-[var(--text-primary)] rounded-3xl p-5 sm:p-6 space-y-5 shadow-[var(--shadow-elevated)] max-h-[90vh] overflow-y-auto focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
          <div className="space-y-0.5 min-w-0">
            <h2 id={titleId} className="heading-section text-base sm:text-lg text-[var(--text-primary)]">
              {defaultStatus === 'idea' ? 'Capture New Idea' : 'Create Content Draft'}
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              {defaultStatus === 'idea'
                ? 'Save quick thoughts to your Idea Inbox without committing to dates'
                : 'Plan, draft, and configure planned social interactions'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Close dialog"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3.5 rounded-2xl border badge-danger text-xs flex items-center gap-2.5"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Row 1: Platform & Action Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Platform Selection */}
            <div className="space-y-1.5">
              <label className="block font-medium text-[var(--text-secondary)]">Platform</label>
              <div className="grid grid-cols-4 gap-1.5">
                {(['x', 'linkedin', 'reddit', 'threads'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handlePlatformChange(p)}
                    aria-pressed={platform === p}
                    className={`py-2 px-2 rounded-xl text-xs font-semibold border text-center transition-colors capitalize ${
                      platform === p
                        ? 'bg-[var(--text-primary)] border-[var(--text-primary)] text-[var(--bg-canvas)] shadow-2xs'
                        : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]'
                    }`}
                  >
                    {p === 'x' ? 'X' : p}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Type Selection */}
            <div className="space-y-1.5">
              <label className="block font-medium text-[var(--text-secondary)]">Action Type</label>
              <select
                value={actionType}
                onChange={(e) => {
                  const val = e.target.value as ContentActionType;
                  setActionType(val);
                  if (val !== 'post') setIsTargetRefOpen(true);
                }}
                className={inputBaseClass}
              >
                <option value="post">Post (Original Publication)</option>
                <option value="comment">Comment</option>
                <option value="reply">Reply to Post</option>
                <option value="share">Share</option>
                <option value="repost">Repost / Retweet</option>
                <option value="reaction">Reaction</option>
              </select>
            </div>
          </div>

          {/* Title / Headline (Optional) */}
          <div className="space-y-1.5">
            <label className="block font-medium text-[var(--text-secondary)]">
              Title / Hook{' '}
              <span className="text-[var(--text-tertiary)] font-normal">
                (Optional headline or summary)
              </span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 5 lessons from building agentic workflows"
              className={inputBaseClass}
            />
          </div>

          {/* Content Body with Advisory Character Counter */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="font-medium text-[var(--text-secondary)]">
                Body Content{' '}
                <span className="text-[var(--text-tertiary)] font-normal">(Draft text)</span>
              </label>
              <div
                className={`text-[11px] font-mono ${
                  isOverRecommendedLimit
                    ? 'text-[var(--status-warn-text)] font-semibold'
                    : 'text-[var(--text-tertiary)]'
                }`}
              >
                {body.length} / {currentLimit} chars
                {isOverRecommendedLimit && (
                  <span className="ml-1 text-[10px]">
                    (Draft exceeds recommended limit)
                  </span>
                )}
              </div>
            </div>
            <textarea
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your draft, thoughts, or outline here..."
              className={`${inputBaseClass} font-sans leading-relaxed`}
            />
          </div>

          {/* Contextual Target Reference (Collapsible) */}
          <div className="border border-[var(--border-subtle)] rounded-2xl bg-[var(--bg-surface-muted)] p-3.5 space-y-2.5">
            <button
              type="button"
              onClick={() => setIsTargetRefOpen((prev) => !prev)}
              className="w-full flex items-center justify-between text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <span className="flex items-center gap-1.5">
                <LinkIcon className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                <span>
                  Target Post &amp; Author Context{' '}
                  {isContextualAction && `(Recommended for ${actionType})`}
                </span>
              </span>
              {isTargetRefOpen ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            {isTargetRefOpen && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2.5 border-t border-[var(--border-subtle)]">
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                    Target Post URL
                  </label>
                  <input
                    type="url"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="https://..."
                    className={inputBaseClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                    Author Handle
                  </label>
                  <input
                    type="text"
                    value={targetAuthorHandle}
                    onChange={(e) => setTargetAuthorHandle(e.target.value)}
                    placeholder="@handle or u/author"
                    className={inputBaseClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                    Target Post ID
                  </label>
                  <input
                    type="text"
                    value={targetPostId}
                    onChange={(e) => setTargetPostId(e.target.value)}
                    placeholder="e.g. 182390123"
                    className={inputBaseClass}
                  />
                </div>
                {platform === 'reddit' && (
                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                      Subreddit
                    </label>
                    <input
                      type="text"
                      value={subreddit}
                      onChange={(e) => setSubreddit(e.target.value)}
                      placeholder="e.g. webdev"
                      className={inputBaseClass}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Row 2: Status, Scheduled Date, Duration */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 p-3.5 rounded-2xl bg-[var(--bg-surface-muted)] border border-[var(--border-subtle)]">
            {/* Status */}
            <div className="space-y-1.5">
              <label className="block font-medium text-[var(--text-secondary)]">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ContentStatus)}
                className={inputBaseClass}
              >
                <option value="idea">Idea (Unscheduled Inbox)</option>
                <option value="draft">Draft (In Progress)</option>
                <option value="scheduled">Scheduled</option>
              </select>
            </div>

            {/* Scheduled Datetime */}
            <div className="space-y-1.5">
              <label className="block font-medium text-[var(--text-secondary)]">
                Scheduled Date &amp; Time{' '}
                <span className="text-[var(--text-tertiary)] font-normal">(Optional)</span>
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => {
                  setScheduledAt(e.target.value);
                  if (e.target.value && status === 'idea') {
                    setStatus('scheduled');
                  }
                }}
                className={`${inputBaseClass} font-mono`}
              />
            </div>

            {/* Duration Minutes */}
            <div className="space-y-1.5">
              <label className="block font-medium text-[var(--text-secondary)]">
                Duration{' '}
                <span className="text-[var(--text-tertiary)] font-normal">
                  (Mins for calendar block)
                </span>
              </label>
              <input
                type="number"
                min={1}
                max={10080}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                placeholder="e.g. 30"
                className={`${inputBaseClass} font-mono`}
              />
            </div>
          </div>

          {/* Row 3: Target Social Account, Project, Tags */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            {/* Target Social Account Picker */}
            <div className="space-y-1.5">
              <label className="block font-medium text-[var(--text-secondary)]">
                Target Social Account
              </label>
              <select
                value={socialAccountId}
                onChange={(e) => setSocialAccountId(e.target.value)}
                className={inputBaseClass}
              >
                <option value="">None (Personal / Unassigned)</option>
                {socialAccounts
                  .filter((acc) => acc.platform === platform)
                  .map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      @{acc.account_handle} {acc.account_name ? `(${acc.account_name})` : ''}
                    </option>
                  ))}
              </select>
              <p className="text-[10px] text-[var(--text-tertiary)]">
                Destination profile for this {platform.toUpperCase()} content
              </p>
            </div>

            {/* Project */}
            <div className="space-y-1.5">
              <label className="block font-medium text-[var(--text-secondary)]">Project</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className={inputBaseClass}
              >
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <label className="block font-medium text-[var(--text-secondary)]">
                Tags (comma-separated)
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="tech, ai, launch"
                className={inputBaseClass}
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="block font-medium text-[var(--text-secondary)]">Editorial Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal editorial notes or references..."
              className={inputBaseClass}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              disabled={isPending}
              onClick={onClose}
              className="btn-secondary px-4 py-2 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="btn-accent px-5 py-2 text-xs font-semibold disabled:opacity-50"
            >
              {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isPending ? 'Saving...' : status === 'idea' ? 'Save Idea' : 'Save Content'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
