'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyDomainEvent } from '@/lib/services/notification-service';
import {
  createTask,
  updateTask,
  completeTask,
  skipTaskOccurrence,
  cancelTask,
  deleteTask,
  getTaskById,
  getTasks,
  addTaskDependency,
  removeTaskDependency,
  updateRecurrenceRule,
  stopRecurrence,
  makeTaskRecurring,
  type TaskWithMeta,
  type RecurrenceRuleDetail,
} from '@/lib/services/task-service';
import type { TaskPriority, TaskStatus, DependencyType } from '@/types/database';
import type { UpdateTaskInput, RecurrenceInput } from '@/lib/validation/task';

export interface TaskActionResult<T = unknown> {
  success?: boolean;
  error?: string;
  data?: T;
}

export async function createTaskAction(
  _prevState: TaskActionResult | null,
  formData: FormData
): Promise<TaskActionResult> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    const workspaceId = formData.get('workspace_id') as string;
    if (!workspaceId) {
      return { error: 'Workspace ID is required' };
    }

    const title = (formData.get('title') as string) || '';
    const description = (formData.get('description') as string) || null;
    const priority = ((formData.get('priority') as string) || 'medium') as TaskPriority;
    const status = ((formData.get('status') as string) || 'todo') as TaskStatus;
    const scheduledStart = (formData.get('scheduled_start') as string) || null;
    const scheduledEnd = (formData.get('scheduled_end') as string) || null;
    const dueDate = (formData.get('due_date') as string) || null;
    const isAllDay = formData.get('is_all_day') === 'true' || formData.get('is_all_day') === 'on';
    const projectId = (formData.get('project_id') as string) || null;
    const parentTaskId = (formData.get('parent_task_id') as string) || null;
    const durationStr = formData.get('estimated_duration_minutes') as string;
    const estimatedDuration = durationStr ? parseInt(durationStr, 10) : null;

    // Recurrence fields
    const frequency = formData.get('recurrence_frequency') as string;
    let recurrence: RecurrenceInput | null = null;
    if (frequency && frequency !== 'none') {
      const intervalStr = formData.get('recurrence_interval') as string;
      const interval = intervalStr ? parseInt(intervalStr, 10) : 1;
      const timezone =
        (formData.get('recurrence_timezone') as string) ||
        (formData.get('timezone') as string) ||
        'Asia/Cairo';

      // Weekdays
      const rawWeekdays = formData.getAll('recurrence_by_weekday');
      let by_weekday: number[] | null = null;
      if (rawWeekdays.length > 0) {
        by_weekday = rawWeekdays
          .map((w) => parseInt(w as string, 10))
          .filter((w) => !isNaN(w) && w >= 1 && w <= 7);
        if (by_weekday.length === 0) by_weekday = null;
      }

      // Month day
      const monthdayStr = formData.get('recurrence_by_monthday') as string;
      let by_monthday: number[] | null = null;
      if (monthdayStr) {
        const md = parseInt(monthdayStr, 10);
        if (!isNaN(md) && md >= 1 && md <= 31) {
          by_monthday = [md];
        }
      }

      // Termination conditions
      const endType = formData.get('recurrence_end_type') as string;
      let until_date: string | null = null;
      let count: number | null = null;

      if (endType === 'until_date') {
        const rawUntil = formData.get('recurrence_until_date') as string;
        if (rawUntil) {
          until_date = rawUntil.includes('T')
            ? new Date(rawUntil).toISOString()
            : new Date(`${rawUntil}T23:59:59.999Z`).toISOString();
        }
      } else if (endType === 'count') {
        const countStr = formData.get('recurrence_count') as string;
        if (countStr) {
          const c = parseInt(countStr, 10);
          if (!isNaN(c) && c >= 1) {
            count = c;
          }
        }
      }

      recurrence = {
        frequency: frequency as 'daily' | 'weekly' | 'monthly' | 'yearly',
        interval,
        by_weekday,
        by_monthday,
        until_date,
        count,
        timezone,
      };
    }

    const task = await createTask(
      supabase,
      workspaceId,
      {
        created_from: (formData.get('created_from') || undefined) as 'tasks' | 'calendar' | undefined,
        title,
        description,
        priority,
        status,
        scheduled_start: scheduledStart ? new Date(scheduledStart).toISOString() : null,
        scheduled_end: scheduledEnd ? new Date(scheduledEnd).toISOString() : null,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        is_all_day: isAllDay,
        estimated_duration_minutes: estimatedDuration,
        project_id: projectId,
        parent_task_id: parentTaskId,
        tags: [],
        recurrence,
      },
      authData.user.id
    );

    revalidatePath('/tasks');
    revalidatePath('/dashboard');
    revalidatePath('/calendar');
    return { success: true, data: task };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to create task' };
  }
}

