import { z } from 'zod';
import { taskPriorityEnum, taskStatusEnum, recurrenceInputSchema } from '@/lib/validation/task';
import {
  socialPlatformEnum,
  contentActionTypeEnum,
  contentStatusEnum,
  mediaItemSchema, externalLinkItemSchema, targetReferenceSchema,
} from '@/lib/validation/content';

// -----------------------------------------------------------------------------
// READ-ONLY TOOL SCHEMAS (7 Tools)
// -----------------------------------------------------------------------------

/**
 * 1. get_workspace_summary
 * Retrieves operational KPI metrics across tasks, content, and alerts.
 */
export const getWorkspaceSummaryInputSchema = z.object({}).strict();
export type GetWorkspaceSummaryInput = z.infer<typeof getWorkspaceSummaryInputSchema>;

/**
 * 2. search_tasks
 * Queries tasks by search keyword, status, priority, or due-date boundaries.
 */
export const searchTasksInputSchema = z
  .object({
    project_id: z.string().uuid().optional(),
    parent_task_id: z.string().uuid().optional().nullable(),
    scheduled_from: z.string().datetime().optional(),
    scheduled_to: z.string().datetime().optional(),
    is_scheduled: z.boolean().optional(),
    offset: z.number().int().min(0).max(100000).optional(),
    search: z.string().trim().max(255).optional(),
    status: taskStatusEnum.optional(),
    priority: taskPriorityEnum.optional(),
    due_date_from: z.string().datetime().optional(),
    due_date_to: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type SearchTasksInput = z.infer<typeof searchTasksInputSchema>;

/**
 * 3. get_task_details
 * Retrieves complete task details including subtasks and dependency graph.
 */
export const getTaskDetailsInputSchema = z
  .object({
    task_id: z.string().uuid('task_id must be a valid UUID'),
  })
  .strict();
export type GetTaskDetailsInput = z.infer<typeof getTaskDetailsInputSchema>;

/**
 * 4. list_overdue_tasks
 * Retrieves overdue incomplete tasks in the workspace.
 */
export const listOverdueTasksInputSchema = z
  .object({
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type ListOverdueTasksInput = z.infer<typeof listOverdueTasksInputSchema>;

/**
 * 5. search_content
 * Searches social content items by text, platform, or status.
 */
export const searchContentInputSchema = z
  .object({
    project_id: z.string().uuid().optional(),
    social_account_id: z.string().uuid().optional(),
    is_scheduled: z.boolean().optional(),
    scheduled_from: z.string().datetime().optional(),
    scheduled_to: z.string().datetime().optional(),
    offset: z.number().int().min(0).max(100000).optional(),
    search: z.string().trim().max(255).optional(),
    platform: socialPlatformEnum.optional(),
    status: contentStatusEnum.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type SearchContentInput = z.infer<typeof searchContentInputSchema>;

/**
 * 6. get_content_details
 * Retrieves full details for a single content item.
 */
export const getContentDetailsInputSchema = z
  .object({
    content_id: z.string().uuid('content_id must be a valid UUID'),
  })
  .strict();
export type GetContentDetailsInput = z.infer<typeof getContentDetailsInputSchema>;

/**
 * 7. list_scheduled_content
 * Retrieves scheduled posts within a specific time window.
 */
export const listScheduledContentInputSchema = z
  .object({
    scheduled_from: z.string().datetime().optional(),
    scheduled_to: z.string().datetime().optional(),
    platform: socialPlatformEnum.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type ListScheduledContentInput = z.infer<typeof listScheduledContentInputSchema>;

// -----------------------------------------------------------------------------
// WRITE TOOL SCHEMAS (7 Tools)
// -----------------------------------------------------------------------------

/**
 * 8. create_task
 * Creates a new task in the authenticated workspace.
 */
export const createTaskInputSchema = z
  .object({
    created_from: z.enum(['tasks', 'calendar']).optional().describe('Use calendar to appear only on the calendar; omit or use tasks for the Tasks tab and calendar left panel.'),
    entry_type: z.enum(['task', 'calendar_block']).default('task').describe('Use calendar_block for dedicated time blocks (meetings, lectures, gym); task for actionable work.'),
    parent_task_id: z.string().uuid().optional().nullable(),
    milestone_id: z.string().uuid().optional().nullable(),
    recurrence: recurrenceInputSchema.optional().nullable(),
    title: z.string().trim().min(1, 'Task title is required').max(255, 'Title is too long'),
    description: z.string().trim().max(5000).optional().nullable(),
    priority: taskPriorityEnum.default('medium'),
    status: z.enum(['todo', 'in_progress', 'blocked']).default('todo'),
    due_date: z.string().datetime().optional().nullable(),
    scheduled_start: z.string().datetime().optional().nullable(),
    scheduled_end: z.string().datetime().optional().nullable(),
    is_all_day: z.boolean().default(false),
    estimated_duration_minutes: z.number().int().min(1).max(10080).optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(50)).default([]),
    project_id: z.string().uuid('project_id must be a valid UUID').optional().nullable(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.scheduled_start && data.scheduled_end) {
        return new Date(data.scheduled_end).getTime() >= new Date(data.scheduled_start).getTime();
      }
      return true;
    },
    {
      message: 'Scheduled end time cannot be earlier than scheduled start time',
      path: ['scheduled_end'],
    }
  );
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

/** A dedicated calendar action makes placement unambiguous for MCP clients. */
export const createCalendarEntryInputSchema = createTaskInputSchema.safeExtend({
  created_from: z.literal('calendar').default('calendar'),
  entry_type: z.enum(['task', 'calendar_block']).default('calendar_block'),
  scheduled_start: z.string().datetime().describe('Required start time as an ISO 8601 timestamp with a timezone offset.'),
});


/**
 * 9. update_task
 * Updates task attributes (title, description, priority, duration, tags, project).
 * NOTE: Lifecycle status changes are intentionally separated into change_task_status
 * to ensure prerequisite dependencies and recurring task spawning are strictly enforced.
 */
export const updateTaskInputSchema = z
  .object({
    entry_type: z.enum(['task', 'calendar_block']).optional().describe('Entry type: task or calendar_block.'),
    is_all_day: z.boolean().optional(),
    milestone_id: z.string().uuid().optional().nullable(),
    parent_task_id: z.string().uuid().optional().nullable(),
    task_id: z.string().uuid('task_id must be a valid UUID'),
    title: z.string().trim().min(1, 'Task title cannot be empty').max(255).optional(),
    description: z.string().trim().max(5000).optional().nullable(),
    priority: taskPriorityEnum.optional(),
    due_date: z.string().datetime().optional().nullable(),
    scheduled_start: z.string().datetime().optional().nullable(),
    scheduled_end: z.string().datetime().optional().nullable(),
    estimated_duration_minutes: z.number().int().min(1).max(10080).optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(50)).optional(),
    project_id: z.string().uuid('project_id must be a valid UUID').optional().nullable(),
    recurrence: recurrenceInputSchema.optional().nullable(),
    stop_recurrence: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.scheduled_start && data.scheduled_end) {
        return new Date(data.scheduled_end).getTime() >= new Date(data.scheduled_start).getTime();
      }
      return true;
    },
    {
      message: 'Scheduled end time cannot be earlier than scheduled start time',
      path: ['scheduled_end'],
    }
  );
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;

/**
 * 10. change_task_status
 * Modifies task lifecycle status (todo, in_progress, blocked, done, cancelled).
 */
export const changeTaskStatusInputSchema = z
  .object({
    task_id: z.string().uuid('task_id must be a valid UUID'),
    status: taskStatusEnum,
  })
  .strict();
export type ChangeTaskStatusInput = z.infer<typeof changeTaskStatusInputSchema>;

/**
 * 11. reschedule_task
 * Adjusts a task's due_date or scheduled_start / scheduled_end execution window.
 */
export const rescheduleTaskInputSchema = z
  .object({
    task_id: z.string().uuid('task_id must be a valid UUID'),
    due_date: z.string().datetime().optional().nullable(),
    scheduled_start: z.string().datetime().optional().nullable(),
    scheduled_end: z.string().datetime().optional().nullable(),
  })
  .strict()
  .refine(
    (data) =>
      data.due_date !== undefined ||
      data.scheduled_start !== undefined ||
      data.scheduled_end !== undefined,
    {
      message: 'At least one date field (due_date, scheduled_start, or scheduled_end) must be provided',
    }
  )
  .refine(
    (data) => {
      if (data.scheduled_start && data.scheduled_end) {
        return new Date(data.scheduled_end).getTime() >= new Date(data.scheduled_start).getTime();
      }
      return true;
    },
    {
      message: 'Scheduled end time cannot be earlier than scheduled start time',
      path: ['scheduled_end'],
    }
  );
export type RescheduleTaskInput = z.infer<typeof rescheduleTaskInputSchema>;

const scheduleDateTimeFields = {
  scheduled_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'scheduled_date must be formatted as YYYY-MM-DD')
    .optional()
    .nullable()
    .describe('Local calendar date (YYYY-MM-DD) in the user workspace timezone; alternative to scheduled_at.'),
  scheduled_hour: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe('12-hour clock hour (1-12) in the user workspace timezone; requires scheduled_date.'),
  scheduled_minute: z
    .number()
    .int()
    .min(0)
    .max(59)
    .optional()
    .describe('Minute (0-59); defaults to 0 when scheduled_date is provided.'),
  scheduled_meridiem: z
    .enum(['AM', 'PM'])
    .optional()
    .describe('AM or PM for 12-hour scheduled_hour; defaults to AM when scheduled_date is provided.'),
};

interface ScheduleFieldInput {
  scheduled_at?: string | null;
  scheduled_date?: string | null;
  scheduled_hour?: number;
  scheduled_minute?: number;
  scheduled_meridiem?: 'AM' | 'PM';
}

function hasNoScheduleConflict(data: ScheduleFieldInput): boolean {
  const hasDate = typeof data.scheduled_date === 'string' && data.scheduled_date.length > 0;
  const hasTimeParts =
    data.scheduled_hour !== undefined ||
    data.scheduled_minute !== undefined ||
    data.scheduled_meridiem !== undefined;
  const hasAt = typeof data.scheduled_at === 'string' && data.scheduled_at.length > 0;
  if (hasAt && (hasDate || hasTimeParts)) return false;
  if (!hasDate && hasTimeParts) return false;
  return true;
}

/**
 * 12. create_content_item
 * Creates an idea or scheduled draft for social media.
 */
export const createContentItemInputSchema = z
  .object({
    social_account_id: z.string().uuid().optional().nullable(),
    milestone_id: z.string().uuid().optional().nullable(),
    media_urls: z.array(mediaItemSchema).optional(),
    external_links: z.array(externalLinkItemSchema).optional(),
    target_reference: targetReferenceSchema.optional().nullable(),
    created_from: z.enum(['content', 'calendar']).optional().describe('Use calendar for calendar-only placement; omit or use content for the Content tab and calendar left panel.'),
    recurrence: recurrenceInputSchema.optional().nullable(),
    platform: socialPlatformEnum,
    action_type: contentActionTypeEnum.default('post'),
    status: z.enum(['idea', 'draft', 'scheduled']).default('idea'),
    title: z.string().trim().max(255).optional().nullable(),
    body: z.string().default(''),
    scheduled_at: z.string().datetime().optional().nullable(),
    ...scheduleDateTimeFields,
    duration_minutes: z.number().int().min(1).max(10080).optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(50)).default([]),
    notes: z.string().trim().max(10000).optional().nullable(),
    project_id: z.string().uuid('project_id must be a valid UUID').optional().nullable(),
  })
  .strict()
  .refine(
    (data) => {
      const hasTitle = typeof data.title === 'string' && data.title.trim().length > 0;
      const hasBody = typeof data.body === 'string' && data.body.trim().length > 0;
      return hasTitle || hasBody;
    },
    {
      message: 'Content item must include either a title or a body',
      path: ['body'],
    }
  )
  .refine(hasNoScheduleConflict, {
    message: 'Provide either scheduled_at or scheduled_date (with optional scheduled_hour, scheduled_minute, scheduled_meridiem), not both, and include scheduled_date when setting time fields',
    path: ['scheduled_date'],
  });
export type CreateContentItemInput = z.infer<typeof createContentItemInputSchema>;

/**
 * 13. update_content_item
 * Updates an existing content item's copy, title, platform, status, or notes.
 */
export const updateContentItemInputSchema = z
  .object({
    social_account_id: z.string().uuid().optional().nullable(),
    milestone_id: z.string().uuid().optional().nullable(),
    media_urls: z.array(mediaItemSchema).optional(),
    external_links: z.array(externalLinkItemSchema).optional(),
    target_reference: targetReferenceSchema.optional().nullable(),
    content_id: z.string().uuid('content_id must be a valid UUID'),
    title: z.string().trim().max(255).optional().nullable(),
    body: z.string().optional(),
    platform: socialPlatformEnum.optional(),
    action_type: contentActionTypeEnum.optional(),
    status: z.enum(['idea', 'draft', 'scheduled', 'archived']).optional(),
    scheduled_at: z.string().datetime().optional().nullable(),
    ...scheduleDateTimeFields,
    duration_minutes: z.number().int().min(1).max(10080).optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(50)).optional(),
    notes: z.string().trim().max(10000).optional().nullable(),
    project_id: z.string().uuid('project_id must be a valid UUID').optional().nullable(),
  })
  .strict()
  .refine(hasNoScheduleConflict, {
    message: 'Provide either scheduled_at or scheduled_date (with optional scheduled_hour, scheduled_minute, scheduled_meridiem), not both, and include scheduled_date when setting time fields',
    path: ['scheduled_date'],
  });
export type UpdateContentItemInput = z.infer<typeof updateContentItemInputSchema>;

/**
 * 14. reschedule_content
 * Adjusts the planned publication datetime (scheduled_at) for a content item.
 */
export const rescheduleContentInputSchema = z
  .object({
    content_id: z.string().uuid('content_id must be a valid UUID'),
    scheduled_at: z.string().datetime({ message: 'scheduled_at must be a valid ISO 8601 datetime' }).optional(),
    ...scheduleDateTimeFields,
  })
  .strict()
  .refine(hasNoScheduleConflict, {
    message: 'Provide either scheduled_at or scheduled_date (with optional scheduled_hour, scheduled_minute, scheduled_meridiem), not both, and include scheduled_date when setting time fields',
    path: ['scheduled_date'],
  })
  .refine(
    (data) =>
      Boolean(data.scheduled_at) ||
      (typeof data.scheduled_date === 'string' && data.scheduled_date.length > 0),
    {
      message: 'Either scheduled_at or scheduled_date is required',
      path: ['scheduled_at'],
    }
  );
export type RescheduleContentInput = z.infer<typeof rescheduleContentInputSchema>;
