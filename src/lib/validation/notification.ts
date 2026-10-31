import { z } from 'zod';

export const notificationChannelEnum = z.enum(['in_app', 'email']);
export const notificationStatusEnum = z.enum(['pending', 'delivered', 'failed', 'dismissed']);
export const notificationEntityTypeEnum = z.enum(['task', 'content_item', 'system', 'ai_request']);

export const notificationFilterSchema = z.object({
  status: z.union([notificationStatusEnum, z.array(notificationStatusEnum)]).optional(),
  channel: notificationChannelEnum.optional(),
  unread_only: z.boolean().optional(),
  entity_type: notificationEntityTypeEnum.optional(),
  page: z.number().int().min(1, 'Page must be at least 1').default(1),
  limit: z.number().int().min(1).max(100, 'Limit cannot exceed 100').default(20),
});

export const createNotificationSchema = z.object({
  recipient_id: z.string().uuid('Invalid recipient ID format'),
  channel: notificationChannelEnum.default('in_app'),
  title: z.string().trim().min(1, 'Notification title is required').max(255, 'Title is too long (max 255 characters)'),
  message: z.string().trim().min(1, 'Notification message is required').max(4000, 'Message is too long (max 4000 characters)'),
  entity_type: notificationEntityTypeEnum.optional().nullable(),
  entity_id: z.string().uuid('Invalid entity ID format').optional().nullable(),
  scheduled_for: z.string().datetime({ message: 'scheduled_for must be an ISO 8601 string' }).optional(),
  idempotency_key: z.string().trim().min(1, 'Idempotency key cannot be empty').max(255, 'Idempotency key is too long').optional().nullable(),
});

export const updateNotificationPreferencesSchema = z
  .object({
    notify_upcoming_tasks: z.boolean().optional(),
    notify_overdue_tasks: z.boolean().optional(),
    notify_upcoming_content: z.boolean().optional(),
    notify_status_changes: z.boolean().optional(),
    reminder_lead_minutes: z
      .number()
      .int('Reminder lead time must be an integer')
      .min(0, 'Reminder lead time cannot be negative')
      .max(10080, 'Reminder lead time cannot exceed 10,080 minutes (7 days)')
      .optional(),
    email_notifications_enabled: z.boolean().optional(),
    in_app_notifications_enabled: z.boolean().optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one preference setting must be provided to update' }
  );

export type NotificationChannel = z.infer<typeof notificationChannelEnum>;
export type NotificationStatus = z.infer<typeof notificationStatusEnum>;
export type NotificationEntityType = z.infer<typeof notificationEntityTypeEnum>;
export type NotificationFilterInput = z.input<typeof notificationFilterSchema>;
export type NotificationFilterOutput = z.output<typeof notificationFilterSchema>;
export type CreateNotificationInput = z.input<typeof createNotificationSchema>;
export type CreateNotificationOutput = z.output<typeof createNotificationSchema>;
export type UpdateNotificationPreferencesInput = z.input<typeof updateNotificationPreferencesSchema>;
export type UpdateNotificationPreferencesOutput = z.output<typeof updateNotificationPreferencesSchema>;
