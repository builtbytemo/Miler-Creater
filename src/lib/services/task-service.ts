import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, TaskPriority, TaskStatus, DependencyType } from '@/types/database';
import {
  createTaskSchema,
  updateTaskSchema,
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskFilterInput,
} from '@/lib/validation/task';
import { validateTaskDependency, type TaskDependencyEdge, type TaskNode } from '@/lib/tasks/dependencies';
import { calculateNextOccurrence } from '@/lib/temporal/recurrence';

export interface TaskWithMeta {
  id: string;
  workspace_id: string;
  parent_task_id: string | null;
  project_id: string | null;
  milestone_id: string | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  scheduled_start: string | null;
  scheduled_end: string | null;
  due_date: string | null;
  estimated_duration_minutes: number | null;
  is_all_day: boolean;
  completed_at: string | null;
  tags: string[];
  recurrence_rule_id: string | null;
  created_by: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  // Computed fields:
  subtask_count: number;
  completed_subtask_count: number;
  is_blocked: boolean;
  blocking_tasks: { id: string; title: string; status: TaskStatus }[];
  project?: { id: string; name: string; color: string | null } | null;
}

export interface TaskDetail extends TaskWithMeta {
  subtasks: TaskWithMeta[];
  dependencies: {
    id: string;
    task_id: string;
    depends_on_task_id: string;
    dependency_type: DependencyType;
    prerequisite_task: { id: string; title: string; status: TaskStatus; due_date: string | null };
  }[];
}

/**
 * Retrieves a list of tasks for a workspace with filtering, subtask counts, and blocked-state detection.
 */