export async function updateTaskAction(
  _prevState: TaskActionResult | null,
  formData: FormData
): Promise<TaskActionResult> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    const workspaceId = formData.get('workspace_id') as string;
    const taskId = formData.get('task_id') as string;

    if (!workspaceId || !taskId) {
      return { error: 'Workspace ID and Task ID are required' };
    }

    const input: UpdateTaskInput = {};

    if (formData.has('title')) {
      const val = formData.get('title');
      if (typeof val === 'string') input.title = val;
    }
    if (formData.has('description')) {
      const val = formData.get('description');
      input.description = typeof val === 'string' && val.length > 0 ? val : null;
    }
    if (formData.has('priority')) {
      const val = formData.get('priority');
      if (typeof val === 'string' && val) input.priority = val as TaskPriority;
    }
    if (formData.has('status')) {
      const val = formData.get('status');
      if (typeof val === 'string' && val) input.status = val as TaskStatus;
    }
    if (formData.has('scheduled_start')) {
      const val = formData.get('scheduled_start');
      input.scheduled_start = typeof val === 'string' && val ? new Date(val).toISOString() : null;
    }
    if (formData.has('scheduled_end')) {
      const val = formData.get('scheduled_end');
      input.scheduled_end = typeof val === 'string' && val ? new Date(val).toISOString() : null;
    }
    if (formData.has('due_date')) {
      const val = formData.get('due_date');
      input.due_date = typeof val === 'string' && val ? new Date(val).toISOString() : null;
    }
    if (formData.has('is_all_day')) {
      const isAllDayRaw = formData.get('is_all_day');
      input.is_all_day = isAllDayRaw === 'true' || isAllDayRaw === 'on';
    }
    if (formData.has('estimated_duration_minutes')) {
      const durationStr = formData.get('estimated_duration_minutes');
      input.estimated_duration_minutes = typeof durationStr === 'string' && durationStr ? parseInt(durationStr, 10) : null;
    }
    if (formData.has('project_id')) {
      const val = formData.get('project_id');
      input.project_id = typeof val === 'string' && val ? val : null;
    }

    const task = await updateTask(supabase, workspaceId, taskId, input);

    // If task was marked blocked, done, or cancelled, notify creator if different from actor
    if (task.created_by && task.created_by !== authData.user.id) {
      try {
        if (input.status === 'blocked') {
          const adminSupabase = createAdminClient();
          await notifyDomainEvent(adminSupabase, {
            workspaceId,
            recipientId: task.created_by,
            actorId: authData.user.id,
            title: `Task Blocked: ${task.title}`,
            message: `Task "${task.title}" is marked as blocked.`,
            entityType: 'task',
            entityId: task.id,
            idempotencyKey: `task_blocked:${task.id}:${task.updated_at || 'blocked'}`,
            preferenceCategory: 'notify_status_changes',
          });
        } else if (input.status === 'done') {
          const adminSupabase = createAdminClient();
          await notifyDomainEvent(adminSupabase, {
            workspaceId,
            recipientId: task.created_by,
            actorId: authData.user.id,
            title: `Task Completed: ${task.title}`,
            message: `Task "${task.title}" has been marked as completed.`,
            entityType: 'task',
            entityId: task.id,
            idempotencyKey: `task_completed:${task.id}:${task.completed_at || task.updated_at || 'done'}`,
            preferenceCategory: 'notify_status_changes',
          });
        } else if (input.status === 'cancelled') {
          const adminSupabase = createAdminClient();
          await notifyDomainEvent(adminSupabase, {
            workspaceId,
            recipientId: task.created_by,
            actorId: authData.user.id,
            title: `Task Cancelled: ${task.title}`,
            message: `Task "${task.title}" has been cancelled.`,
            entityType: 'task',
            entityId: task.id,
            idempotencyKey: `task_cancelled:${task.id}:${task.updated_at || 'cancelled'}`,
            preferenceCategory: 'notify_status_changes',
          });
        }
      } catch (notifyErr) {
        console.warn('Failed to dispatch notification for updateTaskAction:', notifyErr);
      }
    }

    revalidatePath('/tasks');
    revalidatePath('/dashboard');
    revalidatePath('/calendar');
    return { success: true, data: task };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to update task' };
  }
}

