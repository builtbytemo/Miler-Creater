-- ==============================================================================
-- Migration: 20261028000002_task_engine_enhancements.sql
-- Description: Adds all-day scheduling support and completed_at timestamp tracking
--              to tasks table, plus supporting indexes for recurrence and history.
-- ==============================================================================

-- 1. Add is_all_day and completed_at columns to tasks
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS is_all_day BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- 2. Performance indexes for task querying and recurrence tracking
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at 
    ON public.tasks(workspace_id, completed_at) 
    WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_recurrence 
    ON public.tasks(recurrence_rule_id) 
    WHERE recurrence_rule_id IS NOT NULL;
