import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const platformEnum = z.enum(['linkedin', 'reddit', 'threads', 'x']);
const actionTypeEnum = z.enum(['post', 'comment', 'reply', 'share', 'repost', 'reaction']);
const contentStatusEnum = z.enum([
  'idea',
  'draft',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'archived',
]);

const taskScheduleSchema = z
  .object({
    scheduled_start: z.string().datetime().nullable(),
    scheduled_end: z.string().datetime().nullable(),
  })
  .refine(
    (data) => {
      if (data.scheduled_start && data.scheduled_end) {
        return new Date(data.scheduled_end).getTime() >= new Date(data.scheduled_start).getTime();
      }
      return true;
    },
    { message: 'scheduled_end must be greater than or equal to scheduled_start' }
  );

const taskDependencySchema = z
  .object({
    task_id: z.string().uuid(),
    depends_on_task_id: z.string().uuid(),
    dependency_type: z.enum([
      'finish_to_start',
      'start_to_start',
      'finish_to_finish',
      'start_to_finish',
    ]),
  })
  .refine((data) => data.task_id !== data.depends_on_task_id, {
    message: 'A task cannot depend on itself',
  });

const aiScopeCatalog = [
  'content:read',
  'content:write',
  'task:read',
  'task:write',
  'calendar:read',
  'calendar:reschedule',
  'action:confirm_required',
] as const;

function isHighRiskOperation(operation: string): boolean {
  const highRisk = ['delete_content', 'delete_task', 'bulk_reschedule', 'revoke_token'];
  return highRisk.includes(operation);
}