export async function completeTaskAction(
  workspaceId: string,
  taskId: string
): Promise<TaskActionResult> {
  try {
    const supabase = await createClient();
    const authRes = await supabase?.auth?.getUser?.();
    const res = await completeTask(supabase, workspaceId, taskId);

    // Attempt to notify task creator if distinct from actor
    try {
      const authData = authRes?.data;
      if (authData?.user && res.completedTask.created_by && res.completedTask.created_by !== authData.user.id) {
        const adminSupabase = createAdminClient();
        await notifyDomainEvent(adminSupabase, {
          workspaceId,
          recipientId: res.completedTask.created_by,
          actorId: authData.user.id,
          title: `Task Completed: ${res.completedTask.title}`,
          message: `Task "${res.completedTask.title}" has been marked as completed.`,
          entityType: 'task',
          entityId: res.completedTask.id,
          idempotencyKey: `task_completed:${res.completedTask.id}:${res.completedTask.completed_at || res.completedTask.updated_at || 'done'}`,
          preferenceCategory: 'notify_status_changes',
        });
      }
    } catch (notifyErr) {
      console.warn('Failed to dispatch notification for completeTaskAction:', notifyErr);
    }

    revalidatePath('/tasks');
    revalidatePath('/dashboard');
    revalidatePath('/calendar');
    return { success: true, data: res };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to complete task' };
  }
}

export async function skipTaskOccurrenceAction(
  workspaceId: string,
  taskId: string
): Promise<TaskActionResult> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;
    const res = await skipTaskOccurrence(supabase, workspaceId, taskId, userId);

    revalidatePath('/tasks');
    revalidatePath('/dashboard');
    revalidatePath('/calendar');
    return { success: true, data: res };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to skip task occurrence' };
  }
}

export async function cancelTaskAction(
  workspaceId: string,
  taskId: string
): Promise<TaskActionResult> {
  try {
    const supabase = await createClient();
    const res = await cancelTask(supabase, workspaceId, taskId);

    // Attempt to notify task creator if distinct from actor
    try {
      const authRes = await supabase?.auth?.getUser?.();
      const authData = authRes?.data;
      if (authData?.user && res.created_by && res.created_by !== authData.user.id) {
        const adminSupabase = createAdminClient();
        await notifyDomainEvent(adminSupabase, {
          workspaceId,
          recipientId: res.created_by,
          actorId: authData.user.id,
          title: `Task Cancelled: ${res.title}`,
          message: `Task "${res.title}" has been cancelled.`,
          entityType: 'task',
          entityId: res.id,
          idempotencyKey: `task_cancelled:${res.id}:${res.updated_at || 'cancelled'}`,
          preferenceCategory: 'notify_status_changes',
        });
      }
    } catch (notifyErr) {
      console.warn('Failed to dispatch notification for cancelTaskAction:', notifyErr);
    }

    revalidatePath('/tasks');
    revalidatePath('/dashboard');
    revalidatePath('/calendar');
    return { success: true, data: res };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to cancel task' };
  }
}

