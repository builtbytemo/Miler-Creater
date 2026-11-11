/**
 * Shared Daily Briefing data model. Both channel renderers consume the SAME snapshot;
 * email additionally renders `dayFinder`, Telegram ignores it.
 */

export type TimeKind = 'scheduled' | 'due' | 'publish';

/** One labelled time on an entry. `anytime` entries carry no clock time. */
export interface BriefingTime {
  kind: TimeKind;
  /** Instant (ISO, UTC). */
  at: string;
  /** Optional end instant (scheduled range). */
  endAt?: string | null;
  /** True when this time falls on the briefing date (otherwise rendered with its own date). */
  onBriefingDate: boolean;
}

export interface BriefingLink {
  label?: string;
  url: string;
}

interface EntryBase {
  /** Stable record id. Used only for deduplication/ordering; never rendered. */
  id: string;
  title: string;
  /** Timed entries first (chronological), then Anytime. */
  anytime: boolean;
  /** Clock-time labels, in display order. Empty when `anytime`. */
  times: BriefingTime[];
  /** Instant used for ordering (earliest relevant time on the briefing date), ms epoch. */
  sortKey: number | null;
  workspaceName: string | null;
  projectName: string | null;
  tags: string[];
}

export interface BriefingTask extends EntryBase {
  kind: 'task';
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'todo' | 'in_progress' | 'blocked';
  assignedTo: string | null;
  milestoneName: string | null;
  parentTitle: string | null;
  estimatedMinutes: number | null;
}

export interface BriefingContent extends EntryBase {
  kind: 'content';
  platform: string;
  actionType: string;
  status: 'idea' | 'draft' | 'scheduled' | 'publishing' | 'failed';
  body: string | null;
  notes: string | null;
  accountLabel: string | null;
  durationMinutes: number | null;
  links: BriefingLink[];
  mediaLinks: BriefingLink[];
  targetUrl: string | null;
}

export interface DayFinderBlock {
  id: string;
  name: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  /** Block begins on an earlier local date / ends on a later local date than the briefing date. */
  startsBefore: boolean;
  endsAfter: boolean;
  sortKey: number;
}

export interface BriefingSnapshot {
  /** User-local briefing date, YYYY-MM-DD. */
  localDate: string;
  timezone: string;
  /** Number of workspaces the user may access (drives workspace labels). */
  workspaceCount: number;
  tasks: BriefingTask[];
  content: BriefingContent[];
  dayFinder: DayFinderBlock[];
}
