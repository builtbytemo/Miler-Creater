import type { SupabaseClient } from '@supabase/supabase-js';
import { utcWindowForDate } from './time';

/**
 * STAGE 1: data retrieval + authorization.
 *
 * The delivery worker uses a privileged (service-role) client that bypasses RLS, so scoping is
 * enforced here explicitly and mirrors the RLS policies (`is_workspace_member(workspace_id,
 * 'viewer')`): a user may see every task / content item of every workspace they are CURRENTLY a
 * member of (any role), regardless of creator or assignee. Membership is read at generation time
 * so removed members immediately stop receiving that workspace's records. Every other query is
 * restricted to the authorized workspace ids, and `build.ts` re-checks workspace ids defensively.
 */

export interface RawTask {
  id: string;
  workspace_id: string;
  parent_task_id: string | null;
  project_id: string | null;
  milestone_id: string | null;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
  scheduled_start: string | null;
  scheduled_end: string | null;
  due_date: string | null;
  estimated_duration_minutes: number | null;
  is_all_day: boolean;
  tags: string[] | null;
  recurrence_rule_id: string | null;
  occurrence_index: number | null;
  created_from: 'tasks' | 'calendar' | null;
  assigned_to: string | null;
}

export interface RawContent {
  id: string;
  workspace_id: string;
  social_account_id: string | null;
  platform: string;
  action_type: string;
  status: 'idea' | 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'archived';
  title: string | null;
  body: string | null;
  scheduled_at: string | null;
  duration_minutes: number | null;
  media_urls: unknown;
  external_links: unknown;
  target_reference: unknown;
  tags: string[] | null;
  notes: string | null;
  project_id: string | null;
  milestone_id: string | null;
  recurrence_rule_id: string | null;
  created_from: 'content' | 'calendar' | null;
}

export interface BriefingSources {
  timezone: string;
  /** Authorized workspace id -> name. Empty when the user has no memberships. */
  workspaces: Record<string, string>;
  tasks: RawTask[];
  content: RawContent[];
  projects: Record<string, string>;
  milestones: Record<string, string>;
  profiles: Record<string, string>;
  socialAccounts: Record<string, string>;
  parentTitles: Record<string, string>;
}

const TASK_COLUMNS =
  'id, workspace_id, parent_task_id, project_id, milestone_id, title, description, priority, status, scheduled_start, scheduled_end, due_date, estimated_duration_minutes, is_all_day, tags, recurrence_rule_id, occurrence_index, created_from, assigned_to';
const CONTENT_COLUMNS =
  'id, workspace_id, social_account_id, platform, action_type, status, title, body, scheduled_at, duration_minutes, media_urls, external_links, target_reference, tags, notes, project_id, milestone_id, recurrence_rule_id, created_from';

const MAX_ROWS = 2000;

/** PostgREST `or` filter: any date column of the row can touch the UTC window. */
export function taskWindowFilter(from: string, to: string): string {
  return [
    `and(scheduled_start.gte.${from},scheduled_start.lte.${to})`,
    `and(due_date.gte.${from},due_date.lte.${to})`,
    `and(scheduled_start.lte.${to},scheduled_end.gte.${from})`,
  ].join(',');
}

export function contentWindowFilter(from: string, to: string): string {
  return `and(scheduled_at.gte.${from},scheduled_at.lte.${to})`;
}

function rows<T>(res: { data: unknown; error: unknown }, what: string): T[] {
  if (res.error) throw new Error(`briefing_source_${what}_failed`);
  return (res.data as T[] | null) ?? [];
}

