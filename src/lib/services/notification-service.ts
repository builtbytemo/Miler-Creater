import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import {
  notificationFilterSchema,
  createNotificationSchema,
  updateNotificationPreferencesSchema,
  type NotificationFilterInput,
  type CreateNotificationInput,
  type UpdateNotificationPreferencesInput,
} from '@/lib/validation/notification';

export type NotificationRow = Database['public']['Tables']['notifications']['Row'];
export type NotificationPreferencesRow = Database['public']['Tables']['notification_preferences']['Row'];

export interface NotificationPreferencesWithDefaults {
  id: string | null;
  workspace_id: string;
  user_id: string;
  notify_upcoming_tasks: boolean;
  notify_overdue_tasks: boolean;
  notify_upcoming_content: boolean;
  notify_status_changes: boolean;
  reminder_lead_minutes: number;
  email_notifications_enabled: boolean;
  in_app_notifications_enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface PaginatedNotifications {
  notifications: NotificationRow[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface CreateNotificationResult {
  notification: NotificationRow;
  isDuplicate: boolean;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(val: string, fieldName: string): void {
  if (!val || typeof val !== 'string' || !UUID_REGEX.test(val)) {
    throw new Error(`Invalid ${fieldName} UUID format: ${val}`);
  }
}

/**
 * Returns canonical in-memory notification preference defaults when no row exists in the database.
 * Does NOT write to the database merely upon reading.
 */
export function getDefaultNotificationPreferences(
  workspaceId: string,
  userId: string
): NotificationPreferencesWithDefaults {
  return {
    id: null,
    workspace_id: workspaceId,
    user_id: userId,
    notify_upcoming_tasks: true,
    notify_overdue_tasks: true,
    notify_upcoming_content: true,
    notify_status_changes: true,
    reminder_lead_minutes: 60,
    email_notifications_enabled: false,
    in_app_notifications_enabled: true,
    created_at: null,
    updated_at: null,
  };
}

/**
 * Lists notifications for the authenticated user in the specified workspace,
 * ordered newest first, with bounded pagination and optional filtering.
 */
export async function getNotifications(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  recipientId: string,
  filter: NotificationFilterInput = {}
): Promise<PaginatedNotifications> {
  assertUuid(workspaceId, 'workspace_id');
  assertUuid(recipientId, 'recipient_id');

  const validatedFilter = notificationFilterSchema.parse(filter);
  const page = validatedFilter.page ?? 1;
  const limit = validatedFilter.limit ?? 20;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .eq('recipient_id', recipientId);

  // Status filtering (defaults to excluding dismissed unless explicitly requested)
  if (validatedFilter.status) {
    if (Array.isArray(validatedFilter.status)) {
      query = query.in('status', validatedFilter.status);
    } else {
      query = query.eq('status', validatedFilter.status);
    }
  } else {
    query = query.neq('status', 'dismissed');
  }

  if (validatedFilter.channel) {
    query = query.eq('channel', validatedFilter.channel);
  }

  if (validatedFilter.entity_type) {
    query = query.eq('entity_type', validatedFilter.entity_type);
  }

  if (validatedFilter.unread_only) {
    query = query.is('read_at', null);
  }

  query = query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to list notifications: ${error.message}`);
  }

  const total = count ?? 0;
  const notifications = data ?? [];
  const hasMore = offset + notifications.length < total;

  return {
    notifications,
    total,
    page,
    limit,
    hasMore,
  };
}

/**
 * Retrieves the count of unread notifications for a user within a workspace.
 */
export async function getUnreadNotificationCount(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  recipientId: string
): Promise<number> {
  assertUuid(workspaceId, 'workspace_id');
  assertUuid(recipientId, 'recipient_id');

  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('recipient_id', recipientId)
    .is('read_at', null)
    .neq('status', 'dismissed');

  if (error) {
    throw new Error(`Failed to get unread notification count: ${error.message}`);
  }

  return count ?? 0;
}

/**
 * Marks a single notification as read by setting its read_at timestamp.
 * Preserves the existing delivery status ('pending', 'delivered', etc.)
 * and complies with database trigger immutability restrictions.
 */
export async function markNotificationAsRead(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  recipientId: string,
  notificationId: string
): Promise<NotificationRow> {
  assertUuid(workspaceId, 'workspace_id');
  assertUuid(recipientId, 'recipient_id');
  assertUuid(notificationId, 'notification_id');

  const { data, error } = await supabase
    .from('notifications')
    .update({
      read_at: new Date().toISOString(),
    })
    .eq('id', notificationId)
    .eq('workspace_id', workspaceId)
    .eq('recipient_id', recipientId)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to mark notification as read: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Notification ${notificationId} not found or access denied`);
  }

  return data;
}

/**
 * Marks a single notification as unread by clearing its read_at timestamp.
 */
export async function markNotificationAsUnread(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  recipientId: string,
  notificationId: string
): Promise<NotificationRow> {
  assertUuid(workspaceId, 'workspace_id');
  assertUuid(recipientId, 'recipient_id');
  assertUuid(notificationId, 'notification_id');

  const { data, error } = await supabase
    .from('notifications')
    .update({
      read_at: null,
    })
    .eq('id', notificationId)
    .eq('workspace_id', workspaceId)
    .eq('recipient_id', recipientId)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to mark notification as unread: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Notification ${notificationId} not found or access denied`);
  }

  return data;
}

/**
 * Marks all unread, active notifications as read for the user in the workspace.
 * Returns the count of marked notifications.
 */
export async function markAllNotificationsAsRead(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  recipientId: string
): Promise<number> {
  assertUuid(workspaceId, 'workspace_id');
  assertUuid(recipientId, 'recipient_id');

  const { data, error } = await supabase
    .from('notifications')
    .update({
      read_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('recipient_id', recipientId)
    .is('read_at', null)
    .neq('status', 'dismissed')
    .select('id');

  if (error) {
    throw new Error(`Failed to mark all notifications as read: ${error.message}`);
  }

  return data?.length ?? 0;
}

/**
 * Dismisses a notification by updating its status to 'dismissed'.
 */
export async function dismissNotification(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  recipientId: string,
  notificationId: string
): Promise<NotificationRow> {
  assertUuid(workspaceId, 'workspace_id');
  assertUuid(recipientId, 'recipient_id');
  assertUuid(notificationId, 'notification_id');

  const { data, error } = await supabase
    .from('notifications')
    .update({
      status: 'dismissed',
    })
    .eq('id', notificationId)
    .eq('workspace_id', workspaceId)
    .eq('recipient_id', recipientId)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to dismiss notification: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Notification ${notificationId} not found or access denied`);
  }

