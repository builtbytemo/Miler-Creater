import { z } from 'zod';
import type { ToolDefinition } from './types';
import { getUnifiedSchedule } from '@/lib/services/scheduling-service';
import { createTask, getTaskById, deleteTask, addTaskDependency, removeTaskDependency } from '@/lib/services/task-service';
import { getContentItemById, deleteContentItem, getSocialAccounts, createSocialAccount } from '@/lib/services/content-service';
import { getNotifications, markNotificationAsRead, markNotificationAsUnread, markAllNotificationsAsRead, dismissNotification, getNotificationPreferences, saveNotificationPreferences } from '@/lib/services/notification-service';
import { notificationFilterSchema, updateNotificationPreferencesSchema } from '@/lib/validation/notification';
import { createCalendarEntryInputSchema } from './schemas';
import { createSocialAccountSchema } from '@/lib/validation/content';

const uuid = z.string().uuid();
const empty = z.object({}).strict();
const range = z.object({
  start_date: z.string().datetime(), end_date: z.string().datetime(),
  include_completed: z.boolean().default(true),
}).strict().refine((v) => Date.parse(v.end_date) >= Date.parse(v.start_date) && Date.parse(v.end_date) - Date.parse(v.start_date) <= 120 * 86400000,
  { message: 'Provide an ordered date range of no more than 120 days.' });

