import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Database,
  SocialPlatform,
  TaskPriority,
  TaskStatus,
  ContentStatus,
  ContentActionType,
} from '@/types/database';
import { resolveAuthorizedWorkspace } from '@/lib/auth/workspace';
import { getNotifications, type NotificationRow } from '@/lib/services/notification-service';
import {
  DEFAULT_TIMEZONE,
  normalizeTimeZone,
  isValidTimeZone,
} from '@/lib/temporal/timezone';
import {
  getDayRange,
  getNextDayDate,
} from '@/lib/temporal/calendar';

export interface UrgentTaskItem {
  id: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  project_id: string | null;
}

export interface UpcomingContentItem {
  id: string;
  title: string | null;
  platform: SocialPlatform;
  action_type: ContentActionType;
  status: ContentStatus;
  scheduled_at: string | null;
}

export interface DashboardTaskMetrics {
  overdueCount: number;
  dueTodayCount: number;
  pendingSubtasksCount: number;
  blockedCount: number;
  urgentTasks: UrgentTaskItem[];
}

export interface DashboardContentMetrics {
  draftCount: number;
  ideaCount: number;
  scheduledNext7DaysCount: number;
  scheduledNext24HoursCount: number;
  byPlatform: Record<SocialPlatform, number>;
  upcomingItems: UpcomingContentItem[];
}

export interface DashboardNotificationMetrics {
  unreadCount: number;
  recentUnread: NotificationRow[];
}

export interface DashboardSummary {
  workspaceId: string;
  userId: string;
  referenceTime: string;
  timeZone: string;
  tasks: DashboardTaskMetrics;
  content: DashboardContentMetrics;
  notifications: DashboardNotificationMetrics;
}

export interface DashboardOptions {
  referenceTime?: Date;
  userTimeZone?: string;
  urgentTaskLimit?: number;
  upcomingContentLimit?: number;
}

const SUPPORTED_PLATFORMS: SocialPlatform[] = ['linkedin', 'reddit', 'threads', 'x'];

function assertUuid(id: string, paramName: string) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || typeof id !== 'string' || !uuidRegex.test(id)) {
    throw new Error(`Invalid ${paramName}: must be a valid UUID`);
  }
}

/**
 * Aggregates operational metrics across tasks, scheduled content, and notifications
 * for the authenticated user's authorized workspace.
 * 
 * Authorization Invariant:
 * Runs strictly with the caller's authenticated Supabase client (respecting Row Level Security).
 * Verifies workspace membership before executing metrics queries and isolates all data to the
 * authorized workspace and authenticated recipient.
 */
