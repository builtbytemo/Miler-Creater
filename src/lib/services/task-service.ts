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
import {
  calculateNextOccurrence,
  calculateNextUpcomingSlot,
  projectOccurrencesInRange,
  type RecurrenceRuleParams,
} from '@/lib/temporal/recurrence';

export {
  generateOccurrencesInRange,
  projectOccurrencesInRange,
} from '@/lib/temporal/recurrence';

export interface TaskWithMeta {
  created_from?: 'tasks' | 'calendar';
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
  occurrence_index?: number | null;
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
  is_virtual?: boolean;
  original_task_id?: string | null;
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

  // Filter: Scheduled range (includes tasks whose due_date falls in range when querying for Calendar)
  if (
    filters.scheduled_from &&
    filters.scheduled_to &&
    !filters.due_date_from &&
    !filters.due_date_to &&
    filters.is_scheduled === undefined &&
    typeof query.or === 'function'
  ) {
    query = query.or(
      `and(scheduled_start.gte.${filters.scheduled_from},scheduled_start.lte.${filters.scheduled_to}),and(due_date.gte.${filters.scheduled_from},due_date.lte.${filters.scheduled_to})`
    );
  } else {
    if (filters.scheduled_from) {
      query = query.gte('scheduled_start', filters.scheduled_from);
    }
    if (filters.scheduled_to) {
      query = query.lte('scheduled_start', filters.scheduled_to);
    }
  }
  if (filters.is_scheduled === true) {
    query = query.not('scheduled_start', 'is', null);
  } else if (filters.is_scheduled === false) {
    query = query.is('scheduled_start', null);
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

  const isCalendarRange = Boolean(
    filters.scheduled_from && filters.scheduled_to && filters.include_virtual !== false
  );

  if ((!rawTasks || rawTasks.length === 0) && !isCalendarRange) {
    return [];
  }

  const safeRawTasks = rawTasks || [];
  const taskIds = safeRawTasks.map((t) => t.id);

  // 1. Fetch subtask summary
  const subtaskCountMap = new Map<string, { total: number; completed: number }>();
  if (taskIds.length > 0) {
    const { data: allSubtasks } = await supabase
      .from('tasks')
      .select('id, parent_task_id, status')
      .in('parent_task_id', taskIds);

    if (allSubtasks) {
      for (const sub of allSubtasks) {
        if (!sub.parent_task_id) continue;
        const curr = subtaskCountMap.get(sub.parent_task_id) || { total: 0, completed: 0 };
        curr.total += 1;
        if (sub.status === 'done') curr.completed += 1;
        subtaskCountMap.set(sub.parent_task_id, curr);
      }
    }
  }

  // 2. Fetch dependencies to compute blocked state
  const taskBlockersMap = new Map<string, { id: string; title: string; status: TaskStatus }[]>();
  if (taskIds.length > 0) {
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
  }

  const concreteTasks: TaskWithMeta[] = safeRawTasks.map((t) => {
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

  // If this is a calendar range query, project virtual occurrences
  if (filters.scheduled_from && filters.scheduled_to && filters.include_virtual !== false) {
    try {
      const virtualTasks = await projectVirtualTaskOccurrences(
        supabase,
        workspaceId,
        filters.scheduled_from,
        filters.scheduled_to,
        concreteTasks,
        {
          projectIds: filters.project_id ? [filters.project_id] : undefined,
          statuses: filters.status
            ? Array.isArray(filters.status)
              ? filters.status
              : [filters.status]
            : undefined,
        }
      );

      if (virtualTasks.length > 0) {
        const combined = [...concreteTasks, ...virtualTasks];
        // Sort chronologically by scheduled_start or due_date
        combined.sort((a, b) => {
          const timeA = a.scheduled_start
            ? new Date(a.scheduled_start).getTime()
            : a.due_date
            ? new Date(a.due_date).getTime()
            : 0;
          const timeB = b.scheduled_start
            ? new Date(b.scheduled_start).getTime()
            : b.due_date
            ? new Date(b.due_date).getTime()
            : 0;
          return timeA - timeB;
        });
        return combined;
      }
    } catch {
      // In case virtual projection fails (e.g. mock or pending migration), fail safely to concrete tasks
    }
  }

  return concreteTasks;
}

export interface ProjectVirtualOccurrencesOptions {
  userTimeZone?: string;
  includeCompleted?: boolean;
  projectIds?: string[];
  statuses?: string[];
  maxOccurrencesPerRule?: number;
}

/**
 * Projects virtual task occurrences for recurring series in the workspace for a given date window.
 * Strictly read-only: does NOT mutate the database.
 * Enforces:
 * - Real stored occurrences take precedence over virtual occurrences.
 * - Deterministic collision-resistant IDs: `virtual:${rule.id}:${index}:${timestamp}`.
 * - Series color stability via `recurrence_rule_id`.
 * - Bounded iterations and range limits.
 */
export async function projectVirtualTaskOccurrences(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  startDate: string | Date,
  endDate: string | Date,
  existingTasks?: TaskWithMeta[],
  options?: ProjectVirtualOccurrencesOptions
): Promise<TaskWithMeta[]> {
  const startIso = typeof startDate === 'string' ? startDate : startDate.toISOString();
  const endIso = typeof endDate === 'string' ? endDate : endDate.toISOString();

  // 1. Fetch recurrence rules for this workspace
  const { data: rules, error: rulesErr } = await supabase
    .from('recurrence_rules')
    .select('*')
    .eq('workspace_id', workspaceId);

  if (rulesErr || !rules || rules.length === 0) {
    return [];
  }

  // 2. Fetch tasks belonging to these recurrence rules in this workspace
  const ruleIds = rules.map((r) => r.id);
  const { data: rawSeriesTasks, error: tasksErr } = await supabase
    .from('tasks')
    .select(`
      *,
      projects (id, name, color)
    `)
    .eq('workspace_id', workspaceId)
    .in('recurrence_rule_id', ruleIds);

  if (tasksErr || !rawSeriesTasks || rawSeriesTasks.length === 0) {
    return [];
  }

  // Merge with existingTasks if provided
  const combinedTasksMap = new Map<string, TaskWithMeta | (typeof rawSeriesTasks)[0]>();
  for (const st of rawSeriesTasks) {
    combinedTasksMap.set(st.id, st);
  }
  if (existingTasks) {
    for (const et of existingTasks) {
      if (et.recurrence_rule_id && et.workspace_id === workspaceId) {
        combinedTasksMap.set(et.id, et);
      }
    }
  }

  // Group tasks by recurrence_rule_id
  const tasksByRule = new Map<string, Array<TaskWithMeta | (typeof rawSeriesTasks)[0]>>();
  for (const t of combinedTasksMap.values()) {
    if (!t.recurrence_rule_id) continue;
    const list = tasksByRule.get(t.recurrence_rule_id) || [];
    list.push(t);
    tasksByRule.set(t.recurrence_rule_id, list);
  }

  const virtualTasks: TaskWithMeta[] = [];

  for (const rule of rules) {
    const seriesTasks = tasksByRule.get(rule.id);
    if (!seriesTasks || seriesTasks.length === 0) continue;

    // Pick template task: prefer active task (status not done or cancelled)
    let templateTask = seriesTasks.find((t) => t.status !== 'done' && t.status !== 'cancelled');
    if (!templateTask) {
      // Pick latest task
      templateTask = [...seriesTasks].sort((a, b) => {
        const idxA = a.occurrence_index || 0;
        const idxB = b.occurrence_index || 0;
        if (idxA !== idxB) return idxB - idxA;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })[0];
    }
    if (!templateTask) continue;

    // Filter by projectIds if requested
    if (options?.projectIds && options.projectIds.length > 0) {
      if (!templateTask.project_id || !options.projectIds.includes(templateTask.project_id)) {
        continue;
      }
    }

    // Filter by statuses if requested: virtual occurrences are 'todo'
    if (options?.statuses && options.statuses.length > 0) {
      if (!options.statuses.includes('todo')) {
        continue;
      }
    }

    // Collect stored occurrence slots for deduplication
    const storedIndices = new Set<number>();
    const storedTimestamps = new Set<number>();

    for (const st of seriesTasks) {
      if (st.occurrence_index) storedIndices.add(st.occurrence_index);
      if (st.scheduled_start) storedTimestamps.add(new Date(st.scheduled_start).getTime());
      if (st.due_date) storedTimestamps.add(new Date(st.due_date).getTime());
    }

    // Determine initial anchor
    const initialStart =
      rule.dtstart ||
      templateTask.scheduled_start ||
      templateTask.due_date ||
      templateTask.created_at;

    const ruleParams: RecurrenceRuleParams = {
      frequency: rule.frequency,
      interval: rule.interval,
      by_weekday: rule.by_weekday,
      by_monthday: rule.by_monthday,
      until_date: rule.until_date,
      count: rule.count,
      timezone: rule.timezone,
      dtstart: rule.dtstart,
    };

    const projected = projectOccurrencesInRange(
      ruleParams,
      initialStart,
      startIso,
      endIso,
      options?.maxOccurrencesPerRule ?? 100,
      {
        anchorDate: rule.dtstart || initialStart,
      }
    );

    for (const { date, occurrenceIndex } of projected) {
      const slotMs = date.getTime();

      // Real stored occurrence takes precedence over virtual occurrence!
      if (storedIndices.has(occurrenceIndex)) continue;
      if (storedTimestamps.has(slotMs)) continue;
      if (rule.count !== undefined && rule.count !== null && occurrenceIndex > rule.count) continue;

      let virtualScheduledStart: string | null = null;
      let virtualScheduledEnd: string | null = null;
      let virtualDueDate: string | null = null;

      if (templateTask.scheduled_start) {
        virtualScheduledStart = date.toISOString();
        if (templateTask.scheduled_end) {
          const durationMs =
            new Date(templateTask.scheduled_end).getTime() - new Date(templateTask.scheduled_start).getTime();
          virtualScheduledEnd = new Date(slotMs + Math.max(0, durationMs)).toISOString();
        }
        if (templateTask.due_date) {
          const dueOffsetMs =
            new Date(templateTask.due_date).getTime() - new Date(templateTask.scheduled_start).getTime();
          virtualDueDate = new Date(slotMs + dueOffsetMs).toISOString();
        }
      } else if (templateTask.due_date) {
        virtualScheduledStart = null;
        virtualScheduledEnd = null;
        virtualDueDate = date.toISOString();
      } else {
        virtualScheduledStart = date.toISOString();
        virtualScheduledEnd = null;
        virtualDueDate = null;
      }

      const virtualId = `virtual:${rule.id}:${occurrenceIndex}:${slotMs}`;

      virtualTasks.push({
        id: virtualId,
        workspace_id: workspaceId,
        parent_task_id: null,
        project_id: templateTask.project_id,
        milestone_id: templateTask.milestone_id,
        title: templateTask.title,
        description: templateTask.description,
        priority: templateTask.priority,
        status: 'todo',
        scheduled_start: virtualScheduledStart,
        scheduled_end: virtualScheduledEnd,
        due_date: virtualDueDate,
        estimated_duration_minutes: templateTask.estimated_duration_minutes,
        is_all_day: templateTask.is_all_day,
        completed_at: null,
        tags: templateTask.tags ? [...templateTask.tags] : [],
        recurrence_rule_id: rule.id,
        occurrence_index: occurrenceIndex,
        created_by: templateTask.created_by,
        assigned_to: templateTask.assigned_to,
        created_at: templateTask.created_at,
        updated_at: templateTask.updated_at,
        created_from: templateTask.created_from || 'tasks',
        subtask_count: 0,
        completed_subtask_count: 0,
        is_blocked: false,
        blocking_tasks: [],
        project: (templateTask as unknown as { projects?: { id: string; name: string; color: string | null } }).projects || null,
        is_virtual: true,
        original_task_id: templateTask.id,
      });
    }
  }

  return virtualTasks;
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
 * Validates that all foreign key references belong strictly to the target workspace.
 * Prevents cross-workspace data contamination, particularly when running under
 * privileged server-side clients that bypass database Row Level Security.
 */
async function validateTaskForeignKeys(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  keys: {
    projectId?: string | null;
    milestoneId?: string | null;
    parentTaskId?: string | null;
  },
  currentTaskId?: string
): Promise<void> {
  if (keys.projectId) {
    const { data: proj, error: projErr } = await supabase
      .from('projects')
      .select('id')
      .eq('id', keys.projectId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (projErr || !proj) {
      throw new Error(
        `Cross-workspace reference rejected: project ${keys.projectId} does not belong to workspace ${workspaceId}`
      );
    }
  }

  if (keys.milestoneId) {
    const { data: mile, error: mileErr } = await supabase
      .from('milestones')
      .select('id, project_id')
      .eq('id', keys.milestoneId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (mileErr || !mile) {
      throw new Error(
        `Cross-workspace reference rejected: milestone ${keys.milestoneId} does not belong to workspace ${workspaceId}`
      );
    }
    if (keys.projectId && mile.project_id && mile.project_id !== keys.projectId) {
      throw new Error(
        `Invalid milestone reference: milestone ${keys.milestoneId} does not belong to project ${keys.projectId}`
      );
    }
  }

  if (keys.parentTaskId) {
    if (currentTaskId && keys.parentTaskId === currentTaskId) {
      throw new Error('A task cannot be its own parent');
    }
    const { data: parent, error: parentErr } = await supabase
      .from('tasks')
      .select('id')
      .eq('id', keys.parentTaskId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (parentErr || !parent) {
      throw new Error(
        `Cross-workspace reference rejected: parent task ${keys.parentTaskId} does not belong to workspace ${workspaceId}`
      );
    }
  }
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

  // Authorize foreign keys against workspace
  await validateTaskForeignKeys(supabase, workspaceId, {
    projectId: validated.project_id,
    milestoneId: validated.milestone_id,
    parentTaskId: validated.parent_task_id,
  });

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
        dtstart: validated.scheduled_start || validated.due_date || new Date().toISOString(),
        total_occurrences_generated: 1,
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
      ...(validated.created_from ? { created_from: validated.created_from } : {}),
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
      occurrence_index: recurrenceRuleId ? 1 : 1,
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
 * If status is transitioning to done, delegates directly to completeTask to ensure
 * atomic completion and next-occurrence generation without bypassing recurrence.
 */
export async function updateTask(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  taskId: string,
  input: UpdateTaskInput,
  userId?: string
): Promise<TaskWithMeta> {
  const validated = updateTaskSchema.parse(input);

  // Authorize foreign keys against workspace
  await validateTaskForeignKeys(
    supabase,
    workspaceId,
    {
      projectId: validated.project_id,
      milestoneId: validated.milestone_id,
      parentTaskId: validated.parent_task_id,
    },
    taskId
  );

  // Authoritative lifecycle routing: If transitioning to done, route through completeTask
  if (validated.status === 'done') {
    // If other attributes were provided alongside status: 'done', update them first
    const { status: _status, ...otherUpdates } = validated;
    void _status;
    if (Object.keys(otherUpdates).length > 0) {
      await supabase
        .from('tasks')
        .update(otherUpdates)
        .eq('workspace_id', workspaceId)
        .eq('id', taskId);
    }
    const { completedTask } = await completeTask(supabase, workspaceId, taskId, userId);
    return completedTask;
  }

  const updates: Database['public']['Tables']['tasks']['Update'] = {
    ...validated,
  };

  // Safe reopening & status changes
  if (validated.status) {
    updates.completed_at = null;

    // Check if task was completed and is recurring
    const { data: current } = await supabase
      .from('tasks')
      .select('id, status, recurrence_rule_id')
      .eq('workspace_id', workspaceId)
      .eq('id', taskId)
      .single();

    if (current?.status === 'done' && current?.recurrence_rule_id) {
      // If an active occurrence already exists in the workspace for this recurrence rule,
      // detach recurrence_rule_id to avoid corrupting the series or violating uq_active_task_per_recurrence
      const { data: activeExisting } = await supabase
        .from('tasks')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('recurrence_rule_id', current.recurrence_rule_id)
        .neq('id', taskId)
        .not('status', 'in', '("done","cancelled")')
        .limit(1)
        .maybeSingle();

      if (activeExisting) {
        updates.recurrence_rule_id = null;
      }
    }
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
 * Utilizes complete_task_transactional RPC with database row locking, dependency verification,
 * idempotency protection, skip-slot scheduling for late completions, and subtask template cloning.
 */
export async function completeTask(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  taskId: string,
  userId?: string
): Promise<{ completedTask: TaskWithMeta; nextOccurrence: TaskWithMeta | null }> {
  // 1. Fetch current task
  const { data: current, error: fetchErr } = await supabase
    .from('tasks')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', taskId)
    .single();

  if (fetchErr || !current) {
    throw new Error(`Task not found: ${fetchErr?.message || 'Task does not exist in this workspace'}`);
  }

  // 2. Check for cancelled status
  if (current.status === 'cancelled') {
    throw new Error(`Cannot complete a cancelled task: ${taskId}`);
  }

  // 3. Verify prerequisite dependencies
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

  // 4. Idempotent check: if already completed, return without generating duplicate occurrences
  if (current.status === 'done') {
    let nextOcc: TaskWithMeta | null = null;
    if (current.recurrence_rule_id) {
      const { data: activeExisting } = await supabase
        .from('tasks')
        .select(`
          *,
          projects (id, name, color)
        `)
        .eq('workspace_id', workspaceId)
        .eq('recurrence_rule_id', current.recurrence_rule_id)
        .neq('id', taskId)
        .not('status', 'in', '("done","cancelled")')
        .limit(1)
        .maybeSingle();

      if (activeExisting) {
        nextOcc = {
          ...activeExisting,
          subtask_count: 0,
          completed_subtask_count: 0,
          is_blocked: false,
          blocking_tasks: [],
          project: (activeExisting as unknown as { projects?: { id: string; name: string; color: string | null } }).projects || null,
        };
      }
    }

    return {
      completedTask: {
        ...current,
        subtask_count: 0,
        completed_subtask_count: 0,
        is_blocked: false,
        blocking_tasks: [],
        project: (current as unknown as { projects?: { id: string; name: string; color: string | null } }).projects || null,
      },
      nextOccurrence: nextOcc,
    };
  }

  // 5. If recurring, calculate canonical next occurrence
  const nowIso = new Date().toISOString();
  let nextScheduledStart: string | null = null;
  let nextScheduledEnd: string | null = null;
  let nextDueDate: string | null = null;
  let nextOccurrenceIndex = 1;
  let shouldCreateNext = false;

  if (current.recurrence_rule_id) {
    const { data: rule } = await supabase
      .from('recurrence_rules')
      .select('*')
      .eq('id', current.recurrence_rule_id)
      .single();

    if (rule) {
      const referenceTime = current.scheduled_start || current.due_date || current.created_at || nowIso;
      const anchorDate = rule.dtstart || referenceTime;
      const currentIdx = current.occurrence_index || 1;

      // Check if task is completed late: skip missed slots without building overdue backlog
      const isLate = new Date(nowIso).getTime() > new Date(referenceTime).getTime();
      let nextSlotResult: { nextSlot: Date; nextOccurrenceIndex: number; skippedSlots: number } | null = null;

      if (isLate) {
        nextSlotResult = calculateNextUpcomingSlot(
          rule as RecurrenceRuleParams,
          referenceTime,
          nowIso,
          {
            occurrenceIndex: currentIdx,
            anchorDate,
            timeZoneOverride: rule.timezone,
          }
        );
      } else {
        const nextSlotDate = calculateNextOccurrence(
          rule as RecurrenceRuleParams,
          referenceTime,
          {
            occurrenceIndex: currentIdx,
            anchorDate,
            timeZoneOverride: rule.timezone,
          }
        );
        if (nextSlotDate) {
          nextSlotResult = {
            nextSlot: nextSlotDate,
            nextOccurrenceIndex: currentIdx + 1,
            skippedSlots: 0,
          };
        }
      }

      if (nextSlotResult) {
        shouldCreateNext = true;
        nextOccurrenceIndex = nextSlotResult.nextOccurrenceIndex;
        const nextStart = nextSlotResult.nextSlot;

        if (current.scheduled_start) {
          nextScheduledStart = nextStart.toISOString();
          if (current.scheduled_end) {
            const durationMs = new Date(current.scheduled_end).getTime() - new Date(current.scheduled_start).getTime();
            nextScheduledEnd = new Date(nextStart.getTime() + Math.max(0, durationMs)).toISOString();
          }
        }

        if (current.due_date) {
          if (current.scheduled_start) {
            const dueOffsetMs = new Date(current.due_date).getTime() - new Date(current.scheduled_start).getTime();
            nextDueDate = new Date(nextStart.getTime() + dueOffsetMs).toISOString();
          } else {
            nextDueDate = nextStart.toISOString();
          }
        }
      }
    }
  }

  // 6. Execute atomic completion via RPC with fallback
  let rpcSuccess = false;
  let rpcResult: { next_task_id?: string | null } | null = null;

  if (typeof supabase.rpc === 'function') {
    try {
      const { data, error: rpcErr } = await supabase.rpc('complete_task_transactional', {
        p_task_id: taskId,
        p_workspace_id: workspaceId,
        p_completed_by: userId || null,
        p_next_scheduled_start: shouldCreateNext ? nextScheduledStart : null,
        p_next_scheduled_end: shouldCreateNext ? nextScheduledEnd : null,
        p_next_due_date: shouldCreateNext ? nextDueDate : null,
        p_next_occurrence_index: nextOccurrenceIndex,
        p_now: nowIso,
      });

      if (rpcErr) {
        if (rpcErr.code === 'PGRST202' || rpcErr.code === '42883') {
          // RPC missing from schema cache, fall back to application-level atomic execution
          rpcSuccess = false;
        } else {
          throw new Error(`Failed to complete task: ${rpcErr.message}`);
        }
      } else {
        rpcSuccess = true;
        rpcResult = data as { next_task_id?: string | null };
      }
    } catch (rpcEx) {
      if ((rpcEx as Error).message.includes('Failed to complete task:')) {
        throw rpcEx;
      }
      rpcSuccess = false;
    }
  }

  if (rpcSuccess && rpcResult) {
    const completedTask = await getTaskById(supabase, workspaceId, taskId);
    const nextOccurrence = rpcResult.next_task_id
      ? await getTaskById(supabase, workspaceId, rpcResult.next_task_id)
      : null;

    return {
      completedTask: completedTask || {
        ...current,
        status: 'done',
        completed_at: nowIso,
        subtask_count: 0,
        completed_subtask_count: 0,
        is_blocked: false,
        blocking_tasks: [],
        project: null,
      },
      nextOccurrence,
    };
  }

  // Application fallback (when RPC is not deployed in test environment or mock)
  const { data: completed, error: completeErr } = await supabase
    .from('tasks')
    .update({
      status: 'done',
      completed_at: nowIso,
    })
    .eq('workspace_id', workspaceId)
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

  if (shouldCreateNext && current.recurrence_rule_id) {
    // Check if an active occurrence already exists
    const { data: activeExisting } = await supabase
      .from('tasks')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('recurrence_rule_id', current.recurrence_rule_id)
      .neq('id', taskId)
      .not('status', 'in', '("done","cancelled")')
      .limit(1)
      .maybeSingle();

    if (!activeExisting) {
      const { data: nextCreated, error: createErr } = await supabase
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          ...(current.created_from ? { created_from: current.created_from } : {}),
          title: current.title,
          description: current.description,
          priority: current.priority,
          status: 'todo',
          scheduled_start: nextScheduledStart,
          scheduled_end: nextScheduledEnd,
          due_date: nextDueDate,
          is_all_day: current.is_all_day,
          estimated_duration_minutes: current.estimated_duration_minutes,
          project_id: current.project_id,
          milestone_id: current.milestone_id,
          tags: current.tags,
          recurrence_rule_id: current.recurrence_rule_id,
          occurrence_index: nextOccurrenceIndex,
          created_by: userId || current.created_by,
        })
        .select(`
          *,
          projects (id, name, color)
        `)
        .single();

      if (createErr) {
        if (createErr.code === '23505') {
          // Concurrency collision: another transaction already created the next active occurrence
          const { data: existingActive } = await supabase
            .from('tasks')
            .select('id')
            .eq('workspace_id', workspaceId)
            .eq('recurrence_rule_id', current.recurrence_rule_id)
            .not('status', 'in', '("done","cancelled")')
            .limit(1)
            .maybeSingle();

          if (existingActive) {
            nextOccurrence = await getTaskById(supabase, workspaceId, existingActive.id);
          }
        } else {
          throw new Error(`Failed to create next occurrence: ${createErr.message}`);
        }
      } else if (nextCreated) {
        // Clone subtask template: fresh incomplete subtasks
        const { data: subtasks } = await supabase
          .from('tasks')
          .select('title, description, priority, is_all_day, estimated_duration_minutes, project_id, milestone_id, tags')
          .eq('workspace_id', workspaceId)
          .eq('parent_task_id', taskId)
          .order('created_at', { ascending: true });

        if (subtasks && subtasks.length > 0) {
          const subtaskInserts = subtasks.map((st) => ({
            workspace_id: workspaceId,
            parent_task_id: nextCreated.id,
            created_from: current.created_from || 'tasks',
            title: st.title,
            description: st.description,
            priority: st.priority,
            status: 'todo' as TaskStatus,
            is_all_day: st.is_all_day,
            estimated_duration_minutes: st.estimated_duration_minutes,
            project_id: st.project_id,
            milestone_id: st.milestone_id,
            tags: st.tags || [],
            recurrence_rule_id: null,
            created_by: userId || current.created_by,
          }));
          await supabase.from('tasks').insert(subtaskInserts);
        }

        // Update total_occurrences_generated on recurrence_rules
        await supabase
          .from('recurrence_rules')
          .update({
            total_occurrences_generated: nextOccurrenceIndex,
            updated_at: nowIso,
          })
          .eq('id', current.recurrence_rule_id);

        nextOccurrence = {
          ...nextCreated,
          subtask_count: subtasks?.length || 0,
          completed_subtask_count: 0,
          is_blocked: false,
          blocking_tasks: [],
          project: (nextCreated as unknown as { projects?: { id: string; name: string; color: string | null } }).projects || null,
        };
      }
    } else {
      nextOccurrence = await getTaskById(supabase, workspaceId, activeExisting.id);
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
 * Skips a single occurrence of a recurring task by marking the current occurrence as cancelled
 * and immediately advancing the schedule to the next occurrence.
 * If the task is non-recurring, it behaves identically to cancelTask.
 */
export async function skipTaskOccurrence(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  taskId: string,
  userId?: string
): Promise<{ cancelledTask: TaskWithMeta; nextOccurrence: TaskWithMeta | null }> {
  // 1. Fetch current task
  const { data: current, error: fetchErr } = await supabase
    .from('tasks')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', taskId)
    .single();

  if (fetchErr || !current) {
    throw new Error(`Task not found: ${fetchErr?.message || 'Task does not exist in this workspace'}`);
  }

  if (current.status === 'done') {
    throw new Error(`Cannot skip an already completed task: ${taskId}`);
  }

  // 2. Mark current task cancelled
  const nowIso = new Date().toISOString();
  const { data: cancelled, error: cancelErr } = await supabase
    .from('tasks')
    .update({
      status: 'cancelled',
      completed_at: null,
      updated_at: nowIso,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', taskId)
    .select(`
      *,
      projects (id, name, color)
    `)
    .single();

  if (cancelErr || !cancelled) {
    throw new Error(`Failed to skip task: ${cancelErr?.message}`);
  }

  let nextOccurrence: TaskWithMeta | null = null;

  // 3. If recurring, provision the next occurrence
  if (current.recurrence_rule_id) {
    const { data: rule } = await supabase
      .from('recurrence_rules')
      .select('*')
      .eq('id', current.recurrence_rule_id)
      .single();

    if (rule) {
      const referenceTime = current.scheduled_start || current.due_date || current.created_at || nowIso;
      const anchorDate = rule.dtstart || referenceTime;
      const currentIdx = current.occurrence_index || 1;

      // Skipping this occurrence: calculate next slot
      const nextSlotDate = calculateNextOccurrence(
        rule as RecurrenceRuleParams,
        referenceTime,
        {
          occurrenceIndex: currentIdx,
          anchorDate,
          timeZoneOverride: rule.timezone,
        }
      );

      if (nextSlotDate) {
        const nextOccurrenceIndex = currentIdx + 1;
        let nextScheduledStart: string | null = null;
        let nextScheduledEnd: string | null = null;
        let nextDueDate: string | null = null;

        if (current.scheduled_start) {
          nextScheduledStart = nextSlotDate.toISOString();
          if (current.scheduled_end) {
            const durationMs = new Date(current.scheduled_end).getTime() - new Date(current.scheduled_start).getTime();
            nextScheduledEnd = new Date(nextSlotDate.getTime() + Math.max(0, durationMs)).toISOString();
          }
        }

        if (current.due_date) {
          if (current.scheduled_start) {
            const dueOffsetMs = new Date(current.due_date).getTime() - new Date(current.scheduled_start).getTime();
            nextDueDate = new Date(nextSlotDate.getTime() + dueOffsetMs).toISOString();
          } else {
            nextDueDate = nextSlotDate.toISOString();
          }
        }

        // Insert next occurrence
        const { data: nextCreated } = await supabase
          .from('tasks')
          .insert({
            workspace_id: workspaceId,
            ...(current.created_from ? { created_from: current.created_from } : {}),
            title: current.title,
            description: current.description,
            priority: current.priority,
            status: 'todo',
            scheduled_start: nextScheduledStart,
            scheduled_end: nextScheduledEnd,
            due_date: nextDueDate,
            is_all_day: current.is_all_day,
            estimated_duration_minutes: current.estimated_duration_minutes,
            project_id: current.project_id,
            milestone_id: current.milestone_id,
            tags: current.tags,
            recurrence_rule_id: current.recurrence_rule_id,
            occurrence_index: nextOccurrenceIndex,
            created_by: userId || current.created_by,
          })
          .select(`
            *,
            projects (id, name, color)
          `)
          .single();

        if (nextCreated) {
          // Clone subtask template
          const { data: subtasks } = await supabase
            .from('tasks')
            .select('title, description, priority, is_all_day, estimated_duration_minutes, project_id, milestone_id, tags')
            .eq('workspace_id', workspaceId)
            .eq('parent_task_id', taskId)
            .order('created_at', { ascending: true });

          if (subtasks && subtasks.length > 0) {
            const subtaskInserts = subtasks.map((st) => ({
              workspace_id: workspaceId,
              parent_task_id: nextCreated.id,
              created_from: current.created_from || 'tasks',
              title: st.title,
              description: st.description,
              priority: st.priority,
              status: 'todo' as TaskStatus,
              is_all_day: st.is_all_day,
              estimated_duration_minutes: st.estimated_duration_minutes,
              project_id: st.project_id,
              milestone_id: st.milestone_id,
              tags: st.tags || [],
              recurrence_rule_id: null,
              created_by: userId || current.created_by,
            }));
            await supabase.from('tasks').insert(subtaskInserts);
          }

          // Update recurrence_rules
          await supabase
            .from('recurrence_rules')
            .update({
              total_occurrences_generated: nextOccurrenceIndex,
              updated_at: nowIso,
            })
            .eq('id', current.recurrence_rule_id);

          nextOccurrence = {
            ...nextCreated,
            subtask_count: subtasks?.length || 0,
            completed_subtask_count: 0,
            is_blocked: false,
            blocking_tasks: [],
            project: (nextCreated as unknown as { projects?: { id: string; name: string; color: string | null } }).projects || null,
          };
        }
      }
    }
  }

  return {
    cancelledTask: {
      ...cancelled,
      subtask_count: 0,
      completed_subtask_count: 0,
      is_blocked: false,
      blocking_tasks: [],
      project: (cancelled as unknown as { projects?: { id: string; name: string; color: string | null } }).projects || null,
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