export const WORKSPACE_TOOLS: Record<string, ToolDefinition> = {
  create_calendar_entry: {
    name: 'create_calendar_entry', description: 'Create an event or time block directly on the calendar, without adding it to the Tasks tab or left assignment panel. Use this for appointments, meetings, and calendar events. Requires a start time; accepts end time, all-day flag, priority, recurrence, and notes in description.',
    category: 'write', requiredScopes: ['task:write'], schema: createCalendarEntryInputSchema,
    execute: (c, v: z.infer<typeof createCalendarEntryInputSchema>) =>
      createTask(c.supabase, c.workspaceId, { ...v, created_from: 'calendar', entry_type: v.entry_type ?? 'calendar_block' }, c.userId),
  },
  get_calendar: {
    name: 'get_calendar', description: 'Read scheduled tasks, content, and deadlines in a UTC date range of up to 120 days, using the account timezone for display.',
    category: 'read', requiredScopes: ['task:read', 'content:read'], schema: range,
    execute: (c, v: z.infer<typeof range>) => getUnifiedSchedule(c.supabase, c.workspaceId, { startDate: v.start_date, endDate: v.end_date, includeCompleted: v.include_completed, userTimeZone: c.timeZone }),
  },
  list_projects: {
    name: 'list_projects', description: 'List workspace projects and their IDs so tasks and content can be associated with an existing project.',
    category: 'read', requiredScopes: ['task:read', 'content:read'], schema: empty,
    execute: async (c) => {
      const { data, error } = await c.supabase.from('projects').select('id, name, color').eq('workspace_id', c.workspaceId).order('name');
      if (error) throw new Error('Failed to retrieve projects');
      return data;
    },
  },
  add_task_dependency: {
    name: 'add_task_dependency', description: 'Make a task depend on another workspace task. Validates workspace membership, self dependencies, and dependency cycles.',
    category: 'write', requiredScopes: ['task:write'], schema: z.object({ task_id: uuid, depends_on_task_id: uuid, dependency_type: z.enum(['finish_to_start', 'start_to_start', 'finish_to_finish']).default('finish_to_start') }).strict(),
    execute: (c, v) => addTaskDependency(c.supabase, c.workspaceId, v.task_id, v.depends_on_task_id, v.dependency_type),
  },
  remove_task_dependency: {
    name: 'remove_task_dependency', description: 'Remove a prerequisite link by dependency ID from the authenticated workspace without deleting either task.',
    category: 'write', requiredScopes: ['task:write'], schema: z.object({ dependency_id: uuid }).strict(),
    execute: async (c, v) => { await removeTaskDependency(c.supabase, c.workspaceId, v.dependency_id); return { removed: true }; },
  },
  delete_task: {
    name: 'delete_task', description: 'Permanently delete a task and its cascading child records. Use only when the user explicitly asks for deletion; first read the task and supply its exact title as confirm_title.',
    category: 'write', requiredScopes: ['task:read', 'task:write'], schema: z.object({ task_id: uuid, confirm_title: z.string().min(1).max(255) }).strict(),
    execute: async (c, v) => {
      const task = await getTaskById(c.supabase, c.workspaceId, v.task_id);
      if (!task) throw new Error('Task not found');
      if (task.title !== v.confirm_title) throw new Error('Invalid operation: confirmation title does not match');
      await deleteTask(c.supabase, c.workspaceId, v.task_id);
      return { deleted: true, task_id: v.task_id };
    },
  },
  delete_content_item: {
    name: 'delete_content_item', description: 'Permanently delete a content item. Use only for an explicit user deletion request; archive via update_content_item for reversible removal.',
    category: 'write', requiredScopes: ['content:read', 'content:write'], schema: z.object({ content_id: uuid, confirm_delete: z.literal(true) }).strict(),
    execute: async (c, v) => {
      if (!await getContentItemById(c.supabase, c.workspaceId, v.content_id)) throw new Error('Content not found');
      await deleteContentItem(c.supabase, c.workspaceId, v.content_id);
      return { deleted: true, content_id: v.content_id };
    },
  },
  list_social_accounts: {
    name: 'list_social_accounts', description: 'List social account metadata and IDs in this workspace. Does not expose social account credentials.',
    category: 'read', requiredScopes: ['content:read'], schema: empty,
    execute: (c) => getSocialAccounts(c.supabase, c.workspaceId),
  },
  create_social_account: {
    name: 'create_social_account', description: 'Add a social account planning profile (platform, handle, display name). This does not authenticate with a platform or publish posts.',
    category: 'write', requiredScopes: ['content:write'], schema: createSocialAccountSchema.strict(),
    execute: (c, v) => createSocialAccount(c.supabase, c.workspaceId, v),
  },
  list_notifications: {
    name: 'list_notifications', description: 'Read paginated notifications belonging to the authenticated user in this workspace, optionally filtered by unread state or entity type.',
    category: 'read', requiredScopes: ['task:read', 'content:read'], schema: notificationFilterSchema.strict(),
    execute: (c, v) => getNotifications(c.supabase, c.workspaceId, c.userId, v),
  },
  update_notification: {
    name: 'update_notification', description: 'Mark one of the authenticated user’s workspace notifications read, unread, or dismissed.',
    category: 'write', requiredScopes: ['task:write', 'content:write'], schema: z.object({ notification_id: uuid, action: z.enum(['read', 'unread', 'dismiss']) }).strict(),
    execute: (c, v) => ({ read: markNotificationAsRead, unread: markNotificationAsUnread, dismiss: dismissNotification }[v.action as 'read' | 'unread' | 'dismiss'])(c.supabase, c.workspaceId, c.userId, v.notification_id),
  },
  mark_all_notifications_read: {
    name: 'mark_all_notifications_read', description: 'Mark all notifications for the authenticated user in this workspace as read and return the changed count.',
    category: 'write', requiredScopes: ['task:write', 'content:write'], schema: empty,
    execute: async (c) => ({ updated: await markAllNotificationsAsRead(c.supabase, c.workspaceId, c.userId) }),
  },
  get_reminder_preferences: {
    name: 'get_reminder_preferences', description: 'Read the authenticated user’s reminder lead time, task and content alert settings, and notification channels.',
    category: 'read', requiredScopes: ['task:read', 'content:read'], schema: empty,
    execute: (c) => getNotificationPreferences(c.supabase, c.workspaceId, c.userId),
  },
  update_reminder_preferences: {
    name: 'update_reminder_preferences', description: 'Update reminder lead time and notification preferences for the authenticated user. Preserves unspecified settings.',
    category: 'write', requiredScopes: ['task:write', 'content:write'], schema: updateNotificationPreferencesSchema.strict(),
    execute: (c, v) => saveNotificationPreferences(c.supabase, c.workspaceId, c.userId, v),
  },
};
