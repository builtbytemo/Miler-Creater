import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, TaskStatus, ContentStatus, SocialPlatform, ContentActionType, TaskPriority } from '@/types/database';
import { formatInTimeZone, DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';

export type ScheduleItemType = 'task' | 'content';

export interface UnifiedScheduleItem {
  id: string;
  itemType: ScheduleItemType;
  title: string;
  status: TaskStatus | ContentStatus | string;
  // Timing
  startTime: string | null; // UTC ISO
  endTime: string | null; // UTC ISO
  deadline: string | null; // UTC ISO
  isAllDay: boolean;
  localDisplayTime: string | null; // e.g. "02:00 PM" in user's timezone
  // Associations
  projectId: string | null;
  projectName?: string | null;
  projectColor?: string | null;
  // Type-specific metadata
  platform?: SocialPlatform | null;
  actionType?: ContentActionType | null;
  priority?: TaskPriority | null;
  isBlocked?: boolean;
}

export interface UnifiedScheduleFilter {
  startDate: string; // ISO string
  endDate: string; // ISO string
  itemTypes?: ('task' | 'content')[];
  statuses?: string[];
  platforms?: SocialPlatform[];
  projectIds?: string[];
  userTimeZone?: string;
  includeCompleted?: boolean;
}

export interface UnifiedScheduleResult {
  /** Chronologically scheduled events within the date range */
  events: UnifiedScheduleItem[];
  /** Items with a deadline falling in the range, but lacking a scheduled time block */
  deadlineItems: UnifiedScheduleItem[];
  totalEvents: number;
  totalDeadlines: number;
}

/**
 * Unified server-side scheduling query layer.
 * Retrieves scheduled tasks and scheduled social content items for a date range
 * through a single, consistent interface with zero cross-table duplicates.
 */
export async function getUnifiedSchedule(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  filter: UnifiedScheduleFilter
): Promise<UnifiedScheduleResult> {
  const {
    startDate,
    endDate,
    itemTypes = ['task', 'content'],
    statuses,
    platforms,
    projectIds,
    userTimeZone = DEFAULT_TIMEZONE,
    includeCompleted = true,
  } = filter;

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('Invalid startDate or endDate provided to getUnifiedSchedule');
  }

  if (end.getTime() < start.getTime()) {
    throw new Error('endDate cannot be earlier than startDate');
  }

  // Bound maximum query window to 120 days to guarantee bounded database queries
  const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > 120) {
    throw new Error('Query range exceeds the maximum allowed window of 120 days.');
  }

  const events: UnifiedScheduleItem[] = [];
  const deadlineItems: UnifiedScheduleItem[] = [];

  // ==========================================
  // 1. QUERY TASKS (if requested)
  // ==========================================
  if (itemTypes.includes('task')) {
    // 1A. Scheduled Tasks
    let taskQuery = supabase
      .from('tasks')
      .select(`
        id,
        title,
        status,
        priority,
        scheduled_start,
        scheduled_end,
        due_date,
        is_all_day,
        project_id,
        projects (id, name, color)
      `)
      .eq('workspace_id', workspaceId)
      .not('scheduled_start', 'is', null)
      .gte('scheduled_start', startDate)
      .lte('scheduled_start', endDate);

    if (!includeCompleted) {
      taskQuery = taskQuery.not('status', 'in', '("done","cancelled")');
    }
    if (statuses && statuses.length > 0) {
      taskQuery = taskQuery.in('status', statuses as TaskStatus[]);
    }
    if (projectIds && projectIds.length > 0) {
      taskQuery = taskQuery.in('project_id', projectIds);
    }

    const { data: scheduledTasks, error: taskErr } = await taskQuery;
    if (taskErr) {
      throw new Error(`Failed to query scheduled tasks: ${taskErr.message}`);
    }

    if (scheduledTasks) {
      for (const t of scheduledTasks) {
        const project = (t as unknown as { projects?: { id: string; name: string; color: string | null } }).projects;
        const displayTime = t.scheduled_start
          ? formatInTimeZone(t.scheduled_start, userTimeZone, {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })
          : null;

        events.push({
          id: t.id,
          itemType: 'task',
          title: t.title,
          status: t.status,
          startTime: t.scheduled_start,
          endTime: t.scheduled_end,
          deadline: t.due_date,
          isAllDay: t.is_all_day,
          localDisplayTime: t.is_all_day ? 'All Day' : displayTime,
          projectId: t.project_id,
          projectName: project?.name || null,
          projectColor: project?.color || null,
          priority: t.priority,
          isBlocked: t.status === 'blocked',
        });
      }
    }

    // 1B. Tasks with Deadlines but No Scheduled Start
    let deadlineQuery = supabase
      .from('tasks')
      .select(`
        id,
        title,
        status,
        priority,
        scheduled_start,
        scheduled_end,
        due_date,
        is_all_day,
        project_id,
        projects (id, name, color)
      `)
      .eq('workspace_id', workspaceId)
      .is('scheduled_start', null)
      .not('due_date', 'is', null)
      .gte('due_date', startDate)
      .lte('due_date', endDate);

    if (!includeCompleted) {
      deadlineQuery = deadlineQuery.not('status', 'in', '("done","cancelled")');
    }
    if (statuses && statuses.length > 0) {
      deadlineQuery = deadlineQuery.in('status', statuses as TaskStatus[]);
    }
    if (projectIds && projectIds.length > 0) {
      deadlineQuery = deadlineQuery.in('project_id', projectIds);
    }

    const { data: rawDeadlines, error: dlErr } = await deadlineQuery;
    if (dlErr) {
      throw new Error(`Failed to query task deadlines: ${dlErr.message}`);
    }

    if (rawDeadlines) {
      for (const d of rawDeadlines) {
        const project = (d as unknown as { projects?: { id: string; name: string; color: string | null } }).projects;
        const displayTime = d.due_date
          ? formatInTimeZone(d.due_date, userTimeZone, {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })
          : null;

        deadlineItems.push({
          id: d.id,
          itemType: 'task',
          title: d.title,
          status: d.status,
          startTime: null,
          endTime: null,
          deadline: d.due_date,
          isAllDay: d.is_all_day,
          localDisplayTime: displayTime,
          projectId: d.project_id,
          projectName: project?.name || null,
          projectColor: project?.color || null,
          priority: d.priority,
          isBlocked: d.status === 'blocked',
        });
      }
    }
  }

  // ==========================================
  // 2. QUERY SCHEDULED CONTENT ITEMS (if requested)
  // ==========================================
  // Note: Unscheduled ideas (scheduled_at IS NULL) are explicitly excluded from calendar events
  if (itemTypes.includes('content')) {
    let contentQuery = supabase
      .from('content_items')
      .select(`
        id,
        title,
        platform,
        action_type,
        status,
        scheduled_at,
        duration_minutes,
        project_id,
        projects (id, name, color)
      `)
      .eq('workspace_id', workspaceId)
      .not('scheduled_at', 'is', null)
      .gte('scheduled_at', startDate)
      .lte('scheduled_at', endDate);

    if (!includeCompleted) {
      contentQuery = contentQuery.not('status', 'in', '("published","archived")');
    }
    if (statuses && statuses.length > 0) {
      contentQuery = contentQuery.in('status', statuses as ContentStatus[]);
    }
    if (platforms && platforms.length > 0) {
      contentQuery = contentQuery.in('platform', platforms);
    }
    if (projectIds && projectIds.length > 0) {
      contentQuery = contentQuery.in('project_id', projectIds);
    }

    const { data: scheduledContent, error: contentErr } = await contentQuery;
    if (contentErr) {
      throw new Error(`Failed to query scheduled content items: ${contentErr.message}`);
    }

    if (scheduledContent) {
      for (const c of scheduledContent) {
        const project = (c as unknown as { projects?: { id: string; name: string; color: string | null } }).projects;
        let endTimeIso: string | null = null;

        if (c.scheduled_at && c.duration_minutes) {
          endTimeIso = new Date(
            new Date(c.scheduled_at).getTime() + c.duration_minutes * 60000
          ).toISOString();
        }

        const displayTime = c.scheduled_at
          ? formatInTimeZone(c.scheduled_at, userTimeZone, {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })
          : null;

        events.push({
          id: c.id,
          itemType: 'content',
          title: c.title || `Scheduled ${c.platform} ${c.action_type}`,
          status: c.status,
          startTime: c.scheduled_at,
          endTime: endTimeIso,
          deadline: null,
          isAllDay: false,
          localDisplayTime: displayTime,
          projectId: c.project_id,
          projectName: project?.name || null,
          projectColor: project?.color || null,
          platform: c.platform,
          actionType: c.action_type,
        });
      }
    }
  }

  // 3. Sort scheduled events chronologically by start time
  events.sort((a, b) => {
    const timeA = a.startTime ? new Date(a.startTime).getTime() : 0;
    const timeB = b.startTime ? new Date(b.startTime).getTime() : 0;
    return timeA - timeB;
  });

  // 4. Sort deadline items by deadline date
  deadlineItems.sort((a, b) => {
    const timeA = a.deadline ? new Date(a.deadline).getTime() : 0;
    const timeB = b.deadline ? new Date(b.deadline).getTime() : 0;
    return timeA - timeB;
  });

  return {
    events,
    deadlineItems,
    totalEvents: events.length,
    totalDeadlines: deadlineItems.length,
  };
}