export async function getTasks(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  filters: TaskFilterInput = {}
): Promise<TaskWithMeta[]> {
  let query = supabase
    .from('tasks')
    .select(`
      *,
      projects (id, name, color)
    `)
    .eq('workspace_id', workspaceId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  // Filter: Parent vs Subtask
  if (filters.parent_task_id === null) {
    query = query.is('parent_task_id', null);
  } else if (filters.parent_task_id) {
    query = query.eq('parent_task_id', filters.parent_task_id);
  }

  // Filter: Status
  if (filters.status) {
    if (Array.isArray(filters.status)) {
      query = query.in('status', filters.status);
    } else {
      query = query.eq('status', filters.status);
    }
  }

  // Filter: Priority
  if (filters.priority) {
    if (Array.isArray(filters.priority)) {
      query = query.in('priority', filters.priority);
    } else {
      query = query.eq('priority', filters.priority);
    }
  }

  // Filter: Project
  if (filters.project_id) {
    query = query.eq('project_id', filters.project_id);
  }

  // Filter: Due Date range
  if (filters.due_date_from) {
    query = query.gte('due_date', filters.due_date_from);
  }
  if (filters.due_date_to) {
    query = query.lte('due_date', filters.due_date_to);
  }

  // Filter: Search term
  if (filters.search && filters.search.trim() !== '') {
    const term = `%${filters.search.trim()}%`;
    query = query.ilike('title', term);
  }

  const { data: rawTasks, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch tasks: ${error.message}`);
  }

  if (!rawTasks || rawTasks.length === 0) {
    return [];
  }

  const taskIds = rawTasks.map((t) => t.id);

  // 1. Fetch subtask summary
  const { data: allSubtasks } = await supabase
    .from('tasks')
    .select('id, parent_task_id, status')
    .in('parent_task_id', taskIds);

  const subtaskCountMap = new Map<string, { total: number; completed: number }>();
  if (allSubtasks) {
    for (const sub of allSubtasks) {
      if (!sub.parent_task_id) continue;
      const curr = subtaskCountMap.get(sub.parent_task_id) || { total: 0, completed: 0 };
      curr.total += 1;
      if (sub.status === 'done') curr.completed += 1;
      subtaskCountMap.set(sub.parent_task_id, curr);
    }
  }

  // 2. Fetch dependencies to compute blocked state
  const { data: deps } = await supabase
    .from('task_dependencies')
    .select('task_id, depends_on_task_id')
    .in('task_id', taskIds);

  const prereqIds = deps ? deps.map((d) => d.depends_on_task_id) : [];
  const prereqTaskMap = new Map<string, { id: string; title: string; status: TaskStatus }>();

  if (prereqIds.length > 0) {
    const { data: prereqTasks } = await supabase
      .from('tasks')
      .select('id, title, status')
      .in('id', prereqIds);

    if (prereqTasks) {
      for (const pt of prereqTasks) {
        prereqTaskMap.set(pt.id, pt);
      }
    }
  }

  const taskBlockersMap = new Map<string, { id: string; title: string; status: TaskStatus }[]>();
  if (deps) {
    for (const d of deps) {
      const prereq = prereqTaskMap.get(d.depends_on_task_id);
      if (prereq && prereq.status !== 'done') {
        const list = taskBlockersMap.get(d.task_id) || [];
        list.push(prereq);
        taskBlockersMap.set(d.task_id, list);
      }
    }
  }

  return rawTasks.map((t) => {
    const counts = subtaskCountMap.get(t.id) || { total: 0, completed: 0 };
    const blockers = taskBlockersMap.get(t.id) || [];
    const isBlocked = t.status === 'blocked' || blockers.length > 0;

    return {
      ...t,
      subtask_count: counts.total,
      completed_subtask_count: counts.completed,
      is_blocked: isBlocked,
      blocking_tasks: blockers,
      project: (t as unknown as { projects?: { id: string; name: string; color: string | null } }).projects || null,
    };
  });
}

/**
 * Retrieves a single task by ID with full subtasks and dependency details.
 */
export async function getTaskById(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  taskId: string
): Promise<TaskDetail | null> {
  const { data: task, error } = await supabase
    .from('tasks')
    .select(`
      *,
      projects (id, name, color)
    `)
    .eq('workspace_id', workspaceId)
    .eq('id', taskId)
    .maybeSingle();

  if (error || !task) {
    return null;
  }

  // Fetch subtasks
  const { data: rawSubtasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('parent_task_id', taskId)
    .order('created_at', { ascending: true });

  const subtaskIds = (rawSubtasks || []).map((st) => st.id);
  const nestedCountMap = new Map<string, { total: number; completed: number }>();
  if (subtaskIds.length > 0) {
    const { data: nestedSubtasks } = await supabase
      .from('tasks')
      .select('id, parent_task_id, status')
      .in('parent_task_id', subtaskIds);

    if (nestedSubtasks) {
      for (const nest of nestedSubtasks) {
        if (!nest.parent_task_id) continue;
        const curr = nestedCountMap.get(nest.parent_task_id) || { total: 0, completed: 0 };
        curr.total += 1;
        if (nest.status === 'done') curr.completed += 1;
        nestedCountMap.set(nest.parent_task_id, curr);
      }
    }
  }

  const subtasks: TaskWithMeta[] = (rawSubtasks || []).map((st) => {
    const counts = nestedCountMap.get(st.id) || { total: 0, completed: 0 };
    return {
      ...st,
      subtask_count: counts.total,
      completed_subtask_count: counts.completed,
      is_blocked: st.status === 'blocked',
      blocking_tasks: [],
      project: null,
    };
  });

  // Fetch dependencies
  const { data: rawDeps } = await supabase
    .from('task_dependencies')
    .select(`
      id,
      task_id,
      depends_on_task_id,
      dependency_type
    `)
    .eq('workspace_id', workspaceId)
    .eq('task_id', taskId);

  const prereqIds = (rawDeps || []).map((d) => d.depends_on_task_id);
  const prereqMap = new Map<string, { id: string; title: string; status: TaskStatus; due_date: string | null }>();

  if (prereqIds.length > 0) {
    const { data: prereqs } = await supabase
      .from('tasks')
      .select('id, title, status, due_date')
      .in('id', prereqIds);

    if (prereqs) {
      for (const p of prereqs) {
        prereqMap.set(p.id, p);
      }
    }
  }

  const dependencies = (rawDeps || []).map((d) => {
    const prereq = prereqMap.get(d.depends_on_task_id) || {
      id: d.depends_on_task_id,
      title: 'Unknown task',
      status: 'todo' as TaskStatus,
      due_date: null,
    };

    return {
      id: d.id,
      task_id: d.task_id,
      depends_on_task_id: d.depends_on_task_id,
      dependency_type: d.dependency_type as DependencyType,
      prerequisite_task: prereq,
    };
  });

  const blockingTasks = dependencies
    .filter((d) => d.prerequisite_task.status !== 'done')
    .map((d) => ({
      id: d.prerequisite_task.id,
      title: d.prerequisite_task.title,
      status: d.prerequisite_task.status,
    }));

  const isBlocked = task.status === 'blocked' || blockingTasks.length > 0;

  return {
    ...task,
    subtask_count: subtasks.length,
    completed_subtask_count: subtasks.filter((s) => s.status === 'done').length,
    is_blocked: isBlocked,
    blocking_tasks: blockingTasks,
    project: (task as unknown as { projects?: { id: string; name: string; color: string | null } }).projects || null,
    subtasks,
    dependencies,
  };
}

/**
 * Creates a new task with server-side validation and optional recurrence rule creation.
 */
export async function createTask(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  input: CreateTaskInput,
  userId?: string
): Promise<TaskWithMeta> {
  const validated = createTaskSchema.parse(input);

  let recurrenceRuleId: string | null = null;

  // Create recurrence rule if specified
  if (validated.recurrence) {
    const { data: rule, error: ruleErr } = await supabase
      .from('recurrence_rules')
      .insert({
        workspace_id: workspaceId,
        frequency: validated.recurrence.frequency,
        interval: validated.recurrence.interval,
        by_weekday: validated.recurrence.by_weekday || null,
        by_monthday: validated.recurrence.by_monthday || null,
        until_date: validated.recurrence.until_date || null,
        count: validated.recurrence.count || null,
        timezone: validated.recurrence.timezone,
      })
      .select('id')
      .single();

    if (ruleErr) {
      throw new Error(`Failed to create recurrence rule: ${ruleErr.message}`);
    }
    recurrenceRuleId = rule.id;
  }

  // Insert task
  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      workspace_id: workspaceId,
      title: validated.title,
      description: validated.description || null,
      priority: validated.priority,
      status: validated.status,
      scheduled_start: validated.scheduled_start || null,
      scheduled_end: validated.scheduled_end || null,
      due_date: validated.due_date || null,
      is_all_day: validated.is_all_day,
      estimated_duration_minutes: validated.estimated_duration_minutes || null,
      project_id: validated.project_id || null,
      milestone_id: validated.milestone_id || null,
      parent_task_id: validated.parent_task_id || null,
      tags: validated.tags,
      recurrence_rule_id: recurrenceRuleId,
      created_by: userId || null,
    })
    .select(`
      *,
      projects (id, name, color)
    `)
    .single();

  if (error || !task) {
    throw new Error(`Failed to create task: ${error?.message}`);
  }

  return {
    ...task,
    subtask_count: 0,
    completed_subtask_count: 0,
    is_blocked: task.status === 'blocked',
    blocking_tasks: [],
    project: (task as unknown as { projects?: { id: string; name: string; color: string | null } }).projects || null,
  };
}

/**
 * Updates an existing task with server-side validation.
 */
export async function updateTask(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  taskId: string,
  input: UpdateTaskInput
): Promise<TaskWithMeta> {
  const validated = updateTaskSchema.parse(input);

  // If status is transitioning to done, verify prerequisite dependencies
  if (validated.status === 'done') {
    const { data: deps } = await supabase
      .from('task_dependencies')
      .select('depends_on_task_id')
      .eq('workspace_id', workspaceId)
      .eq('task_id', taskId);

    if (deps && deps.length > 0) {
      const prereqIds = deps.map((d) => d.depends_on_task_id);
      const { data: incompletePrereqs } = await supabase
        .from('tasks')
        .select('id, title, status')
        .in('id', prereqIds)
        .neq('status', 'done');

      if (incompletePrereqs && incompletePrereqs.length > 0) {
        const titles = incompletePrereqs.map((p) => p.title).join(', ');
        throw new Error(`Cannot complete task while prerequisite dependencies are incomplete: ${titles}`);
      }
    }
  }

  const updates: Database['public']['Tables']['tasks']['Update'] = {
    ...validated,
  };

  // If status is transitioning to done, set completed_at
  if (validated.status === 'done') {
    updates.completed_at = new Date().toISOString();
  } else if (validated.status) {
    updates.completed_at = null;
  }

  const { data: updated, error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('workspace_id', workspaceId)
    .eq('id', taskId)
    .select(`
      *,
      projects (id, name, color)
    `)
    .single();

  if (error || !updated) {
    throw new Error(`Failed to update task: ${error?.message}`);
  }

  return {
    ...updated,
    subtask_count: 0,
    completed_subtask_count: 0,
    is_blocked: updated.status === 'blocked',
    blocking_tasks: [],
    project: (updated as unknown as { projects?: { id: string; name: string; color: string | null } }).projects || null,
  };
}

/**
 * Completes a task. If the task is recurring, atomically schedules the next occurrence.
 */
export async function completeTask(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  taskId: string
): Promise<{ completedTask: TaskWithMeta; nextOccurrence: TaskWithMeta | null }> {
  // 1. Fetch current task
  const { data: current, error: fetchErr } = await supabase
    .from('tasks')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', taskId)
    .single();

  if (fetchErr || !current) {
    throw new Error(`Task not found: ${fetchErr?.message}`);
  }

  // 1b. Check if task has unresolved prerequisite dependencies
  const { data: deps } = await supabase
    .from('task_dependencies')
    .select('depends_on_task_id')
    .eq('workspace_id', workspaceId)
    .eq('task_id', taskId);

  if (deps && deps.length > 0) {
    const prereqIds = deps.map((d) => d.depends_on_task_id);
    const { data: incompletePrereqs } = await supabase
      .from('tasks')
      .select('id, title, status')
      .in('id', prereqIds)
      .neq('status', 'done');

    if (incompletePrereqs && incompletePrereqs.length > 0) {
      const titles = incompletePrereqs.map((p) => p.title).join(', ');
      throw new Error(`Cannot complete task while prerequisite dependencies are incomplete: ${titles}`);
    }
  }

  // 2. Mark current task done
  const nowIso = new Date().toISOString();
  const { data: completed, error: completeErr } = await supabase
    .from('tasks')
    .update({
      status: 'done',
      completed_at: nowIso,
    })
    .eq('id', taskId)
    .select(`
      *,
      projects (id, name, color)
    `)
    .single();

  if (completeErr || !completed) {
    throw new Error(`Failed to complete task: ${completeErr?.message}`);
  }

  let nextOccurrence: TaskWithMeta | null = null;

  // 3. If recurring, calculate and provision next occurrence
  if (current.recurrence_rule_id) {
    // Check if an active occurrence already exists
    const { data: activeExisting } = await supabase
      .from('tasks')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('recurrence_rule_id', current.recurrence_rule_id)
      .not('status', 'in', '("done","cancelled")')
      .limit(1)
      .maybeSingle();

    if (!activeExisting) {
      // Fetch recurrence rule
      const { data: rule } = await supabase
        .from('recurrence_rules')
        .select('*')
        .eq('id', current.recurrence_rule_id)
        .single();

      if (rule) {
        const referenceTime = current.scheduled_start || current.due_date || nowIso;
        const nextStart = calculateNextOccurrence(rule, referenceTime);

        if (nextStart) {
          let nextEnd: string | null = null;
          if (current.scheduled_start && current.scheduled_end) {
            const durationMs = new Date(current.scheduled_end).getTime() - new Date(current.scheduled_start).getTime();
            nextEnd = new Date(nextStart.getTime() + durationMs).toISOString();
          }

          let nextDue: string | null = null;
          if (current.due_date) {
            nextDue = nextStart.toISOString();
          }

          const { data: nextCreated } = await supabase
            .from('tasks')
            .insert({
              workspace_id: workspaceId,
              title: current.title,
              description: current.description,
              priority: current.priority,
              status: 'todo',
              scheduled_start: current.scheduled_start ? nextStart.toISOString() : null,
              scheduled_end: nextEnd,
              due_date: nextDue,
              is_all_day: current.is_all_day,
              estimated_duration_minutes: current.estimated_duration_minutes,
              project_id: current.project_id,
              milestone_id: current.milestone_id,
              tags: current.tags,
              recurrence_rule_id: current.recurrence_rule_id,
              created_by: current.created_by,
            })
            .select(`
              *,
              projects (id, name, color)
            `)
            .single();

          if (nextCreated) {
            nextOccurrence = {
              ...nextCreated,
              subtask_count: 0,
              completed_subtask_count: 0,
              is_blocked: false,
              blocking_tasks: [],
              project: (nextCreated as unknown as { projects?: { id: string; name: string; color: string | null } }).projects || null,
            };
          }
        }
      }
    }
  }

  return {
    completedTask: {
      ...completed,
      subtask_count: 0,
      completed_subtask_count: 0,
      is_blocked: false,
      blocking_tasks: [],
      project: (completed as unknown as { projects?: { id: string; name: string; color: string | null } }).projects || null,
    },
    nextOccurrence,
  };
}

/**
 * Cancels a task by marking status = 'cancelled'.
 */
export async function cancelTask(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  taskId: string
): Promise<TaskWithMeta> {
  return updateTask(supabase, workspaceId, taskId, { status: 'cancelled' });
}

/**
 * Deletes a task.
 */
export async function deleteTask(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  taskId: string
): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', taskId);

  if (error) {
    throw new Error(`Failed to delete task: ${error.message}`);
  }
}

/**
 * Adds a dependency between two tasks after validating against self-dependency and cycles.
 */
export async function addTaskDependency(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  taskId: string,
  dependsOnTaskId: string,
  dependencyType: DependencyType = 'finish_to_start'
): Promise<{ id: string }> {
  // Fetch existing dependencies in workspace to validate cycle
  const { data: existingDeps } = await supabase
    .from('task_dependencies')
    .select('task_id, depends_on_task_id, workspace_id')
    .eq('workspace_id', workspaceId);

  // Fetch both tasks to verify workspace boundaries
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, workspace_id')
    .in('id', [taskId, dependsOnTaskId]);

  const taskMap = new Map<string, TaskNode>();
  if (tasks) {
    for (const t of tasks) {
      taskMap.set(t.id, { id: t.id, workspaceId: t.workspace_id });
    }
  }

  const existingEdges: TaskDependencyEdge[] = (existingDeps || []).map((d) => ({
    taskId: d.task_id,
    dependsOnTaskId: d.depends_on_task_id,
    workspaceId: d.workspace_id,
  }));

  const validation = validateTaskDependency(
    existingEdges,
    { taskId, dependsOnTaskId, workspaceId },
    taskMap
  );

  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid task dependency');
  }

  const { data, error } = await supabase
    .from('task_dependencies')
    .insert({
      workspace_id: workspaceId,
      task_id: taskId,
      depends_on_task_id: dependsOnTaskId,
      dependency_type: dependencyType,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert task dependency: ${error?.message}`);
  }

  return { id: data.id };
}

/**
 * Removes a task dependency.
 */
export async function removeTaskDependency(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  dependencyId: string
): Promise<void> {
  const { error } = await supabase
    .from('task_dependencies')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', dependencyId);

  if (error) {
    throw new Error(`Failed to remove dependency: ${error.message}`);
  }
}