  return data;
}

/**
 * Retrieves the current user's notification preferences for a workspace.
 * Returns in-memory defaults if no database record exists, without inserting a row.
 */
export async function getNotificationPreferences(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  userId: string
): Promise<NotificationPreferencesWithDefaults> {
  assertUuid(workspaceId, 'workspace_id');
  assertUuid(userId, 'user_id');

  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to retrieve notification preferences: ${error.message}`);
  }

  if (!data) {
    return getDefaultNotificationPreferences(workspaceId, userId);
  }

  return data;
}

/**
 * Saves explicit notification preference updates using an atomic upsert on (workspace_id, user_id).
 */
export async function saveNotificationPreferences(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  userId: string,
  preferences: UpdateNotificationPreferencesInput
): Promise<NotificationPreferencesRow> {
  assertUuid(workspaceId, 'workspace_id');
  assertUuid(userId, 'user_id');

  const validated = updateNotificationPreferencesSchema.parse(preferences);

  // Check if existing preference row exists to preserve unspecified fields
  const { data: existing, error: fetchErr } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(`Failed to check existing preferences: ${fetchErr.message}`);
  }

  const base = existing || getDefaultNotificationPreferences(workspaceId, userId);

  const payload: Database['public']['Tables']['notification_preferences']['Insert'] = {
    workspace_id: workspaceId,
    user_id: userId,
    notify_upcoming_tasks: validated.notify_upcoming_tasks ?? base.notify_upcoming_tasks,
    notify_overdue_tasks: validated.notify_overdue_tasks ?? base.notify_overdue_tasks,
    notify_upcoming_content: validated.notify_upcoming_content ?? base.notify_upcoming_content,
    notify_status_changes: validated.notify_status_changes ?? base.notify_status_changes,
    reminder_lead_minutes: validated.reminder_lead_minutes ?? base.reminder_lead_minutes,
    email_notifications_enabled: validated.email_notifications_enabled ?? base.email_notifications_enabled,
    in_app_notifications_enabled: validated.in_app_notifications_enabled ?? base.in_app_notifications_enabled,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert(payload, { onConflict: 'workspace_id,user_id' })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to save notification preferences: ${error?.message || 'No data returned'}`);
  }

  return data;
}

/**
 * Creates a notification record using trusted server-side execution.
 * Enforces recipient workspace membership and prevents duplicate deliveries
 * via idempotency key checks.
 *
 * NOTE: Intentionally requires an administrative/elevated client because the notifications
 * table does not grant INSERT permissions directly to public/client roles to prevent spoofing.
 */
