-- Migration: 20261111000001_recurrence_engine_hardening.sql
-- Description: Adds recurrence series anchor dtstart, occurrence index tracking, and partial unique index
--              enforcing single active occurrence invariant per recurrence rule.
BEGIN;

-- 1. Add dtstart and total_occurrences_generated to recurrence_rules
ALTER TABLE public.recurrence_rules
ADD COLUMN IF NOT EXISTS dtstart TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS total_occurrences_generated INTEGER NOT NULL DEFAULT 1;

-- 2. Add occurrence_index to tasks table
ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS occurrence_index INTEGER NOT NULL DEFAULT 1;

-- 3. Resolve legacy duplicate active occurrences before index creation (keep newest, cancel older)
WITH ranked_active AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY workspace_id, recurrence_rule_id
               ORDER BY updated_at DESC, created_at DESC
           ) AS rn
    FROM public.tasks
    WHERE recurrence_rule_id IS NOT NULL
      AND status NOT IN ('done', 'cancelled')
)
UPDATE public.tasks
SET status = 'cancelled'
WHERE id IN (
    SELECT id FROM ranked_active WHERE rn > 1
);

-- 4. Create partial unique index ensuring exactly one active task per recurrence rule in a workspace
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_task_per_recurrence
ON public.tasks (workspace_id, recurrence_rule_id)
WHERE recurrence_rule_id IS NOT NULL AND status NOT IN ('done', 'cancelled');

-- 5. Backfill dtstart for legacy recurrence rules from earliest associated task or created_at
UPDATE public.recurrence_rules r
SET dtstart = COALESCE(
    (SELECT MIN(t.scheduled_start) FROM public.tasks t WHERE t.recurrence_rule_id = r.id),
    (SELECT MIN(t.due_date) FROM public.tasks t WHERE t.recurrence_rule_id = r.id),
    r.created_at
)
WHERE r.dtstart IS NULL;

-- 6. Backfill by_monthday for monthly rules lacking explicit monthday
UPDATE public.recurrence_rules r
SET by_monthday = ARRAY[EXTRACT(DAY FROM COALESCE(r.dtstart, r.created_at))::INTEGER]
WHERE r.frequency = 'monthly'
  AND (r.by_monthday IS NULL OR array_length(r.by_monthday, 1) = 0);

COMMIT;
