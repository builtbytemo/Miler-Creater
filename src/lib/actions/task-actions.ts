'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  createTask,
  updateTask,
  completeTask,
  cancelTask,
  deleteTask,
  getTaskById,
  addTaskDependency,
  removeTaskDependency,
} from '@/lib/services/task-service';
import type { TaskPriority, TaskStatus, DependencyType } from '@/types/database';
import type { UpdateTaskInput } from '@/lib/validation/task';

export interface TaskActionResult {
  success?: boolean;
  error?: string;
  data?: unknown;
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
    const intervalStr = formData.get('recurrence_interval') as string;
    let recurrence = null;
    if (frequency && frequency !== 'none') {
      recurrence = {
        frequency: frequency as 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom',
        interval: intervalStr ? parseInt(intervalStr, 10) : 1,
        timezone: 'Asia/Cairo',
      };
    }

    const task = await createTask(
      supabase,
      workspaceId,
      {
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

    revalidatePath('/tasks');
    revalidatePath('/dashboard');
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
    const res = await completeTask(supabase, workspaceId, taskId);
    revalidatePath('/tasks');
    revalidatePath('/dashboard');
    return { success: true, data: res };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to complete task' };
  }
}

export async function cancelTaskAction(
  workspaceId: string,
  taskId: string
): Promise<TaskActionResult> {
  try {
    const supabase = await createClient();
    const res = await cancelTask(supabase, workspaceId, taskId);
    revalidatePath('/tasks');
    revalidatePath('/dashboard');
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
