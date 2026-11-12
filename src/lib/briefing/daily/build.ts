import type { BriefingSources, RawContent, RawTask } from './source';
import type {
  BriefingContent,
  BriefingLink,
  BriefingSnapshot,
  BriefingTask,
  BriefingTime,
  DayFinderBlock,
} from './model';
import { dateKeyOf } from './time';

/**
 * STAGES 2-4: date matching / eligibility, deduplication + chronological sorting, and
 * snapshot construction. Pure and deterministic: same sources in -> same snapshot out.
 */

const ACTIVE_TASK_STATUSES = new Set(['todo', 'in_progress', 'blocked']);
const ACTIONABLE_CONTENT_STATUSES = new Set(['idea', 'draft', 'scheduled', 'publishing', 'failed']);

const PLATFORM_LABELS: Record<string, string> = { linkedin: 'LinkedIn', reddit: 'Reddit', threads: 'Threads', x: 'X' };
export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

function clean(text: string | null | undefined): string | null {
  const t = typeof text === 'string' ? text.trim() : '';
  return t.length > 0 ? t : null;
}

function cleanTags(tags: string[] | null | undefined): string[] {
  return (tags ?? []).map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean);
}

function ms(iso: string): number {
  return new Date(iso).getTime();
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function toLinks(raw: unknown, labelKey: 'title' | 'alt'): BriefingLink[] {
  if (!Array.isArray(raw)) return [];
  const out: BriefingLink[] = [];
  for (const item of raw) {
    if (isHttpUrl(item)) out.push({ url: item });
    else if (item && typeof item === 'object' && isHttpUrl((item as { url?: unknown }).url)) {
      const o = item as { url: string; title?: unknown; alt?: unknown };
      const label = clean(typeof o[labelKey] === 'string' ? (o[labelKey] as string) : null);
      out.push(label ? { url: o.url, label } : { url: o.url });
    }
  }
  return out;
}

function targetUrl(raw: unknown): string | null {
  const url = raw && typeof raw === 'object' ? (raw as { url?: unknown }).url : null;
  return isHttpUrl(url) ? url : null;
}

function contentTitle(c: RawContent): string {
  const title = clean(c.title);
  if (title) return title;
  const firstLine = clean(c.body)?.split('\n').find((l) => l.trim().length > 0)?.trim();
  if (firstLine) return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
  return `${platformLabel(c.platform)} ${c.action_type}`;
}

function byOrder<T extends { sortKey: number | null; anytime?: boolean; title: string; id: string }>(a: T, b: T): number {
  const aAny = a.sortKey === null;
  const bAny = b.sortKey === null;
  if (aAny !== bAny) return aAny ? 1 : -1; // timed first, Anytime after
  if (!aAny && !bAny && a.sortKey !== b.sortKey) return (a.sortKey as number) - (b.sortKey as number);
  const t = a.title.localeCompare(b.title, 'en');
  return t !== 0 ? t : a.id.localeCompare(b.id);
}

function buildTask(t: RawTask, src: BriefingSources, date: string): BriefingTask | null {
  const tzName = src.timezone;
  const scheduledOn = t.scheduled_start ? dateKeyOf(t.scheduled_start, tzName) === date : false;
  const dueOn = t.due_date ? dateKeyOf(t.due_date, tzName) === date : false;
  if (!scheduledOn && !dueOn) return null;

  const times: BriefingTime[] = [];
  let sortKey: number | null = null;
  if (!t.is_all_day) {
    if (t.scheduled_start) {
      const endAt = t.scheduled_end && ms(t.scheduled_end) > ms(t.scheduled_start) ? t.scheduled_end : null;
      times.push({ kind: 'scheduled', at: t.scheduled_start, endAt, onBriefingDate: scheduledOn });
      if (scheduledOn) sortKey = ms(t.scheduled_start);
    }
    if (t.due_date) {
      times.push({ kind: 'due', at: t.due_date, onBriefingDate: dueOn });
      if (dueOn) sortKey = sortKey === null ? ms(t.due_date) : Math.min(sortKey, ms(t.due_date));
    }
  }

  return {
    kind: 'task',
    id: t.id,
    title: clean(t.title) ?? 'Untitled task',
    anytime: sortKey === null,
    times: sortKey === null ? [] : times,
    sortKey,
    workspaceName: src.workspaces[t.workspace_id] ?? null,
    projectName: t.project_id ? (src.projects[t.project_id] ?? null) : null,
    tags: cleanTags(t.tags),
    description: clean(t.description),
    priority: t.priority,
    status: t.status as BriefingTask['status'],
    assignedTo: t.assigned_to ? (src.profiles[t.assigned_to] ?? null) : null,
    milestoneName: t.milestone_id ? (src.milestones[t.milestone_id] ?? null) : null,
    parentTitle: t.parent_task_id ? (src.parentTitles[t.parent_task_id] ?? null) : null,
    estimatedMinutes: t.estimated_duration_minutes && t.estimated_duration_minutes > 0 ? t.estimated_duration_minutes : null,
  };
}

function buildContent(c: RawContent, src: BriefingSources, date: string): BriefingContent | null {
  if (!c.scheduled_at || dateKeyOf(c.scheduled_at, src.timezone) !== date) return null;
  return {
    kind: 'content',
    id: c.id,
    title: contentTitle(c),
    anytime: false,
    times: [{ kind: 'publish', at: c.scheduled_at, onBriefingDate: true }],
    sortKey: ms(c.scheduled_at),
    workspaceName: src.workspaces[c.workspace_id] ?? null,
    projectName: c.project_id ? (src.projects[c.project_id] ?? null) : null,
    tags: cleanTags(c.tags),
    platform: c.platform,
    actionType: c.action_type,
    status: c.status as BriefingContent['status'],
    body: clean(c.body),
    notes: clean(c.notes),
    accountLabel: c.social_account_id ? (src.socialAccounts[c.social_account_id] ?? null) : null,
    durationMinutes: c.duration_minutes && c.duration_minutes > 0 ? c.duration_minutes : null,
    links: toLinks(c.external_links, 'title'),
    mediaLinks: toLinks(c.media_urls, 'alt'),
    targetUrl: targetUrl(c.target_reference),
  };
}

function dayFinderBlock(
  id: string,
  name: string,
  startAt: string | null,
  endAt: string | null,
  allDay: boolean,
  timezone: string,
  date: string
): DayFinderBlock | null {
  if (!startAt) return null;
  const startKey = dateKeyOf(startAt, timezone);
  const hasEnd = endAt !== null && ms(endAt) > ms(startAt);
  // End instants are exclusive: a block ending exactly at midnight does not touch the next day.
  const endKey = hasEnd ? dateKeyOf(new Date(ms(endAt as string) - 1), timezone) : startKey;
  if (!(startKey <= date && date <= endKey)) return null;
  const startsBefore = startKey < date;
  return {
    id,
    name,
    startAt,
    endAt: hasEnd ? endAt : null,
    allDay,
    startsBefore,
    endsAfter: endKey > date,
    // All-day first, then blocks carried over from yesterday, then by start instant.
    sortKey: allDay ? -2 : startsBefore ? -1 : ms(startAt),
  };
}

function plusMinutes(iso: string, minutes: number | null): string | null {
  return minutes && minutes > 0 ? new Date(ms(iso) + minutes * 60_000).toISOString() : null;
}

function isCalendarTimelineBlock(t: RawTask): boolean {
  if (!t.scheduled_start) return false;
  if (t.entry_type === 'calendar_block') return true;
  return t.created_from === 'calendar';
}

export function buildBriefingSnapshot(src: BriefingSources, localDate: string): BriefingSnapshot {
  const authorized = new Set(Object.keys(src.workspaces));
  const tz = src.timezone;

  // Defense in depth: even if retrieval over-fetched, never emit records outside the user's scope.
  const tasks = src.tasks.filter((t) => authorized.has(t.workspace_id));
  const content = src.content.filter((c) => authorized.has(c.workspace_id));

  // --- Tasks ---
  // All active actionable tasks visible to the user whose scheduled date OR deadline date matches
  // the briefing date are included in Tasks. A task created through the calendar does not disappear
  // from Tasks simply because it was scheduled on the calendar or lacks a deadline.
  // Dedicated calendar blocks (entry_type === 'calendar_block') are excluded from Tasks.
  const seenTask = new Set<string>();
  const seenOccurrence = new Set<string>();
  const taskEntries: BriefingTask[] = [];
  for (const t of [...tasks].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!ACTIVE_TASK_STATUSES.has(t.status)) continue;
    if (t.entry_type === 'calendar_block') continue;
    if (seenTask.has(t.id)) continue;
    const entry = buildTask(t, src, localDate);
    if (!entry) continue;
    // One real row per recurrence occurrence: never list the same occurrence twice within Tasks.
    if (t.recurrence_rule_id) {
      const key = `${t.recurrence_rule_id}#${t.occurrence_index ?? entry.sortKey ?? 'any'}`;
      if (seenOccurrence.has(key)) continue;
      seenOccurrence.add(key);
    }
    seenTask.add(t.id);
    taskEntries.push(entry);
  }

  // --- Content ---
  // All actionable content items whose scheduled publication date matches the briefing date
  // are included so they are never missed from Content.
  const seenContent = new Set<string>();
  const seenContentOccurrence = new Set<string>();
  const contentEntries: BriefingContent[] = [];
  for (const c of [...content].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!ACTIONABLE_CONTENT_STATUSES.has(c.status)) continue;
    if (seenContent.has(c.id)) continue;
    const entry = buildContent(c, src, localDate);
    if (!entry) continue;
    if (c.recurrence_rule_id) {
      const key = `${c.recurrence_rule_id}#${c.scheduled_at}`;
      if (seenContentOccurrence.has(key)) continue;
      seenContentOccurrence.add(key);
    }
    seenContent.add(c.id);
    contentEntries.push(entry);
  }

  // --- Day Finder: reflects actual CalendarDayView timeline blocks ---
  // Matches CalendarDayView's 24h timeline event extraction:
  // 1. Tasks scheduled on the calendar (created_from === 'calendar' with scheduled_start).
  // 2. Content scheduled on the calendar (created_from === 'calendar' with scheduled_at).
  const blocks = new Map<string, DayFinderBlock>();
  for (const t of tasks) {
    if (!isCalendarTimelineBlock(t) || t.status === 'cancelled') continue;
    const end = t.scheduled_end ?? (t.scheduled_start ? plusMinutes(t.scheduled_start, t.estimated_duration_minutes) : null);
    const b = dayFinderBlock(t.id, clean(t.title) ?? 'Untitled', t.scheduled_start, end, t.is_all_day, tz, localDate);
    if (b) blocks.set(`task:${t.id}`, b);
  }

  for (const c of content) {
    if (c.created_from !== 'calendar' || !c.scheduled_at || c.status === 'archived') continue;
    const end = plusMinutes(c.scheduled_at, c.duration_minutes ?? 45);
    const b = dayFinderBlock(c.id, clean(c.title) ?? 'Untitled post', c.scheduled_at, end, false, tz, localDate);
    if (b) blocks.set(`content:${c.id}`, b);
  }

  return {
    localDate,
    timezone: tz,
    workspaceCount: authorized.size,
    tasks: taskEntries.sort(byOrder),
    content: contentEntries.sort(byOrder),
    dayFinder: [...blocks.values()].sort((a, b) => a.sortKey - b.sortKey || a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id)),
  };
}