export async function deleteTaskAction(
  workspaceId: string,
  taskId: string
): Promise<TaskActionResult> {
  try {
    const supabase = await createClient();
    await deleteTask(supabase, workspaceId, taskId);
    revalidatePath('/tasks');
    revalidatePath('/dashboard');
    revalidatePath('/calendar');
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to delete task' };
  }
}

export async function addTaskDependencyAction(
  workspaceId: string,
  taskId: string,
  dependsOnTaskId: string,
  dependencyType: DependencyType = 'finish_to_start'
): Promise<TaskActionResult> {
  try {
    const supabase = await createClient();
    const res = await addTaskDependency(supabase, workspaceId, taskId, dependsOnTaskId, dependencyType);
    revalidatePath('/tasks');
    return { success: true, data: res };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to add dependency' };
  }
}

export async function removeTaskDependencyAction(
  workspaceId: string,
  dependencyId: string
): Promise<TaskActionResult> {
  try {
    const supabase = await createClient();
    await removeTaskDependency(supabase, workspaceId, dependencyId);
    revalidatePath('/tasks');
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to remove dependency' };
  }
}

export async function getTaskDetailAction(
  workspaceId: string,
  taskId: string
): Promise<TaskActionResult> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    if (!workspaceId || !taskId) {
      return { error: 'Workspace ID and Task ID are required' };
    }

    const detail = await getTaskById(supabase, workspaceId, taskId);
    if (!detail) {
      return { error: 'Task not found' };
    }

    return { success: true, data: detail };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to fetch task details' };
  }
}

export async function getScheduledTasksAction(
  workspaceId: string,
  filter: { scheduled_from: string; scheduled_to: string }
): Promise<TaskActionResult<TaskWithMeta[]>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    if (!workspaceId) {
      return { error: 'Workspace ID is required' };
    }

    const tasks = await getTasks(supabase, workspaceId, {
      scheduled_from: filter.scheduled_from,
      scheduled_to: filter.scheduled_to,
      parent_task_id: null,
    });

    return { success: true, data: tasks };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to fetch scheduled tasks' };
  }
}

/**
 * Updates a recurring series schedule rule.
 * Affects future virtual calendar projections and subsequent occurrence generation.
 */
export async function updateRecurrenceRuleAction(
  workspaceId: string,
  ruleId: string,
  input: RecurrenceInput
): Promise<TaskActionResult<RecurrenceRuleDetail>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    if (!workspaceId || !ruleId) {
      return { error: 'Workspace ID and Rule ID are required' };
    }

    const updated = await updateRecurrenceRule(supabase, workspaceId, ruleId, input);

    revalidatePath('/calendar');
    revalidatePath('/tasks');

    return { success: true, data: updated };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to update recurrence rule' };
  }
}

/**
 * Stops an entire recurring series:
 * Closes the recurrence boundary, prevents further occurrence generation,
 * and clears future calendar previews while preserving historical completed tasks.
 */
export async function stopRecurrenceAction(
  workspaceId: string,
  ruleId: string,
  currentTaskId?: string
): Promise<TaskActionResult<{ success: boolean; stoppedRuleId: string }>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    if (!workspaceId || !ruleId) {
      return { error: 'Workspace ID and Rule ID are required' };
    }

    const result = await stopRecurrence(supabase, workspaceId, ruleId, { currentTaskId });

    revalidatePath('/calendar');
    revalidatePath('/tasks');

    return { success: true, data: result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to stop recurrence' };
  }
}

/**
 * Converts a standalone one-time task into a recurring series.
 */
export async function makeTaskRecurringAction(
  workspaceId: string,
  taskId: string,
  input: RecurrenceInput
): Promise<TaskActionResult<{ task: TaskWithMeta; rule: RecurrenceRuleDetail }>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    if (!workspaceId || !taskId) {
      return { error: 'Workspace ID and Task ID are required' };
    }

    const result = await makeTaskRecurring(supabase, workspaceId, taskId, input);

    revalidatePath('/calendar');
    revalidatePath('/tasks');

    return { success: true, data: result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to make task recurring' };
  }
}
