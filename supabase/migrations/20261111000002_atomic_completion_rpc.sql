-- Migration: 20261111000002_atomic_completion_rpc.sql
-- Description: Adds atomic task completion and occurrence lifecycle RPC complete_task_transactional
--              with row locking, idempotency check, dependency verification, and subtask inheritance.

CREATE OR REPLACE FUNCTION public.complete_task_transactional(
    p_task_id UUID,
    p_workspace_id UUID,
    p_completed_by UUID DEFAULT NULL,
    p_next_scheduled_start TIMESTAMPTZ DEFAULT NULL,
    p_next_scheduled_end TIMESTAMPTZ DEFAULT NULL,
    p_next_due_date TIMESTAMPTZ DEFAULT NULL,
    p_next_occurrence_index INTEGER DEFAULT 1,
    p_now TIMESTAMPTZ DEFAULT pg_catalog.now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_task public.tasks%ROWTYPE;
    v_existing_active_id UUID;
    v_next_task_id UUID := NULL;
    v_subtask RECORD;
    v_unresolved_deps TEXT[];
BEGIN
    IF p_now IS NULL THEN
        p_now := pg_catalog.clock_timestamp();
    END IF;

    -- Security Check: Validate workspace authorization if called by an authenticated user
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_workspace_member(p_workspace_id, 'member') THEN
            RAISE EXCEPTION 'Access denied: not an authorized member of workspace %', p_workspace_id;
        END IF;
    END IF;

    -- Lock target task row for atomic completion
    SELECT *
    INTO v_task
    FROM public.tasks
    WHERE id = p_task_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task % not found in workspace %', p_task_id, p_workspace_id;
    END IF;

    -- Idempotent check: if already completed, return existing status without generating duplicates
    IF v_task.status = 'done' THEN
        IF v_task.recurrence_rule_id IS NOT NULL THEN
            SELECT id INTO v_existing_active_id
            FROM public.tasks
            WHERE workspace_id = p_workspace_id
              AND recurrence_rule_id = v_task.recurrence_rule_id
              AND status NOT IN ('done', 'cancelled')
            LIMIT 1;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'already_completed', true,
            'completed_task_id', v_task.id,
            'next_task_id', v_existing_active_id
        );
    END IF;

    -- Check for cancellation
    IF v_task.status = 'cancelled' THEN
        RAISE EXCEPTION 'Cannot complete a cancelled task: %', p_task_id;
    END IF;

    -- Verify prerequisite dependencies
    SELECT array_agg(t.title)
    INTO v_unresolved_deps
    FROM public.task_dependencies td
    JOIN public.tasks t ON t.id = td.depends_on_task_id
    WHERE td.workspace_id = p_workspace_id
      AND td.task_id = p_task_id
      AND t.status != 'done';

    IF v_unresolved_deps IS NOT NULL AND array_length(v_unresolved_deps, 1) > 0 THEN
        RAISE EXCEPTION 'Cannot complete task while prerequisite dependencies are incomplete: %',
            array_to_string(v_unresolved_deps, ', ');
    END IF;

    -- Check if an active occurrence already exists for this recurrence rule (concurrency guard)
    IF v_task.recurrence_rule_id IS NOT NULL THEN
        SELECT id INTO v_existing_active_id
        FROM public.tasks
        WHERE workspace_id = p_workspace_id
          AND recurrence_rule_id = v_task.recurrence_rule_id
          AND id != p_task_id
          AND status NOT IN ('done', 'cancelled')
        FOR UPDATE;
    END IF;

    -- Atomically mark current task as completed
    UPDATE public.tasks
    SET status = 'done',
        completed_at = p_now,
        updated_at = p_now
    WHERE id = p_task_id
    RETURNING * INTO v_task;

    -- Provision next occurrence if recurring, next date provided, and no active occurrence exists
    IF v_task.recurrence_rule_id IS NOT NULL AND (p_next_scheduled_start IS NOT NULL OR p_next_due_date IS NOT NULL) AND v_existing_active_id IS NULL THEN
        INSERT INTO public.tasks (
            workspace_id,
            created_from,
            title,
            description,
            priority,
            status,
            scheduled_start,
            scheduled_end,
            due_date,
            is_all_day,
            estimated_duration_minutes,
            project_id,
            milestone_id,
            tags,
            recurrence_rule_id,
            occurrence_index,
            created_by
        ) VALUES (
            p_workspace_id,
            v_task.created_from,
            v_task.title,
            v_task.description,
            v_task.priority,
            'todo',
            p_next_scheduled_start,
            p_next_scheduled_end,
            p_next_due_date,
            v_task.is_all_day,
            v_task.estimated_duration_minutes,
            v_task.project_id,
            v_task.milestone_id,
            v_task.tags,
            v_task.recurrence_rule_id,
            p_next_occurrence_index,
            COALESCE(p_completed_by, v_task.created_by)
        )
        RETURNING id INTO v_next_task_id;

        -- Clone direct subtasks of completed task into fresh incomplete subtasks
        FOR v_subtask IN
            SELECT title, description, priority, is_all_day, estimated_duration_minutes, project_id, milestone_id, tags
            FROM public.tasks
            WHERE parent_task_id = p_task_id
              AND workspace_id = p_workspace_id
            ORDER BY created_at ASC
        LOOP
            INSERT INTO public.tasks (
                workspace_id,
                parent_task_id,
                created_from,
                title,
                description,
                priority,
                status,
                is_all_day,
                estimated_duration_minutes,
                project_id,
                milestone_id,
                tags,
                recurrence_rule_id,
                created_by
            ) VALUES (
                p_workspace_id,
                v_next_task_id,
                v_task.created_from,
                v_subtask.title,
                v_subtask.description,
                v_subtask.priority,
                'todo',
                v_subtask.is_all_day,
                v_subtask.estimated_duration_minutes,
                v_subtask.project_id,
                v_subtask.milestone_id,
                v_subtask.tags,
                NULL,
                COALESCE(p_completed_by, v_task.created_by)
            );
        END LOOP;

        -- Update total_occurrences_generated on recurrence_rules
        UPDATE public.recurrence_rules
        SET total_occurrences_generated = GREATEST(total_occurrences_generated, p_next_occurrence_index),
            updated_at = p_now
        WHERE id = v_task.recurrence_rule_id;
    ELSIF v_existing_active_id IS NOT NULL THEN
        v_next_task_id := v_existing_active_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'already_completed', false,
        'completed_task_id', v_task.id,
        'next_task_id', v_next_task_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_task_transactional(
    UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TIMESTAMPTZ
) TO authenticated, service_role;
