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
  useEffect(() => {
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
  }, [isOpen, defaultStatus, initialScheduledAt, userTimeZone]);

  const handlePlatformChange = (newPlatform: SocialPlatform) => {
    setPlatform(newPlatform);
    if (socialAccountId) {
      const acc = socialAccounts.find((a) => a.id === socialAccountId);
      if (acc && acc.platform !== newPlatform) {
        setSocialAccountId('');
      }
    }
  };

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

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl bg-neutral-950 border border-neutral-800 p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800/80 pb-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">
              {defaultStatus === 'idea' ? 'Capture New Idea' : 'Create Content Draft'}
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              {defaultStatus === 'idea'
                ? 'Save quick thoughts to your Idea Inbox without committing to dates'
                : 'Plan, draft, and configure planned social interactions'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-950/40 border border-red-800 text-red-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Row 1: Platform & Action Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Platform Selection */}
            <div className="space-y-1.5">
              <label className="font-medium text-neutral-300">Platform</label>
              <div className="grid grid-cols-4 gap-1.5">
                {(['x', 'linkedin', 'reddit', 'threads'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handlePlatformChange(p)}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium border text-center transition-colors capitalize ${
                      platform === p
                        ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                        : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-700'
                    }`}
                  >
                    {p === 'x' ? 'X' : p}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Type Selection */}
            <div className="space-y-1.5">
              <label className="font-medium text-neutral-300">Action Type</label>
              <select
                value={actionType}
                onChange={(e) => {
                  const val = e.target.value as ContentActionType;
                  setActionType(val);
                  if (val !== 'post') setIsTargetRefOpen(true);
                }}
                className="w-full px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs"
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
            <label className="font-medium text-neutral-300">
              Title / Hook <span className="text-neutral-500">(Optional headline or summary)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 5 lessons from building agentic workflows"
              className="w-full px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs"
            />
          </div>

          {/* Content Body with Advisory Character Counter */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-medium text-neutral-300">
                Body Content <span className="text-neutral-500">(Draft text)</span>
              </label>
              <div
                className={`text-[11px] font-mono ${
                  isOverRecommendedLimit ? 'text-amber-400' : 'text-neutral-500'
                }`}
              >
                {body.length} / {currentLimit} chars
                {isOverRecommendedLimit && (
                  <span className="ml-1 text-[10px] text-amber-400/80">
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
              className="w-full px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs font-sans leading-relaxed"
            />
          </div>

          {/* Contextual Target Reference (Collapsible) */}
          <div className="border border-neutral-800/80 rounded-xl bg-neutral-900/40 p-3 space-y-2">
            <button
              type="button"
              onClick={() => setIsTargetRefOpen((prev) => !prev)}
              className="w-full flex items-center justify-between text-xs font-medium text-neutral-300 hover:text-neutral-100"
            >
              <span className="flex items-center gap-1.5">
                <LinkIcon className="w-3.5 h-3.5 text-neutral-400" />
                <span>Target Post & Author Context {isContextualAction && '(Recommended for ' + actionType + ')'}</span>
              </span>
              {isTargetRefOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {isTargetRefOpen && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-neutral-800/80">
                <div>
                  <label className="text-[11px] text-neutral-400">Target Post URL</label>
                  <input
                    type="url"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-200 text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-neutral-400">Author Handle</label>
                  <input
                    type="text"
                    value={targetAuthorHandle}
                    onChange={(e) => setTargetAuthorHandle(e.target.value)}
                    placeholder="@handle or u/author"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-200 text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-neutral-400">Target Post ID</label>
                  <input
                    type="text"
                    value={targetPostId}
                    onChange={(e) => setTargetPostId(e.target.value)}
                    placeholder="e.g. 182390123"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-200 text-xs mt-0.5"
                  />
                </div>
                {platform === 'reddit' && (
                  <div>
                    <label className="text-[11px] text-neutral-400">Subreddit</label>
                    <input
                      type="text"
                      value={subreddit}
                      onChange={(e) => setSubreddit(e.target.value)}
                      placeholder="e.g. webdev"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-200 text-xs mt-0.5"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Row 2: Status, Scheduled Date, Duration */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Status */}
            <div className="space-y-1.5">
              <label className="font-medium text-neutral-300">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ContentStatus)}
                className="w-full px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs"
              >
                <option value="idea">Idea (Unscheduled Inbox)</option>
                <option value="draft">Draft (In Progress)</option>
                <option value="scheduled">Scheduled</option>
              </select>
            </div>

            {/* Scheduled Datetime */}
            <div className="space-y-1.5">
              <label className="font-medium text-neutral-300">
                Scheduled Date & Time <span className="text-neutral-500">(Optional)</span>
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
                className="w-full px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs font-mono"
              />
            </div>

            {/* Duration Minutes */}
            <div className="space-y-1.5">
              <label className="font-medium text-neutral-300">
                Duration <span className="text-neutral-500">(Mins for calendar block)</span>
              </label>
              <input
                type="number"
                min={1}
                max={10080}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                placeholder="e.g. 30"
                className="w-full px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs font-mono"
              />
            </div>
          </div>

          {/* Row 3: Target Social Account, Project, Tags */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Target Social Account Picker */}
            <div className="space-y-1.5">
              <label className="font-medium text-neutral-300">Target Social Account</label>
              <select
                value={socialAccountId}
                onChange={(e) => setSocialAccountId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs"
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
              <p className="text-[10px] text-neutral-500">
                Destination profile for this {platform.toUpperCase()} content
              </p>
            </div>

            {/* Project */}
            <div className="space-y-1.5">
              <label className="font-medium text-neutral-300">Project</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs"
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
              <label className="font-medium text-neutral-300">Tags (comma-separated)</label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="tech, ai, launch"
                className="w-full px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="font-medium text-neutral-300">Editorial Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal editorial notes or references..."
              className="w-full px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-neutral-900">
            <button
              type="button"
              disabled={isPending}
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 font-medium text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors shadow-sm disabled:opacity-50"
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
