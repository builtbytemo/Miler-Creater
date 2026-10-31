import { z } from 'zod';
import { taskPriorityEnum, taskStatusEnum } from '@/lib/validation/task';
import {
  socialPlatformEnum,
  contentActionTypeEnum,
  contentStatusEnum,
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

/**
 * 9. update_task
 * Updates task attributes (title, description, priority, duration, tags, project).
 * NOTE: Lifecycle status changes are intentionally separated into change_task_status
 * to ensure prerequisite dependencies and recurring task spawning are strictly enforced.
 */
export const updateTaskInputSchema = z
  .object({
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

/**
 * 12. create_content_item
 * Creates an idea or scheduled draft for social media.
 */
export const createContentItemInputSchema = z
  .object({
    platform: socialPlatformEnum,
    action_type: contentActionTypeEnum.default('post'),
    status: z.enum(['idea', 'draft', 'scheduled']).default('idea'),
    title: z.string().trim().max(255).optional().nullable(),
    body: z.string().default(''),
    scheduled_at: z.string().datetime().optional().nullable(),
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
  );
export type CreateContentItemInput = z.infer<typeof createContentItemInputSchema>;

/**
 * 13. update_content_item
 * Updates an existing content item's copy, title, platform, status, or notes.
 */
export const updateContentItemInputSchema = z
  .object({
    content_id: z.string().uuid('content_id must be a valid UUID'),
    title: z.string().trim().max(255).optional().nullable(),
    body: z.string().optional(),
    platform: socialPlatformEnum.optional(),
    action_type: contentActionTypeEnum.optional(),
    status: z.enum(['idea', 'draft', 'scheduled', 'archived']).optional(),
    scheduled_at: z.string().datetime().optional().nullable(),
    duration_minutes: z.number().int().min(1).max(10080).optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(50)).optional(),
    notes: z.string().trim().max(10000).optional().nullable(),
    project_id: z.string().uuid('project_id must be a valid UUID').optional().nullable(),
  })
  .strict();
export type UpdateContentItemInput = z.infer<typeof updateContentItemInputSchema>;

/**
 * 14. reschedule_content
 * Adjusts the planned publication datetime (scheduled_at) for a content item.
 */
export const rescheduleContentInputSchema = z
  .object({
    content_id: z.string().uuid('content_id must be a valid UUID'),
    scheduled_at: z.string().datetime({ message: 'scheduled_at must be a valid ISO 8601 datetime' }),
  })
  .strict();
export type RescheduleContentInput = z.infer<typeof rescheduleContentInputSchema>;
