import { z } from 'zod';

export const taskPriorityEnum = z.enum(['low', 'medium', 'high', 'urgent']);
export const taskStatusEnum = z.enum(['todo', 'in_progress', 'blocked', 'done', 'cancelled']);
export const recurrenceFrequencyEnum = z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']);

export const recurrenceInputSchema = z.object({
  frequency: recurrenceFrequencyEnum,
  interval: z.number().int().min(1).default(1),
  by_weekday: z.array(z.number().int().min(1).max(7)).optional(),
  by_monthday: z.array(z.number().int().min(1).max(31)).optional(),
  until_date: z.string().datetime().optional().nullable(),
  count: z.number().int().min(1).optional().nullable(),
  timezone: z.string().default('Asia/Cairo'),
});

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'Task title is required').max(255, 'Title is too long'),
    description: z.string().trim().max(5000).optional().nullable(),
    priority: taskPriorityEnum.default('medium'),
    status: taskStatusEnum.default('todo'),
    scheduled_start: z.string().datetime().optional().nullable(),
    scheduled_end: z.string().datetime().optional().nullable(),
    due_date: z.string().datetime().optional().nullable(),
    is_all_day: z.boolean().default(false),
    estimated_duration_minutes: z.number().int().min(1).max(10080).optional().nullable(), // Max 1 week in minutes
    project_id: z.string().uuid('Invalid project ID').optional().nullable(),
    milestone_id: z.string().uuid('Invalid milestone ID').optional().nullable(),
    parent_task_id: z.string().uuid('Invalid parent task ID').optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(50)).default([]),
    recurrence: recurrenceInputSchema.optional().nullable(),
  })
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

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'Task title cannot be empty').max(255).optional(),
    description: z.string().trim().max(5000).optional().nullable(),
    priority: taskPriorityEnum.optional(),
    status: taskStatusEnum.optional(),
    scheduled_start: z.string().datetime().optional().nullable(),
    scheduled_end: z.string().datetime().optional().nullable(),
    due_date: z.string().datetime().optional().nullable(),
    is_all_day: z.boolean().optional(),
    estimated_duration_minutes: z.number().int().min(1).max(10080).optional().nullable(),
    project_id: z.string().uuid().optional().nullable(),
    milestone_id: z.string().uuid().optional().nullable(),
    parent_task_id: z.string().uuid().optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(50)).optional(),
  })
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

export const taskFilterSchema = z.object({
  status: z.union([taskStatusEnum, z.array(taskStatusEnum)]).optional(),
  priority: z.union([taskPriorityEnum, z.array(taskPriorityEnum)]).optional(),
  project_id: z.string().uuid().optional(),
  due_date_from: z.string().datetime().optional(),
  due_date_to: z.string().datetime().optional(),
  scheduled_from: z.string().datetime().optional(),
  scheduled_to: z.string().datetime().optional(),
  is_scheduled: z.boolean().optional(),
  search: z.string().optional(),
  parent_task_id: z.string().uuid().optional().nullable(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskFilterInput = z.infer<typeof taskFilterSchema>;
export type RecurrenceInput = z.infer<typeof recurrenceInputSchema>;
