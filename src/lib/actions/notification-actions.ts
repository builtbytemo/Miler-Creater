'use server';

import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { resolveAuthorizedWorkspace } from '@/lib/actions/content-actions';
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markNotificationAsUnread,
  markAllNotificationsAsRead,
  dismissNotification,
  getNotificationPreferences,
  saveNotificationPreferences,
  type PaginatedNotifications,
  type NotificationRow,
  type NotificationPreferencesRow,
  type NotificationPreferencesWithDefaults,
} from '@/lib/services/notification-service';
import {
  notificationFilterSchema,
  updateNotificationPreferencesSchema,
  type NotificationFilterInput,
  type UpdateNotificationPreferencesInput,
} from '@/lib/validation/notification';

export interface NotificationActionResult<T = unknown> {
  success?: boolean;
  error?: string;
  data?: T;
}

function formatSafeError(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((i) => i.message).join('; ');
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'An unexpected error occurred';
}

/**
 * Lists the authenticated user's notifications in the authorized workspace with pagination.
 */
export async function getNotificationsAction(
  workspaceId?: string,
  filter?: NotificationFilterInput
): Promise<NotificationActionResult<PaginatedNotifications>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const validatedFilter = notificationFilterSchema.parse(filter || {});
    const result = await getNotifications(supabase, authWsId, authData.user.id, validatedFilter);

    return { success: true, data: result };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

/**
 * Retrieves the count of unread notifications for the authenticated user.
 */
export async function getUnreadNotificationCountAction(
  workspaceId?: string
): Promise<NotificationActionResult<number>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const count = await getUnreadNotificationCount(supabase, authWsId, authData.user.id);
    return { success: true, data: count };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

/**
 * Marks a single notification as read by setting read_at.
 */
export async function markNotificationAsReadAction(
  workspaceId: string | undefined,
  notificationId: string
): Promise<NotificationActionResult<NotificationRow>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    if (!notificationId) {
      return { error: 'Notification ID is required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const updated = await markNotificationAsRead(supabase, authWsId, authData.user.id, notificationId);
    revalidatePath('/dashboard');
    return { success: true, data: updated };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

/**
 * Marks a single notification as unread by clearing read_at.
 */
export async function markNotificationAsUnreadAction(
  workspaceId: string | undefined,
  notificationId: string
): Promise<NotificationActionResult<NotificationRow>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    if (!notificationId) {
      return { error: 'Notification ID is required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const updated = await markNotificationAsUnread(supabase, authWsId, authData.user.id, notificationId);
    revalidatePath('/dashboard');
    return { success: true, data: updated };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

/**
 * Marks all active unread notifications as read for the authenticated user.
 */
export async function markAllNotificationsAsReadAction(
  workspaceId?: string
): Promise<NotificationActionResult<{ updatedCount: number }>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const count = await markAllNotificationsAsRead(supabase, authWsId, authData.user.id);
    revalidatePath('/dashboard');
    return { success: true, data: { updatedCount: count } };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

/**
 * Dismisses a notification for the authenticated user.
 */
export async function dismissNotificationAction(
  workspaceId: string | undefined,
  notificationId: string
): Promise<NotificationActionResult<NotificationRow>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    if (!notificationId) {
      return { error: 'Notification ID is required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const dismissed = await dismissNotification(supabase, authWsId, authData.user.id, notificationId);
    revalidatePath('/dashboard');
    return { success: true, data: dismissed };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

/**
 * Retrieves notification preferences for the authenticated user in the workspace.
 * Returns default settings in-memory if no database record exists.
 */
export async function getNotificationPreferencesAction(
  workspaceId?: string
): Promise<NotificationActionResult<NotificationPreferencesWithDefaults>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const prefs = await getNotificationPreferences(supabase, authWsId, authData.user.id);
    return { success: true, data: prefs };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

/**
 * Updates notification preferences for the authenticated user.
 */
export async function updateNotificationPreferencesAction(
  workspaceId: string | undefined,
  input: UpdateNotificationPreferencesInput
): Promise<NotificationActionResult<NotificationPreferencesRow>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const validated = updateNotificationPreferencesSchema.parse(input);
    const updated = await saveNotificationPreferences(supabase, authWsId, authData.user.id, validated);
    return { success: true, data: updated };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}
