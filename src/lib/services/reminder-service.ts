import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { formatInTimeZone, DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';
import {
  createNotification,
  getNotificationPreferences,
  type NotificationPreferencesWithDefaults,
} from '@/lib/services/notification-service';

export interface ReminderProcessingOptions {
  /** Reference timestamp for time comparisons. Defaults to new Date() / Date.now(). */
  referenceTime?: Date;
  /** Maximum number of records to evaluate per query batch (default: 100, max: 200). */
  batchLimit?: number;
  /** Overdue lookback window in milliseconds (default: 48 hours). Prevents scanning ancient tasks. */
  overdueLookbackMs?: number;
  /** Upcoming lookahead window in milliseconds (default: 7 days). */
  upcomingLookaheadMs?: number;
  /** Optional workspace filter to restrict processing to a single workspace. */
  workspaceId?: string;
}

export interface ReminderCategoryResult {
  category: 'upcoming_tasks' | 'overdue_tasks' | 'upcoming_content';
  evaluated: number;
  created: number;
  duplicates: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
}

export interface OverallReminderSummary {
  success: boolean;
  referenceTime: string;
  results: {
    upcomingTasks: ReminderCategoryResult;
    overdueTasks: ReminderCategoryResult;
    upcomingContent: ReminderCategoryResult;
  };
  totalCreated: number;
  totalDuplicates: number;
  totalSkipped: number;
  totalErrors: number;
  durationMs: number;
}

const DEFAULT_BATCH_LIMIT = 100;
const MAX_BATCH_LIMIT = 200;
const DEFAULT_OVERDUE_LOOKBACK_MS = 48 * 60 * 60 * 1000; // 48 hours
const DEFAULT_UPCOMING_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Retrieves notification preferences for a user in a workspace with in-memory batch caching.
 */
async function getCachedPreferences(
  adminSupabase: SupabaseClient<Database>,
  cache: Map<string, NotificationPreferencesWithDefaults>,
  workspaceId: string,
  userId: string
): Promise<NotificationPreferencesWithDefaults> {
  const cacheKey = `${workspaceId}:${userId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const prefs = await getNotificationPreferences(adminSupabase, workspaceId, userId);
  cache.set(cacheKey, prefs);
  return prefs;
}

/**
 * Evaluates candidate tasks scheduled in the future and generates upcoming task notifications
 * if the current reference time falls within the recipient's configured lead-time alert window.
 */
export async function processUpcomingTaskReminders(
  adminSupabase: SupabaseClient<Database>,
  options: ReminderProcessingOptions = {}
): Promise<ReminderCategoryResult> {
  const refTime = options.referenceTime ?? new Date();
  const nowMs = refTime.getTime();
  const nowIso = refTime.toISOString();
  const batchLimit = Math.min(Math.max(1, options.batchLimit ?? DEFAULT_BATCH_LIMIT), MAX_BATCH_LIMIT);
  const lookaheadMs = options.upcomingLookaheadMs ?? DEFAULT_UPCOMING_LOOKAHEAD_MS;
  const maxLookaheadIso = new Date(nowMs + lookaheadMs).toISOString();

  const result: ReminderCategoryResult = {
    category: 'upcoming_tasks',
    evaluated: 0,
    created: 0,
    duplicates: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
  };

  const prefCache = new Map<string, NotificationPreferencesWithDefaults>();

  try {
    let query = adminSupabase
      .from('tasks')
      .select('id, workspace_id, title, status, due_date, assigned_to, created_by, completed_at')
      .not('due_date', 'is', null)
      .gt('due_date', nowIso)
      .lte('due_date', maxLookaheadIso)
      .in('status', ['todo', 'in_progress', 'blocked'])
      .is('completed_at', null)
      .order('due_date', { ascending: true })
      .limit(batchLimit);

    if (options.workspaceId) {
      query = query.eq('workspace_id', options.workspaceId);
    }

    const { data: tasks, error: queryError } = await query;

    if (queryError) {
      result.errors++;
      result.errorMessages.push(`Database query failed for upcoming tasks: ${queryError.message}`);
      return result;
    }

    if (!tasks || tasks.length === 0) {
      return result;
    }

    for (const task of tasks) {
      result.evaluated++;
      const recipientId = task.assigned_to || task.created_by;

      if (!recipientId || !task.due_date) {
        result.skipped++;
        continue;
      }

      try {
        const prefs = await getCachedPreferences(
          adminSupabase,
          prefCache,
          task.workspace_id,
          recipientId
        );

        // Check user preferences
        if (!prefs.in_app_notifications_enabled || !prefs.notify_upcoming_tasks) {
          result.skipped++;
          continue;
        }

        const dueDateMs = new Date(task.due_date).getTime();
        if (isNaN(dueDateMs) || dueDateMs <= nowMs) {
          result.skipped++;
          continue;
        }

        const leadMinutes = prefs.reminder_lead_minutes ?? 60;
        const alertTimeMs = dueDateMs - leadMinutes * 60 * 1000;

        // Reminder only fires if reference time is within the alert window [alertTimeMs, dueDateMs)
        if (nowMs < alertTimeMs || nowMs >= dueDateMs) {
          result.skipped++;
          continue;
        }

        const timeFormatted = formatInTimeZone(task.due_date, DEFAULT_TIMEZONE, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });

        const normalizedDueDate = new Date(dueDateMs).toISOString();
        const title = `Upcoming Task: ${task.title}`;
        const message = `Task "${task.title}" is due on ${timeFormatted} (${leadMinutes} min reminder).`;
        const idempotencyKey = `task_upcoming:${task.id}:${normalizedDueDate}`;

        const creationResult = await createNotification(adminSupabase, task.workspace_id, {
          recipient_id: recipientId,
          channel: 'in_app',
          title,
          message,
          entity_type: 'task',
          entity_id: task.id,
          idempotency_key: idempotencyKey,
          scheduled_for: nowIso,
        });

        if (creationResult.isDuplicate) {
          result.duplicates++;
        } else {
          result.created++;
        }
      } catch (itemErr) {
        result.errors++;
        const msg = itemErr instanceof Error ? itemErr.message : String(itemErr);
        // Record diagnostic without leaking sensitive details
        result.errorMessages.push(`Task reminder dispatch failed for task ID ${task.id}: ${msg}`);
      }
    }
  } catch (err) {
    result.errors++;
    const msg = err instanceof Error ? err.message : String(err);
    result.errorMessages.push(`Unexpected error processing upcoming tasks: ${msg}`);
  }

  return result;
}

/**
 * Evaluates candidate tasks whose due_date is in the past and generates overdue task notifications
 * if incomplete and not completed/cancelled.
 */
export async function processOverdueTaskReminders(
  adminSupabase: SupabaseClient<Database>,
  options: ReminderProcessingOptions = {}
): Promise<ReminderCategoryResult> {
  const refTime = options.referenceTime ?? new Date();
  const nowMs = refTime.getTime();
  const nowIso = refTime.toISOString();
  const batchLimit = Math.min(Math.max(1, options.batchLimit ?? DEFAULT_BATCH_LIMIT), MAX_BATCH_LIMIT);
  const lookbackMs = options.overdueLookbackMs ?? DEFAULT_OVERDUE_LOOKBACK_MS;
  const minLookbackIso = new Date(nowMs - lookbackMs).toISOString();

  const result: ReminderCategoryResult = {
    category: 'overdue_tasks',
    evaluated: 0,
    created: 0,
    duplicates: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
  };

  const prefCache = new Map<string, NotificationPreferencesWithDefaults>();

  try {
    let query = adminSupabase
      .from('tasks')
      .select('id, workspace_id, title, status, due_date, assigned_to, created_by, completed_at')
      .not('due_date', 'is', null)
      .lt('due_date', nowIso)
      .gte('due_date', minLookbackIso)
      .in('status', ['todo', 'in_progress', 'blocked'])
      .is('completed_at', null)
      .order('due_date', { ascending: false })
      .limit(batchLimit);

    if (options.workspaceId) {
      query = query.eq('workspace_id', options.workspaceId);
    }

    const { data: tasks, error: queryError } = await query;

    if (queryError) {
      result.errors++;
      result.errorMessages.push(`Database query failed for overdue tasks: ${queryError.message}`);
      return result;
    }

    if (!tasks || tasks.length === 0) {
      return result;
    }

    for (const task of tasks) {
      result.evaluated++;
      const recipientId = task.assigned_to || task.created_by;

      if (!recipientId || !task.due_date) {
        result.skipped++;
        continue;
      }

      try {
        const dueDateMs = new Date(task.due_date).getTime();
        // Defensive time checks: must be strictly past due date and within lookback window
        if (isNaN(dueDateMs) || dueDateMs >= nowMs || dueDateMs < nowMs - lookbackMs) {
          result.skipped++;
          continue;
        }

        const prefs = await getCachedPreferences(
          adminSupabase,
          prefCache,
          task.workspace_id,
          recipientId
        );

        if (!prefs.in_app_notifications_enabled || !prefs.notify_overdue_tasks) {
          result.skipped++;
          continue;
        }

        const timeFormatted = formatInTimeZone(task.due_date, DEFAULT_TIMEZONE, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });

        const normalizedDueDate = new Date(dueDateMs).toISOString();
        const title = `Task Overdue: ${task.title}`;
        const message = `Task "${task.title}" was due on ${timeFormatted} and remains incomplete.`;
        const idempotencyKey = `task_overdue:${task.id}:${normalizedDueDate}`;

        const creationResult = await createNotification(adminSupabase, task.workspace_id, {
          recipient_id: recipientId,
          channel: 'in_app',
          title,
          message,
          entity_type: 'task',
          entity_id: task.id,
          idempotency_key: idempotencyKey,
          scheduled_for: nowIso,
        });

        if (creationResult.isDuplicate) {
          result.duplicates++;
        } else {
          result.created++;
        }
      } catch (itemErr) {
        result.errors++;
        const msg = itemErr instanceof Error ? itemErr.message : String(itemErr);
        result.errorMessages.push(`Overdue task reminder dispatch failed for task ID ${task.id}: ${msg}`);
      }
    }
  } catch (err) {
    result.errors++;
    const msg = err instanceof Error ? err.message : String(err);
    result.errorMessages.push(`Unexpected error processing overdue tasks: ${msg}`);
  }

  return result;
}

/**
 * Evaluates candidate scheduled content items and generates upcoming publication notifications
 * if the reference time falls within the creator's configured lead-time alert window.
 */
export async function processUpcomingContentReminders(
  adminSupabase: SupabaseClient<Database>,
  options: ReminderProcessingOptions = {}
): Promise<ReminderCategoryResult> {
  const refTime = options.referenceTime ?? new Date();
  const nowMs = refTime.getTime();
  const nowIso = refTime.toISOString();
  const batchLimit = Math.min(Math.max(1, options.batchLimit ?? DEFAULT_BATCH_LIMIT), MAX_BATCH_LIMIT);
  const lookaheadMs = options.upcomingLookaheadMs ?? DEFAULT_UPCOMING_LOOKAHEAD_MS;
  const maxLookaheadIso = new Date(nowMs + lookaheadMs).toISOString();

  const result: ReminderCategoryResult = {
    category: 'upcoming_content',
    evaluated: 0,
    created: 0,
    duplicates: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
  };

  const prefCache = new Map<string, NotificationPreferencesWithDefaults>();

  try {
    let query = adminSupabase
      .from('content_items')
      .select('id, workspace_id, title, platform, status, scheduled_at, created_by')
      .not('scheduled_at', 'is', null)
      .gt('scheduled_at', nowIso)
      .lte('scheduled_at', maxLookaheadIso)
      .eq('status', 'scheduled')
      .order('scheduled_at', { ascending: true })
      .limit(batchLimit);

    if (options.workspaceId) {
      query = query.eq('workspace_id', options.workspaceId);
    }

    const { data: contentItems, error: queryError } = await query;

    if (queryError) {
      result.errors++;
      result.errorMessages.push(`Database query failed for upcoming content: ${queryError.message}`);
      return result;
    }

    if (!contentItems || contentItems.length === 0) {
      return result;
    }

    for (const item of contentItems) {
      result.evaluated++;
      const recipientId = item.created_by;

      if (!recipientId || !item.scheduled_at) {
        result.skipped++;
        continue;
      }

      try {
        const prefs = await getCachedPreferences(
          adminSupabase,
          prefCache,
          item.workspace_id,
          recipientId
        );

        if (!prefs.in_app_notifications_enabled || !prefs.notify_upcoming_content) {
          result.skipped++;
          continue;
        }

        const scheduledTimeMs = new Date(item.scheduled_at).getTime();
        if (isNaN(scheduledTimeMs) || scheduledTimeMs <= nowMs) {
          result.skipped++;
          continue;
        }

        const leadMinutes = prefs.reminder_lead_minutes ?? 60;
        const alertTimeMs = scheduledTimeMs - leadMinutes * 60 * 1000;

        if (nowMs < alertTimeMs || nowMs >= scheduledTimeMs) {
          result.skipped++;
          continue;
        }

        const timeFormatted = formatInTimeZone(item.scheduled_at, DEFAULT_TIMEZONE, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });

        const normalizedSchedAt = new Date(scheduledTimeMs).toISOString();
        const platformDisplay = item.platform.charAt(0).toUpperCase() + item.platform.slice(1);
        const itemTitle = item.title?.trim() || 'Untitled post';
        const title = `Upcoming Scheduled Content: ${platformDisplay}`;
        const message = `Your ${platformDisplay} post "${itemTitle}" is scheduled for publication on ${timeFormatted} (${leadMinutes} min reminder).`;
        const idempotencyKey = `content_upcoming:${item.id}:${normalizedSchedAt}`;

        const creationResult = await createNotification(adminSupabase, item.workspace_id, {
          recipient_id: recipientId,
          channel: 'in_app',
          title,
          message,
          entity_type: 'content_item',
          entity_id: item.id,
          idempotency_key: idempotencyKey,
          scheduled_for: nowIso,
        });

        if (creationResult.isDuplicate) {
          result.duplicates++;
        } else {
          result.created++;
        }
      } catch (itemErr) {
        result.errors++;
        const msg = itemErr instanceof Error ? itemErr.message : String(itemErr);
        result.errorMessages.push(`Content reminder dispatch failed for content ID ${item.id}: ${msg}`);
      }
    }
  } catch (err) {
    result.errors++;
    const msg = err instanceof Error ? err.message : String(err);
    result.errorMessages.push(`Unexpected error processing upcoming content: ${msg}`);
  }

  return result;
}

/**
 * Runs a complete reminder evaluation cycle across upcoming tasks, overdue tasks,
 * and upcoming content items.
 */
export async function processAllReminders(
  adminSupabase: SupabaseClient<Database>,
  options: ReminderProcessingOptions = {}
): Promise<OverallReminderSummary> {
  const startMs = Date.now();
  const refTime = options.referenceTime ?? new Date();

  // Execute each category with shared reference time for consistency
  const [upcomingTasks, overdueTasks, upcomingContent] = await Promise.all([
    processUpcomingTaskReminders(adminSupabase, { ...options, referenceTime: refTime }),
    processOverdueTaskReminders(adminSupabase, { ...options, referenceTime: refTime }),
    processUpcomingContentReminders(adminSupabase, { ...options, referenceTime: refTime }),
  ]);

  const totalCreated = upcomingTasks.created + overdueTasks.created + upcomingContent.created;
  const totalDuplicates = upcomingTasks.duplicates + overdueTasks.duplicates + upcomingContent.duplicates;
  const totalSkipped = upcomingTasks.skipped + overdueTasks.skipped + upcomingContent.skipped;
  const totalErrors = upcomingTasks.errors + overdueTasks.errors + upcomingContent.errors;

  return {
    success: totalErrors === 0,
    referenceTime: refTime.toISOString(),
    results: {
      upcomingTasks,
      overdueTasks,
      upcomingContent,
    },
    totalCreated,
    totalDuplicates,
    totalSkipped,
    totalErrors,
    durationMs: Date.now() - startMs,
  };
}
