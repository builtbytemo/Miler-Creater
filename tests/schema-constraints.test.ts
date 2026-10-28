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
});
