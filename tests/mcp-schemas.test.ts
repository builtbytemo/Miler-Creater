import { describe, it, expect } from 'vitest';
import {
  getWorkspaceSummaryInputSchema,
  searchTasksInputSchema,
  getTaskDetailsInputSchema,
  listOverdueTasksInputSchema,
  searchContentInputSchema,
  getContentDetailsInputSchema,
  listScheduledContentInputSchema,
  createTaskInputSchema,
  updateTaskInputSchema,
  changeTaskStatusInputSchema,
  rescheduleTaskInputSchema,
  createContentItemInputSchema,
  updateContentItemInputSchema,
  rescheduleContentInputSchema,
} from '../src/lib/mcp/schemas';

describe('MCP Zod Schemas Validation (Phase 7.3)', () => {
  const validUuid = '123e4567-e89b-12d3-a456-426614174000';
  const nowIso = '2026-10-30T10:00:00.000Z';
  const laterIso = '2026-10-30T12:00:00.000Z';

  describe('1. getWorkspaceSummaryInputSchema', () => {
    it('accepts empty object', () => {
      const parsed = getWorkspaceSummaryInputSchema.parse({});
      expect(parsed).toEqual({});
    });

    it('rejects unexpected properties (strict)', () => {
      expect(() => getWorkspaceSummaryInputSchema.parse({ unexpected: 'value' })).toThrow();
      expect(() => getWorkspaceSummaryInputSchema.parse({ workspace_id: validUuid })).toThrow();
    });
  });

  describe('2. searchTasksInputSchema', () => {
    it('accepts valid filters and applies limit default 20', () => {
      const parsed = searchTasksInputSchema.parse({
        search: 'deploy',
        status: 'in_progress',
        priority: 'high',
        due_date_from: nowIso,
      });
      expect(parsed.limit).toBe(20);
      expect(parsed.search).toBe('deploy');
      expect(parsed.status).toBe('in_progress');
      expect(parsed.priority).toBe('high');
    });

    it('rejects invalid status or priority', () => {
      expect(() => searchTasksInputSchema.parse({ status: 'invalid_status' })).toThrow();
      expect(() => searchTasksInputSchema.parse({ priority: 'critical' })).toThrow();
    });

    it('rejects limit out of bounds (1..50)', () => {
      expect(() => searchTasksInputSchema.parse({ limit: 0 })).toThrow();
      expect(() => searchTasksInputSchema.parse({ limit: 51 })).toThrow();
    });

    it('rejects model-supplied workspace_id', () => {
      expect(() => searchTasksInputSchema.parse({ workspace_id: validUuid })).toThrow();
    });
  });

  describe('3. getTaskDetailsInputSchema', () => {
    it('accepts valid UUID task_id', () => {
      const parsed = getTaskDetailsInputSchema.parse({ task_id: validUuid });
      expect(parsed.task_id).toBe(validUuid);
    });

    it('rejects missing or non-UUID task_id', () => {
      expect(() => getTaskDetailsInputSchema.parse({})).toThrow();
      expect(() => getTaskDetailsInputSchema.parse({ task_id: 'not-a-uuid' })).toThrow();
    });

    it('rejects unexpected properties', () => {
      expect(() => getTaskDetailsInputSchema.parse({ task_id: validUuid, extra: 123 })).toThrow();
    });
  });

  describe('4. listOverdueTasksInputSchema', () => {
    it('accepts valid limit and applies default 20', () => {
      expect(listOverdueTasksInputSchema.parse({}).limit).toBe(20);
      expect(listOverdueTasksInputSchema.parse({ limit: 10 }).limit).toBe(10);
    });

    it('rejects invalid limit or unexpected properties', () => {
      expect(() => listOverdueTasksInputSchema.parse({ limit: -1 })).toThrow();
      expect(() => listOverdueTasksInputSchema.parse({ workspace_id: validUuid })).toThrow();
    });
  });

  describe('5. searchContentInputSchema', () => {
    it('accepts valid content filters and defaults limit to 20', () => {
      const parsed = searchContentInputSchema.parse({
        platform: 'linkedin',
        status: 'draft',
        search: 'product announcement',
      });
      expect(parsed.platform).toBe('linkedin');
      expect(parsed.status).toBe('draft');
      expect(parsed.limit).toBe(20);
    });

    it('rejects invalid social platform (e.g. facebook)', () => {
      expect(() => searchContentInputSchema.parse({ platform: 'facebook' })).toThrow();
      expect(() => searchContentInputSchema.parse({ platform: 'instagram' })).toThrow();
    });

    it('rejects unexpected properties', () => {
      expect(() => searchContentInputSchema.parse({ user_id: validUuid })).toThrow();
    });
  });

  describe('6. getContentDetailsInputSchema', () => {
    it('accepts valid UUID content_id', () => {
      const parsed = getContentDetailsInputSchema.parse({ content_id: validUuid });
      expect(parsed.content_id).toBe(validUuid);
    });

    it('rejects non-UUID content_id or unexpected properties', () => {
      expect(() => getContentDetailsInputSchema.parse({ content_id: '123' })).toThrow();
      expect(() => getContentDetailsInputSchema.parse({ content_id: validUuid, extra: true })).toThrow();
    });
  });

  describe('7. listScheduledContentInputSchema', () => {
    it('accepts datetime boundaries and platform filter', () => {
      const parsed = listScheduledContentInputSchema.parse({
        scheduled_from: nowIso,
        scheduled_to: laterIso,
        platform: 'x',
      });
      expect(parsed.platform).toBe('x');
      expect(parsed.limit).toBe(20);
    });

    it('rejects invalid datetime strings', () => {
      expect(() => listScheduledContentInputSchema.parse({ scheduled_from: 'tomorrow' })).toThrow();
    });
  });

  describe('8. createTaskInputSchema', () => {
    it('accepts valid task with defaults applied', () => {
      const parsed = createTaskInputSchema.parse({
        title: 'Complete audit report',
      });
      expect(parsed.title).toBe('Complete audit report');
      expect(parsed.priority).toBe('medium');
      expect(parsed.status).toBe('todo');
      expect(parsed.is_all_day).toBe(false);
      expect(parsed.tags).toEqual([]);
    });

    it('accepts scheduled_start and scheduled_end when end >= start', () => {
      const parsed = createTaskInputSchema.parse({
        title: 'Deep work session',
        scheduled_start: nowIso,
        scheduled_end: laterIso,
      });
      expect(parsed.scheduled_start).toBe(nowIso);
      expect(parsed.scheduled_end).toBe(laterIso);
    });

    it('rejects empty title or scheduled_end earlier than scheduled_start', () => {
      expect(() => createTaskInputSchema.parse({ title: '' })).toThrow();
      expect(() => createTaskInputSchema.parse({ title: '   ' })).toThrow();
      expect(() =>
        createTaskInputSchema.parse({
          title: 'Invalid time window',
          scheduled_start: laterIso,
          scheduled_end: nowIso,
        })
      ).toThrow('Scheduled end time cannot be earlier than scheduled start time');
    });

    it('rejects unexpected properties (like workspace_id or user_id)', () => {
      expect(() =>
        createTaskInputSchema.parse({
          title: 'Hacked task',
          workspace_id: validUuid,
        })
      ).toThrow();
    });
  });

  describe('9. updateTaskInputSchema', () => {
    it('accepts valid update fields', () => {
      const parsed = updateTaskInputSchema.parse({
        task_id: validUuid,
        title: 'Updated title',
        priority: 'urgent',
        estimated_duration_minutes: 45,
      });
      expect(parsed.task_id).toBe(validUuid);
      expect(parsed.title).toBe('Updated title');
      expect(parsed.priority).toBe('urgent');
    });

    it('rejects status modification via update_task (must use change_task_status)', () => {
      expect(() =>
        updateTaskInputSchema.parse({
          task_id: validUuid,
          status: 'done',
        })
      ).toThrow();
    });

    it('rejects scheduled_end earlier than scheduled_start', () => {
      expect(() =>
        updateTaskInputSchema.parse({
          task_id: validUuid,
          scheduled_start: laterIso,
          scheduled_end: nowIso,
        })
      ).toThrow('Scheduled end time cannot be earlier than scheduled start time');
    });

    it('rejects unexpected properties', () => {
      expect(() =>
        updateTaskInputSchema.parse({
          task_id: validUuid,
          workspace_id: validUuid,
        })
      ).toThrow();
    });
  });

  describe('10. changeTaskStatusInputSchema', () => {
    it('accepts valid task status', () => {
      const parsed = changeTaskStatusInputSchema.parse({
        task_id: validUuid,
        status: 'done',
      });
      expect(parsed.status).toBe('done');
    });

    it('rejects invalid status enum or missing task_id', () => {
      expect(() => changeTaskStatusInputSchema.parse({ task_id: validUuid, status: 'published' })).toThrow();
      expect(() => changeTaskStatusInputSchema.parse({ status: 'done' })).toThrow();
    });
  });

  describe('11. rescheduleTaskInputSchema', () => {
    it('accepts valid due_date', () => {
      const parsed = rescheduleTaskInputSchema.parse({
        task_id: validUuid,
        due_date: laterIso,
      });
      expect(parsed.due_date).toBe(laterIso);
    });

    it('accepts scheduled_start and scheduled_end', () => {
      const parsed = rescheduleTaskInputSchema.parse({
        task_id: validUuid,
        scheduled_start: nowIso,
        scheduled_end: laterIso,
      });
      expect(parsed.scheduled_start).toBe(nowIso);
    });

    it('rejects when no date field is provided', () => {
      expect(() => rescheduleTaskInputSchema.parse({ task_id: validUuid })).toThrow(
        'At least one date field'
      );
    });

    it('rejects when scheduled_end is earlier than scheduled_start', () => {
      expect(() =>
        rescheduleTaskInputSchema.parse({
          task_id: validUuid,
          scheduled_start: laterIso,
          scheduled_end: nowIso,
        })
      ).toThrow('Scheduled end time cannot be earlier than scheduled start time');
    });
  });

  describe('12. createContentItemInputSchema', () => {
    it('accepts content item with platform and title', () => {
      const parsed = createContentItemInputSchema.parse({
        platform: 'linkedin',
        title: 'New Product Launch',
      });
      expect(parsed.platform).toBe('linkedin');
      expect(parsed.title).toBe('New Product Launch');
      expect(parsed.status).toBe('idea');
      expect(parsed.action_type).toBe('post');
      expect(parsed.body).toBe('');
    });

    it('accepts content item with platform and body (empty title)', () => {
      const parsed = createContentItemInputSchema.parse({
        platform: 'x',
        body: 'Quick insight on AI developer tools.',
      });
      expect(parsed.platform).toBe('x');
      expect(parsed.body).toBe('Quick insight on AI developer tools.');
    });

    it('rejects when both title and body are empty', () => {
      expect(() =>
        createContentItemInputSchema.parse({
          platform: 'threads',
          title: '',
          body: '',
        })
      ).toThrow('Content item must include either a title or a body');

      expect(() =>
        createContentItemInputSchema.parse({
          platform: 'threads',
        })
      ).toThrow('Content item must include either a title or a body');
    });

    it('rejects unsupported platforms and unexpected properties', () => {
      expect(() =>
        createContentItemInputSchema.parse({
          platform: 'tiktok',
          title: 'Video script',
        })
      ).toThrow();

      expect(() =>
        createContentItemInputSchema.parse({
          platform: 'reddit',
          title: 'AMA post',
          workspace_id: validUuid,
        })
      ).toThrow();
    });
  });

  describe('13. updateContentItemInputSchema', () => {
    it('accepts partial updates for content items', () => {
      const parsed = updateContentItemInputSchema.parse({
        content_id: validUuid,
        title: 'Updated Headline',
        notes: 'Revised based on editor review',
      });
      expect(parsed.content_id).toBe(validUuid);
      expect(parsed.title).toBe('Updated Headline');
      expect(parsed.notes).toBe('Revised based on editor review');
    });

    it('rejects non-UUID content_id or unexpected properties', () => {
      expect(() => updateContentItemInputSchema.parse({ content_id: 'bad', title: 'New' })).toThrow();
      expect(() =>
        updateContentItemInputSchema.parse({
          content_id: validUuid,
          workspace_id: validUuid,
        })
      ).toThrow();
    });
  });

  describe('14. rescheduleContentInputSchema', () => {
    it('accepts valid UUID content_id and ISO datetime', () => {
      const parsed = rescheduleContentInputSchema.parse({
        content_id: validUuid,
        scheduled_at: laterIso,
      });
      expect(parsed.content_id).toBe(validUuid);
      expect(parsed.scheduled_at).toBe(laterIso);
    });

    it('rejects missing or invalid scheduled_at format', () => {
      expect(() => rescheduleContentInputSchema.parse({ content_id: validUuid })).toThrow();
      expect(() =>
        rescheduleContentInputSchema.parse({
          content_id: validUuid,
          scheduled_at: 'next Friday 3pm',
        })
      ).toThrow('scheduled_at must be a valid ISO 8601 datetime');
    });
  });
});