export async function createNotification(
  adminSupabase: SupabaseClient<Database>,
  workspaceId: string,
  input: CreateNotificationInput
): Promise<CreateNotificationResult> {
  assertUuid(workspaceId, 'workspace_id');

  const validated = createNotificationSchema.parse(input);
  assertUuid(validated.recipient_id, 'recipient_id');
  if (validated.entity_id) {
    assertUuid(validated.entity_id, 'entity_id');
  }

  // 1. Authorization: Verify recipient is an active member of this workspace
  const { data: member, error: memberErr } = await adminSupabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', validated.recipient_id)
    .maybeSingle();

  if (memberErr) {
    throw new Error(`Failed to verify recipient workspace membership: ${memberErr.message}`);
  }

  if (!member) {
    throw new Error(
      `Recipient ${validated.recipient_id} is not an active member of workspace ${workspaceId}. Notification rejected.`
    );
  }

  // 2. Idempotency Check (Pre-insert check)
  if (validated.idempotency_key) {
    const { data: existing, error: existingErr } = await adminSupabase
      .from('notifications')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('recipient_id', validated.recipient_id)
      .eq('idempotency_key', validated.idempotency_key)
      .maybeSingle();

    if (!existingErr && existing) {
      return { notification: existing, isDuplicate: true };
    }
  }

  // 3. Insert notification (future schedules remain 'pending'; immediate items are marked 'delivered')
  const scheduledTimeMs = validated.scheduled_for
    ? new Date(validated.scheduled_for).getTime()
    : Date.now();
  const isFuture = scheduledTimeMs > Date.now();
  const nowIso = new Date().toISOString();

  const insertPayload: Database['public']['Tables']['notifications']['Insert'] = {
    workspace_id: workspaceId,
    recipient_id: validated.recipient_id,
    channel: validated.channel,
    title: validated.title,
    message: validated.message,
    entity_type: validated.entity_type ?? null,
    entity_id: validated.entity_id ?? null,
    scheduled_for: validated.scheduled_for ?? nowIso,
    idempotency_key: validated.idempotency_key ?? null,
    status: isFuture ? 'pending' : 'delivered',
    delivered_at: isFuture ? null : nowIso,
  };

  const { data, error } = await adminSupabase
    .from('notifications')
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    // 4. Handle concurrent unique violation race condition on idx_notifications_idempotency
    if (error.code === '23505' && validated.idempotency_key) {
      const { data: existingConflict } = await adminSupabase
        .from('notifications')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('recipient_id', validated.recipient_id)
        .eq('idempotency_key', validated.idempotency_key)
        .maybeSingle();

      if (existingConflict) {
        return { notification: existingConflict, isDuplicate: true };
      }
    }
    throw new Error(`Failed to create notification: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to create notification: No record returned from database insert.');
  }

  return { notification: data, isDuplicate: false };
}

export interface DomainNotificationEvent {
  workspaceId: string;
  recipientId: string;
  actorId?: string | null;
  title: string;
  message: string;
  entityType?: 'task' | 'content_item' | 'system' | 'ai_request';
  entityId?: string | null;
  idempotencyKey?: string | null;
  preferenceCategory?:
    | 'notify_status_changes'
    | 'notify_upcoming_tasks'
    | 'notify_overdue_tasks'
    | 'notify_upcoming_content';
  scheduledFor?: string | null;
}

/**
 * Dispatches a meaningful domain event notification using elevated server privileges.
 * 
 * Safety invariants:
 * 1. Actor suppression: If actorId matches recipientId, the notification is silently skipped.
 * 2. Recipient preferences: Checks recipient's notification_preferences. If in-app is disabled
 *    or the category preference is false, the notification is silently skipped.
 * 3. Elevated write: Uses createNotification to perform the insert with recipient workspace membership verification.
 * 4. Resilient failure: If notification dispatch fails, logs safe diagnostic and returns null
 *    without throwing, ensuring the primary task/content mutation succeeds.
 */
export async function notifyDomainEvent(
  adminSupabase: SupabaseClient<Database>,
  event: DomainNotificationEvent
): Promise<CreateNotificationResult | null> {
  try {
    // 1. Never notify the actor about their own action
    if (event.actorId && event.actorId === event.recipientId) {
      return null;
    }

    // 2. Check recipient preferences
    const prefs = await getNotificationPreferences(adminSupabase, event.workspaceId, event.recipientId);

    // If recipient explicitly disabled in-app notifications, skip
    if (!prefs.in_app_notifications_enabled) {
      return null;
    }

    // If specific preference category toggle is disabled, skip
    if (event.preferenceCategory && prefs[event.preferenceCategory] === false) {
      return null;
    }

    // 3. Create notification via elevated service
    return await createNotification(adminSupabase, event.workspaceId, {
      recipient_id: event.recipientId,
      channel: 'in_app',
      title: event.title,
      message: event.message,
      entity_type: event.entityType,
      entity_id: event.entityId,
      idempotency_key: event.idempotencyKey,
      scheduled_for: event.scheduledFor ?? undefined,
    });
  } catch (err) {
    // 4. Safe server diagnostic - preserve primary domain mutation
    console.error(
      `[Notification Event Dispatch Warning] Failed to deliver event "${event.title}" for recipient ${event.recipientId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