export async function getDashboardSummary(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  userId: string,
  options: DashboardOptions = {}
): Promise<DashboardSummary> {
  assertUuid(workspaceId, 'workspace_id');
  assertUuid(userId, 'user_id');

  // 1. Authorize workspace membership
  const { workspaceId: authorizedWsId, error: authError } = await resolveAuthorizedWorkspace(
    supabase,
    userId,
    workspaceId
  );

  if (authError || !authorizedWsId) {
    throw new Error(`Unauthorized: User ${userId} does not have access to workspace ${workspaceId}`);
  }

  // 2. Resolve single reference timestamp to prevent metric drift
  const referenceTime = options.referenceTime ?? new Date();
  const refTimeIso = referenceTime.toISOString();

  // 3. Resolve effective IANA timezone (caller option -> profile timezone -> default fallback)
  let effectiveTimeZone = DEFAULT_TIMEZONE;
  if (options.userTimeZone && isValidTimeZone(options.userTimeZone)) {
    effectiveTimeZone = normalizeTimeZone(options.userTimeZone);
  } else {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('timezone')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      throw new Error(`Failed to query user profile timezone: ${profileError.message}`);
    }

    if (profile?.timezone && isValidTimeZone(profile.timezone)) {
      effectiveTimeZone = normalizeTimeZone(profile.timezone);
    }
  }

  // 4. Calculate timezone-aware calendar boundaries
  const nextDayMidday = getNextDayDate(referenceTime, effectiveTimeZone);
  const tomorrowRange = getDayRange(nextDayMidday, effectiveTimeZone);
  const startOfNextDayIso = tomorrowRange.dayStart.toISOString();

  const in24HoursIso = new Date(referenceTime.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const in7DaysIso = new Date(referenceTime.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const urgentTaskLimit = Math.min(Math.max(1, options.urgentTaskLimit ?? 5), 10);
  const upcomingContentLimit = Math.min(Math.max(1, options.upcomingContentLimit ?? 5), 10);

  // 5. Execute parallel, bounded database queries
  const [
    overdueRes,
    dueTodayRes,
    pendingSubtasksRes,
    blockedRes,
    dueSoonTasksRes,
    urgentPriorityTasksRes,
    highPriorityTasksRes,
    draftsRes,
    ideasRes,
    scheduled24hRes,
    scheduled7dRes,
    linkedinRes,
    redditRes,
    threadsRes,
    xRes,
    upcomingContentRes,
    notificationsRes,
  ] = await Promise.all([
    // Task 1: Overdue active top-level tasks (strictly earlier than reference time)
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', authorizedWsId)
      .is('parent_task_id', null)
      .in('status', ['todo', 'in_progress', 'blocked'])
      .is('completed_at', null)
      .not('due_date', 'is', null)
      .lt('due_date', refTimeIso),

    // Task 2: Due today active top-level tasks (at/after reference time and before start of next day)
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', authorizedWsId)
      .is('parent_task_id', null)
      .in('status', ['todo', 'in_progress', 'blocked'])
      .is('completed_at', null)
      .gte('due_date', refTimeIso)
      .lt('due_date', startOfNextDayIso),

    // Task 3: Pending subtasks (parent_task_id is not null, status not done/cancelled)
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', authorizedWsId)
      .not('parent_task_id', 'is', null)
      .in('status', ['todo', 'in_progress', 'blocked'])
      .is('completed_at', null),

    // Task 4: Blocked top-level tasks
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', authorizedWsId)
      .is('parent_task_id', null)
      .eq('status', 'blocked')
      .is('completed_at', null),

    // Task 5a: Overdue & due-today tasks (guaranteed top candidates chronologically)
    supabase
      .from('tasks')
      .select('id, title, priority, status, due_date, project_id, created_at')
      .eq('workspace_id', authorizedWsId)
      .is('parent_task_id', null)
      .in('status', ['todo', 'in_progress', 'blocked'])
      .is('completed_at', null)
      .not('due_date', 'is', null)
      .lt('due_date', startOfNextDayIso)
      .order('due_date', { ascending: true })
      .limit(urgentTaskLimit),

    // Task 5b: Urgent priority tasks (guaranteed top urgent candidates)
    supabase
      .from('tasks')
      .select('id, title, priority, status, due_date, project_id, created_at')
      .eq('workspace_id', authorizedWsId)
      .is('parent_task_id', null)
      .in('status', ['todo', 'in_progress', 'blocked'])
      .is('completed_at', null)
      .eq('priority', 'urgent')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(urgentTaskLimit),

    // Task 5c: High priority tasks (guaranteed top high candidates)
    supabase
      .from('tasks')
      .select('id, title, priority, status, due_date, project_id, created_at')
      .eq('workspace_id', authorizedWsId)
      .is('parent_task_id', null)
      .in('status', ['todo', 'in_progress', 'blocked'])
      .is('completed_at', null)
      .eq('priority', 'high')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(urgentTaskLimit),

    // Content 1: Draft count
    supabase
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', authorizedWsId)
      .eq('status', 'draft'),

    // Content 2: Idea count
    supabase
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', authorizedWsId)
      .eq('status', 'idea'),

    // Content 3: Scheduled next 24 hours
    supabase
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', authorizedWsId)
      .eq('status', 'scheduled')
      .not('scheduled_at', 'is', null)
      .gte('scheduled_at', refTimeIso)
      .lte('scheduled_at', in24HoursIso),

    // Content 4: Scheduled next 7 days
    supabase
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', authorizedWsId)
      .eq('status', 'scheduled')
      .not('scheduled_at', 'is', null)
      .gte('scheduled_at', refTimeIso)
      .lte('scheduled_at', in7DaysIso),

    // Content 5a: Future scheduled LinkedIn
    supabase
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', authorizedWsId)
      .eq('status', 'scheduled')
      .not('scheduled_at', 'is', null)
      .gte('scheduled_at', refTimeIso)
      .eq('platform', 'linkedin'),

    // Content 5b: Future scheduled Reddit
    supabase
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', authorizedWsId)
      .eq('status', 'scheduled')
      .not('scheduled_at', 'is', null)
      .gte('scheduled_at', refTimeIso)
      .eq('platform', 'reddit'),

    // Content 5c: Future scheduled Threads
    supabase
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', authorizedWsId)
      .eq('status', 'scheduled')
      .not('scheduled_at', 'is', null)
      .gte('scheduled_at', refTimeIso)
      .eq('platform', 'threads'),

    // Content 5d: Future scheduled X
    supabase
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', authorizedWsId)
      .eq('status', 'scheduled')
      .not('scheduled_at', 'is', null)
      .gte('scheduled_at', refTimeIso)
      .eq('platform', 'x'),

    // Content 6: Upcoming scheduled items list (bounded)
    supabase
      .from('content_items')
      .select('id, title, platform, action_type, status, scheduled_at')
      .eq('workspace_id', authorizedWsId)
      .eq('status', 'scheduled')
      .not('scheduled_at', 'is', null)
      .gte('scheduled_at', refTimeIso)
      .order('scheduled_at', { ascending: true })
      .limit(upcomingContentLimit),

    // Notification metrics: Bounded to 5 unread items for authenticated recipient
    getNotifications(supabase, authorizedWsId, userId, {
      unread_only: true,
      limit: 5,
    }),
  ]);

  // Check errors on all count and list queries
  if (overdueRes.error) throw new Error(`Failed to query overdue tasks: ${overdueRes.error.message}`);
  if (dueTodayRes.error) throw new Error(`Failed to query tasks due today: ${dueTodayRes.error.message}`);
  if (pendingSubtasksRes.error) throw new Error(`Failed to query pending subtasks: ${pendingSubtasksRes.error.message}`);
  if (blockedRes.error) throw new Error(`Failed to query blocked tasks: ${blockedRes.error.message}`);
  if (dueSoonTasksRes.error) throw new Error(`Failed to query due-soon tasks: ${dueSoonTasksRes.error.message}`);
  if (urgentPriorityTasksRes.error) throw new Error(`Failed to query urgent priority tasks: ${urgentPriorityTasksRes.error.message}`);
  if (highPriorityTasksRes.error) throw new Error(`Failed to query high priority tasks: ${highPriorityTasksRes.error.message}`);

  if (draftsRes.error) throw new Error(`Failed to query content drafts: ${draftsRes.error.message}`);
  if (ideasRes.error) throw new Error(`Failed to query content ideas: ${ideasRes.error.message}`);
  if (scheduled24hRes.error) throw new Error(`Failed to query content scheduled in 24h: ${scheduled24hRes.error.message}`);
  if (scheduled7dRes.error) throw new Error(`Failed to query content scheduled in 7d: ${scheduled7dRes.error.message}`);

  if (linkedinRes.error) throw new Error(`Failed to query LinkedIn content count: ${linkedinRes.error.message}`);
  if (redditRes.error) throw new Error(`Failed to query Reddit content count: ${redditRes.error.message}`);
  if (threadsRes.error) throw new Error(`Failed to query Threads content count: ${threadsRes.error.message}`);
  if (xRes.error) throw new Error(`Failed to query X content count: ${xRes.error.message}`);

  if (upcomingContentRes.error) throw new Error(`Failed to query upcoming content list: ${upcomingContentRes.error.message}`);

  // 6. Deterministically prioritize and bound tasks requiring attention across the 3 streams
  const seenTaskIds = new Set<string>();
  const tier1Overdue: UrgentTaskItem[] = [];
  const tier2DueToday: UrgentTaskItem[] = [];
  const tier3Urgent: UrgentTaskItem[] = [];
  const tier4High: UrgentTaskItem[] = [];

  const mapItem = (t: any): UrgentTaskItem => ({
    id: t.id,
    title: t.title,
    priority: t.priority as TaskPriority,
    status: t.status as TaskStatus,
    due_date: t.due_date,
    project_id: t.project_id,
  });

  // Tier 1 (overdue) and Tier 2 (due today) from dueSoonTasksRes
  for (const t of dueSoonTasksRes.data ?? []) {
    if (!seenTaskIds.has(t.id)) {
      if (t.due_date && t.due_date < refTimeIso) {
        seenTaskIds.add(t.id);
        tier1Overdue.push(mapItem(t));
      } else if (t.due_date && t.due_date >= refTimeIso && t.due_date < startOfNextDayIso) {
        seenTaskIds.add(t.id);
        tier2DueToday.push(mapItem(t));
      }
    }
  }

  // Tier 3: Other active tasks with urgent priority
  for (const t of urgentPriorityTasksRes.data ?? []) {
    if (!seenTaskIds.has(t.id)) {
      seenTaskIds.add(t.id);
      tier3Urgent.push(mapItem(t));
    }
  }

  // Tier 4: Remaining active tasks with high priority
  for (const t of highPriorityTasksRes.data ?? []) {
    if (!seenTaskIds.has(t.id)) {
      seenTaskIds.add(t.id);
      tier4High.push(mapItem(t));
    }
  }

  // Stable sorting within groups:
  // Tiers 1 & 2 sort by due_date ascending
  tier1Overdue.sort((a, b) => (a.due_date && b.due_date ? a.due_date.localeCompare(b.due_date) : 0));
  tier2DueToday.sort((a, b) => (a.due_date && b.due_date ? a.due_date.localeCompare(b.due_date) : 0));
  // Tiers 3 & 4 sort by due_date ascending (nulls last)
  const nullsLastDueSort = (a: UrgentTaskItem, b: UrgentTaskItem) => {
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date && !b.due_date) return -1;
    if (!a.due_date && b.due_date) return 1;
    return a.id.localeCompare(b.id);
  };
  tier3Urgent.sort(nullsLastDueSort);
  tier4High.sort(nullsLastDueSort);

  const prioritizedTasks = [...tier1Overdue, ...tier2DueToday, ...tier3Urgent, ...tier4High].slice(
    0,
    urgentTaskLimit
  );

  // 7. Format platform breakdown with all 4 keys guaranteed
  const byPlatform: Record<SocialPlatform, number> = {
    linkedin: linkedinRes.count ?? 0,
    reddit: redditRes.count ?? 0,
    threads: threadsRes.count ?? 0,
    x: xRes.count ?? 0,
  };

  const upcomingItems: UpcomingContentItem[] = (upcomingContentRes.data ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    platform: c.platform as SocialPlatform,
    action_type: c.action_type as ContentActionType,
    status: c.status as ContentStatus,
    scheduled_at: c.scheduled_at,
  }));

  return {
    workspaceId: authorizedWsId,
    userId,
    referenceTime: refTimeIso,
    timeZone: effectiveTimeZone,
    tasks: {
      overdueCount: overdueRes.count ?? 0,
      dueTodayCount: dueTodayRes.count ?? 0,
      pendingSubtasksCount: pendingSubtasksRes.count ?? 0,
      blockedCount: blockedRes.count ?? 0,
      urgentTasks: prioritizedTasks,
    },
    content: {
      draftCount: draftsRes.count ?? 0,
      ideaCount: ideasRes.count ?? 0,
      scheduledNext7DaysCount: scheduled7dRes.count ?? 0,
      scheduledNext24HoursCount: scheduled24hRes.count ?? 0,
      byPlatform,
      upcomingItems,
    },
    notifications: {
      unreadCount: notificationsRes.total,
      recentUnread: notificationsRes.notifications,
    },
  };
}
