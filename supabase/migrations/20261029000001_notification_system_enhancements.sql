-- ==============================================================================
-- Migration: 20261029000001_notification_system_enhancements.sql
-- Description:
--   1. Enhances public.notifications with read_at timestamp tracking and
--      nullable idempotency_key for deterministic deduplication.
--   2. Adds unique index on (workspace_id, recipient_id, idempotency_key).
--   3. Adds performance index on (recipient_id, read_at) for fast unread count queries.
--   4. Creates protect_notification_fields() trigger to prevent tampering with
--      core notification fields (recipient, workspace, title, message, entity)
--      during read-state or lifecycle status updates.
--   5. Creates public.notification_preferences table with strict user-level
--      and workspace-isolated Row Level Security (RLS) policies.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. NOTIFICATIONS TABLE ENHANCEMENTS
-- ------------------------------------------------------------------------------

-- Add read_at timestamp to track when an in-app notification was viewed/read
ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- Add idempotency_key for deterministic reminder and alert deduplication
ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Enforce strict deduplication: the same idempotency key cannot be issued multiple
-- times to the same recipient in the same workspace.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_idempotency
    ON public.notifications(workspace_id, recipient_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- High-performance partial index for unread count queries and active inbox filtering
CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON public.notifications(recipient_id, read_at)
    WHERE status != 'dismissed';

-- ------------------------------------------------------------------------------
-- 2. NOTIFICATION FIELD IMMUTABILITY & TAMPERING PROTECTION
-- ------------------------------------------------------------------------------

-- Prevent recipients from modifying core notification attributes when updating read state or status.
CREATE OR REPLACE FUNCTION public.protect_notification_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Core identification, routing, and message content cannot be altered on update
    IF NEW.id <> OLD.id OR
       NEW.workspace_id <> OLD.workspace_id OR
       NEW.recipient_id <> OLD.recipient_id OR
       NEW.channel <> OLD.channel OR
       NEW.title <> OLD.title OR
       NEW.message <> OLD.message OR
       NEW.entity_type IS DISTINCT FROM OLD.entity_type OR
       NEW.entity_id IS DISTINCT FROM OLD.entity_id OR
       NEW.scheduled_for <> OLD.scheduled_for OR
       NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
       NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Notification content, recipient, and workspace are immutable. Only read_at, delivered_at, and status may be modified.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_protect_fields ON public.notifications;
CREATE TRIGGER trg_notifications_protect_fields
    BEFORE UPDATE ON public.notifications
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_notification_fields();

-- ------------------------------------------------------------------------------
-- 3. NOTIFICATION PREFERENCES TABLE
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    notify_upcoming_tasks BOOLEAN NOT NULL DEFAULT true,
    notify_overdue_tasks BOOLEAN NOT NULL DEFAULT true,
    notify_upcoming_content BOOLEAN NOT NULL DEFAULT true,
    notify_status_changes BOOLEAN NOT NULL DEFAULT true,
    reminder_lead_minutes INTEGER NOT NULL DEFAULT 60 CHECK (reminder_lead_minutes >= 0 AND reminder_lead_minutes <= 10080),
    email_notifications_enabled BOOLEAN NOT NULL DEFAULT false,
    in_app_notifications_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_notification_preferences_user_workspace UNIQUE (workspace_id, user_id)
);

-- Index for rapid lookup by user and workspace
CREATE INDEX IF NOT EXISTS idx_notif_pref_user_ws
    ON public.notification_preferences(user_id, workspace_id);

-- Enforce updated_at timestamp updates
DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER trg_notification_preferences_updated_at
    BEFORE UPDATE ON public.notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- Enforce workspace immutability
DROP TRIGGER IF EXISTS trg_notification_preferences_immutable_ws ON public.notification_preferences;
CREATE TRIGGER trg_notification_preferences_immutable_ws
    BEFORE UPDATE ON public.notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_workspace_change();

-- ------------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) FOR NOTIFICATION PREFERENCES
-- ------------------------------------------------------------------------------

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Preferences are strictly private: a user can only query their own preferences
-- within a workspace where they hold at least viewer membership.
CREATE POLICY "notification_preferences_select_owner" ON public.notification_preferences
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id, 'viewer'));

-- Only the owning user may initialize their preference record in an authorized workspace.
CREATE POLICY "notification_preferences_insert_owner" ON public.notification_preferences
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() AND public.is_workspace_member(workspace_id, 'viewer'));

-- Only the owning user may modify their preference record in an authorized workspace.
CREATE POLICY "notification_preferences_update_owner" ON public.notification_preferences
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id, 'viewer'))
    WITH CHECK (user_id = auth.uid() AND public.is_workspace_member(workspace_id, 'viewer'));

-- Only the owning user may delete their preference record.
CREATE POLICY "notification_preferences_delete_owner" ON public.notification_preferences
    FOR DELETE TO authenticated
    USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id, 'viewer'));

COMMIT;
