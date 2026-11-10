import { z } from 'zod';
import { isValidTimeZone } from '@/lib/temporal/timezone';

export const taskPriorityEnum = z.enum(['low', 'medium', 'high', 'urgent']);
export const taskStatusEnum = z.enum(['todo', 'in_progress', 'blocked', 'done', 'cancelled']);
export const recurrenceFrequencyEnum = z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']);

export const recurrenceInputSchema = z.object({
  frequency: recurrenceFrequencyEnum.refine(
    (f) => f !== 'custom',
    {
      message: "Unsupported recurrence frequency: 'custom'. Miler officially supports daily, weekly, monthly, and yearly.",
    }
  ),
  interval: z
    .number()
    .int('Interval must be an integer')
    .min(1, 'Interval must be a positive integer >= 1')
    .default(1),
  by_weekday: z
    .array(
      z.number().int('Weekday must be an integer').min(1, 'Weekday must be between 1 and 7').max(7, 'Weekday must be between 1 and 7')
    )
    .refine(
      (arr) => !arr || arr.length === new Set(arr).size,
      { message: 'by_weekday cannot contain duplicate days' }
    )
    .refine(
      (arr) => !arr || arr.length > 0,
      { message: 'by_weekday, if provided, must be a non-empty array' }
    )
    .optional()
    .nullable(),
  by_monthday: z
    .array(
      z.number().int('Month day must be an integer').min(1, 'Month day must be between 1 and 31').max(31, 'Month day must be between 1 and 31')
    )
    .refine(
      (arr) => !arr || arr.length === new Set(arr).size,
      { message: 'by_monthday cannot contain duplicate days' }
    )
    .refine(
      (arr) => !arr || arr.length > 0,
      { message: 'by_monthday, if provided, must be a non-empty array' }
    )
    .optional()
    .nullable(),
  until_date: z.string().datetime().optional().nullable(),
  count: z.number().int('Count must be an integer').min(1, 'Count must be a positive integer >= 1').optional().nullable(),
  timezone: z
    .string()
    .refine((tz) => isValidTimeZone(tz), { message: 'Invalid IANA timezone identifier' })
    .default('Asia/Cairo'),
  dtstart: z.string().datetime().optional().nullable(),
});

export const createTaskSchema = z
  .object({
    created_from: z.enum(['tasks', 'calendar']).optional(),
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
  )
  .refine(
    (data) => {
      if (data.recurrence && data.recurrence.until_date && data.recurrence.count) {
        return false;
      }
      return true;
    },
    {
      message: 'Cannot specify both until_date and count termination conditions',
      path: ['recurrence'],
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

export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;
export type TaskFilterInput = z.input<typeof taskFilterSchema>;
export type RecurrenceInput = z.input<typeof recurrenceInputSchema>;