function ids(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

export async function loadBriefingSources(
  admin: SupabaseClient,
  userId: string,
  timezone: string,
  localDate: string
): Promise<BriefingSources> {
  const empty: BriefingSources = {
    timezone,
    workspaces: {},
    tasks: [],
    content: [],
    projects: {},
    milestones: {},
    profiles: {},
    socialAccounts: {},
    parentTitles: {},
  };

  // Authorization: current memberships (any role can view, as in RLS).
  const memberships = rows<{ workspace_id: string }>(
    await admin.from('workspace_members').select('workspace_id').eq('user_id', userId),
    'memberships'
  );
  const workspaceIds = ids(memberships.map((m) => m.workspace_id));
  if (workspaceIds.length === 0) return empty;

  const wsRows = rows<{ id: string; name: string }>(
    await admin.from('workspaces').select('id, name').in('id', workspaceIds),
    'workspaces'
  );
  const workspaces: Record<string, string> = {};
  for (const w of wsRows) if (workspaceIds.includes(w.id)) workspaces[w.id] = w.name;
  const authorizedIds = Object.keys(workspaces);
  if (authorizedIds.length === 0) return empty;

  const { from, to } = utcWindowForDate(localDate);
  const tasks = rows<RawTask>(
    await admin
      .from('tasks')
      .select(TASK_COLUMNS)
      .in('workspace_id', authorizedIds)
      .neq('status', 'cancelled')
      .or(taskWindowFilter(from, to))
      .limit(MAX_ROWS),
    'tasks'
  );
  const content = rows<RawContent>(
    await admin
      .from('content_items')
      .select(CONTENT_COLUMNS)
      .in('workspace_id', authorizedIds)
      .neq('status', 'archived')
      .or(contentWindowFilter(from, to))
      .limit(MAX_ROWS),
    'content'
  );

  const projectIds = ids([...tasks.map((t) => t.project_id), ...content.map((c) => c.project_id)]);
  const milestoneIds = ids([...tasks.map((t) => t.milestone_id), ...content.map((c) => c.milestone_id)]);
  const accountIds = ids(content.map((c) => c.social_account_id));
  const assigneeIds = ids(tasks.map((t) => t.assigned_to));
  const parentIds = ids(tasks.map((t) => t.parent_task_id));

  const [projectRows, milestoneRows, accountRows, profileRows, parentRows] = await Promise.all([
    projectIds.length
      ? admin.from('projects').select('id, name').in('workspace_id', authorizedIds).in('id', projectIds)
      : { data: [], error: null },
    milestoneIds.length
      ? admin.from('milestones').select('id, title').in('workspace_id', authorizedIds).in('id', milestoneIds)
      : { data: [], error: null },
    accountIds.length
      ? admin.from('social_accounts').select('id, account_handle, account_name').in('workspace_id', authorizedIds).in('id', accountIds)
      : { data: [], error: null },
    assigneeIds.length ? admin.from('profiles').select('id, full_name').in('id', assigneeIds) : { data: [], error: null },
    parentIds.length
      ? admin.from('tasks').select('id, title').in('workspace_id', authorizedIds).in('id', parentIds)
      : { data: [], error: null },
  ]);

  const projects: Record<string, string> = {};
  for (const p of rows<{ id: string; name: string }>(projectRows, 'projects')) projects[p.id] = p.name;
  const milestones: Record<string, string> = {};
  for (const m of rows<{ id: string; title: string }>(milestoneRows, 'milestones')) milestones[m.id] = m.title;
  const socialAccounts: Record<string, string> = {};
  for (const a of rows<{ id: string; account_handle: string; account_name: string | null }>(accountRows, 'accounts')) {
    socialAccounts[a.id] = a.account_name?.trim() || a.account_handle;
  }
  const profiles: Record<string, string> = {};
  for (const p of rows<{ id: string; full_name: string | null }>(profileRows, 'profiles')) {
    if (p.full_name?.trim()) profiles[p.id] = p.full_name.trim();
  }
  const parentTitles: Record<string, string> = {};
  for (const p of rows<{ id: string; title: string }>(parentRows, 'parents')) parentTitles[p.id] = p.title;

  return { timezone, workspaces, tasks, content, projects, milestones, profiles, socialAccounts, parentTitles };
}