describe('Database Schema Invariants & Constraints', () => {
  describe('Social Content Invariants', () => {
    it('validates all approved social platforms', () => {
      expect(platformEnum.safeParse('linkedin').success).toBe(true);
      expect(platformEnum.safeParse('reddit').success).toBe(true);
      expect(platformEnum.safeParse('threads').success).toBe(true);
      expect(platformEnum.safeParse('x').success).toBe(true);
      expect(platformEnum.safeParse('facebook').success).toBe(false);
      expect(platformEnum.safeParse('instagram').success).toBe(false);
    });

    it('validates all approved action types consistently', () => {
      const actions = ['post', 'comment', 'reply', 'share', 'repost', 'reaction'];
      actions.forEach((act) => {
        expect(actionTypeEnum.safeParse(act).success).toBe(true);
      });
      expect(actionTypeEnum.safeParse('invalid_action').success).toBe(false);
    });

    it('validates content statuses including idea inbox and scheduled states', () => {
      expect(contentStatusEnum.safeParse('idea').success).toBe(true);
      expect(contentStatusEnum.safeParse('draft').success).toBe(true);
      expect(contentStatusEnum.safeParse('scheduled').success).toBe(true);
      expect(contentStatusEnum.safeParse('published').success).toBe(true);
    });
  });

  describe('Task Scheduling & Dependency Invariants', () => {
    it('allows valid schedule where end is after start', () => {
      const result = taskScheduleSchema.safeParse({
        scheduled_start: '2026-10-28T14:00:00Z',
        scheduled_end: '2026-10-28T15:30:00Z',
      });
      expect(result.success).toBe(true);
    });

    it('rejects schedule where end is before start', () => {
      const result = taskScheduleSchema.safeParse({
        scheduled_start: '2026-10-28T16:00:00Z',
        scheduled_end: '2026-10-28T15:00:00Z',
      });
      expect(result.success).toBe(false);
    });

    it('allows tasks with only start date or only due date', () => {
      expect(
        taskScheduleSchema.safeParse({
          scheduled_start: '2026-10-28T14:00:00Z',
          scheduled_end: null,
        }).success
      ).toBe(true);
    });

    it('prevents self-referencing task dependencies', () => {
      const sameId = '550e8400-e29b-41d4-a716-446655440000';
      const result = taskDependencySchema.safeParse({
        task_id: sameId,
        depends_on_task_id: sameId,
        dependency_type: 'finish_to_start',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('AI Integration Scopes and Confirmation Safeguards', () => {
    it('verifies catalog of authorized AI scopes', () => {
      expect(aiScopeCatalog).toContain('content:read');
      expect(aiScopeCatalog).toContain('content:write');
      expect(aiScopeCatalog).toContain('task:read');
      expect(aiScopeCatalog).toContain('task:write');
      expect(aiScopeCatalog).toContain('calendar:read');
      expect(aiScopeCatalog).toContain('calendar:reschedule');
    });

    it('classifies destructive operations as requiring confirmation', () => {
      expect(isHighRiskOperation('delete_task')).toBe(true);
      expect(isHighRiskOperation('delete_content')).toBe(true);
      expect(isHighRiskOperation('bulk_reschedule')).toBe(true);
      expect(isHighRiskOperation('create_task')).toBe(false);
      expect(isHighRiskOperation('search_content')).toBe(false);
    });
  });

  describe('Notification System Invariants & Preferences Constraints', () => {
    const notificationChannelEnum = z.enum(['in_app', 'email']);
    const notificationStatusEnum = z.enum(['pending', 'delivered', 'failed', 'dismissed']);
    const notificationEntityTypeEnum = z.enum(['task', 'content_item', 'system', 'ai_request']);

    const notificationPreferencesSchema = z.object({
      notify_upcoming_tasks: z.boolean().default(true),
      notify_overdue_tasks: z.boolean().default(true),
      notify_upcoming_content: z.boolean().default(true),
      notify_status_changes: z.boolean().default(true),
      reminder_lead_minutes: z.number().int().min(0).max(10080).default(60),
      email_notifications_enabled: z.boolean().default(false),
      in_app_notifications_enabled: z.boolean().default(true),
    });

    it('validates supported notification channels and statuses', () => {
      expect(notificationChannelEnum.safeParse('in_app').success).toBe(true);
      expect(notificationChannelEnum.safeParse('email').success).toBe(true);
      expect(notificationChannelEnum.safeParse('sms').success).toBe(false);

      expect(notificationStatusEnum.safeParse('pending').success).toBe(true);
      expect(notificationStatusEnum.safeParse('delivered').success).toBe(true);
      expect(notificationStatusEnum.safeParse('failed').success).toBe(true);
      expect(notificationStatusEnum.safeParse('dismissed').success).toBe(true);
      expect(notificationStatusEnum.safeParse('read').success).toBe(false);
    });

    it('validates notification entity types', () => {
      expect(notificationEntityTypeEnum.safeParse('task').success).toBe(true);
      expect(notificationEntityTypeEnum.safeParse('content_item').success).toBe(true);
      expect(notificationEntityTypeEnum.safeParse('system').success).toBe(true);
      expect(notificationEntityTypeEnum.safeParse('ai_request').success).toBe(true);
      expect(notificationEntityTypeEnum.safeParse('user_profile').success).toBe(false);
    });

    it('enforces preference bounds on reminder lead minutes', () => {
      expect(notificationPreferencesSchema.safeParse({ reminder_lead_minutes: 60 }).success).toBe(true);
      expect(notificationPreferencesSchema.safeParse({ reminder_lead_minutes: 0 }).success).toBe(true);
      expect(notificationPreferencesSchema.safeParse({ reminder_lead_minutes: 10080 }).success).toBe(true);
      expect(notificationPreferencesSchema.safeParse({ reminder_lead_minutes: -1 }).success).toBe(false);
      expect(notificationPreferencesSchema.safeParse({ reminder_lead_minutes: 10081 }).success).toBe(false);
    });

    it('simulates protect_notification_fields immutability trigger behavior', () => {
      const original = {
        id: 'n-1',
        workspace_id: 'ws-1',
        recipient_id: 'usr-1',
        channel: 'in_app' as const,
        title: 'Task Overdue',
        message: 'Your task is overdue',
        entity_type: 'task' as const,
        entity_id: 't-1',
        scheduled_for: '2026-10-29T10:00:00Z',
        idempotency_key: 'task_overdue:t-1:2026-10-29',
        created_at: '2026-10-29T10:00:00Z',
        status: 'delivered' as string,
        read_at: null as string | null,
      };

      function canUpdateNotification(oldRow: typeof original, newRow: typeof original): boolean {
        if (
          newRow.id !== oldRow.id ||
          newRow.workspace_id !== oldRow.workspace_id ||
          newRow.recipient_id !== oldRow.recipient_id ||
          newRow.channel !== oldRow.channel ||
          newRow.title !== oldRow.title ||
          newRow.message !== oldRow.message ||
          newRow.entity_type !== oldRow.entity_type ||
          newRow.entity_id !== oldRow.entity_id ||
          newRow.scheduled_for !== oldRow.scheduled_for ||
          newRow.idempotency_key !== oldRow.idempotency_key ||
          newRow.created_at !== oldRow.created_at
        ) {
          return false;
        }
        return true;
      }

      // Permitted lifecycle updates:
      expect(canUpdateNotification(original, { ...original, read_at: '2026-10-29T11:00:00Z' })).toBe(true);
      expect(canUpdateNotification(original, { ...original, status: 'dismissed' })).toBe(true);

      // Forbidden tampering attempts:
      expect(canUpdateNotification(original, { ...original, recipient_id: 'usr-2' })).toBe(false);
      expect(canUpdateNotification(original, { ...original, title: 'Forged Title' })).toBe(false);
      expect(canUpdateNotification(original, { ...original, message: 'Forged Content' })).toBe(false);
      expect(canUpdateNotification(original, { ...original, workspace_id: 'ws-2' })).toBe(false);
      expect(canUpdateNotification(original, { ...original, idempotency_key: 'new-key' })).toBe(false);
    });
  });
});
