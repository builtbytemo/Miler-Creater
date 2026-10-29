-- ==============================================================================
-- Migration: 20261028000004_fix_audit_event_lifecycle.sql
-- Description:
--   1. Historical Redaction: Removes plaintext user_email from existing
--      workspace.auto_provisioned audit event details via an atomic trigger-bypass.
--   2. Workspace Disassociation: Makes audit_events.workspace_id nullable and
--      updates the foreign-key constraint to ON DELETE SET NULL.
--   3. Immutability Trigger: Updates prevent_audit_mutation() to narrowly permit
--      the foreign-key disassociation cascade (workspace_id transitioning to NULL
--      when the workspace row is deleted) while rejecting all other UPDATE and DELETE
--      operations across all roles.
--   4. Signup Provisioning Update: Updates handle_new_user_provisioning() to store
--      non-PII operational metadata instead of plaintext user_email in details.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. HISTORICAL AUDIT EVENT REDACTION
-- ------------------------------------------------------------------------------
-- Safely disable the immutability trigger within this atomic transaction to redact
-- plaintext user_email from existing auto-provisioning audit events.
ALTER TABLE public.audit_events DISABLE TRIGGER trg_audit_events_immutable;

UPDATE public.audit_events
SET details = (details - 'user_email') || jsonb_build_object('event_source', 'auth.signup', 'actor_role', 'owner')
WHERE event_type = 'workspace.auto_provisioned'
  AND details ? 'user_email';

-- Re-enable the immutability trigger immediately following historical redaction.
ALTER TABLE public.audit_events ENABLE TRIGGER trg_audit_events_immutable;

-- ------------------------------------------------------------------------------
-- 2. WORKSPACE DISASSOCIATION (NULLABLE WORKSPACE_ID & ON DELETE SET NULL)
-- ------------------------------------------------------------------------------
-- Drop the original NOT NULL constraint and CASCADE foreign key.
ALTER TABLE public.audit_events
    DROP CONSTRAINT IF EXISTS audit_events_workspace_id_fkey;

ALTER TABLE public.audit_events
    ALTER COLUMN workspace_id DROP NOT NULL;

ALTER TABLE public.audit_events
    ADD CONSTRAINT audit_events_workspace_id_fkey
    FOREIGN KEY (workspace_id)
    REFERENCES public.workspaces(id)
    ON DELETE SET NULL;

-- ------------------------------------------------------------------------------
-- 3. UPDATED IMMUTABILITY TRIGGER FUNCTION
-- ------------------------------------------------------------------------------
-- Allow foreign-key cascade to set workspace_id to NULL when the referenced
-- workspace is deleted from public.workspaces, but unconditionally reject any
-- other modification or deletion.
CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Only permit UPDATE under the exact condition of a foreign-key cascade setting
    -- workspace_id to NULL after the referenced workspace has been deleted from public.workspaces.
    IF TG_OP = 'UPDATE' THEN
        IF OLD.workspace_id IS NOT NULL
           AND NEW.workspace_id IS NULL
           AND NEW.id = OLD.id
           AND NEW.actor_type = OLD.actor_type
           AND NEW.actor_id = OLD.actor_id
           AND NEW.event_type = OLD.event_type
           AND NEW.entity_type = OLD.entity_type
           AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
           AND NEW.details = OLD.details
           AND NEW.ip_address IS NOT DISTINCT FROM OLD.ip_address
           AND NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent
           AND NEW.created_at = OLD.created_at
           AND NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id)
        THEN
            RETURN NEW;
        END IF;
    END IF;

    -- All other UPDATE operations and all DELETE operations are unconditionally rejected
    RAISE EXCEPTION 'Audit events are immutable and cannot be updated or deleted.';
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. SIGNUP PROVISIONING TRIGGER FUNCTION (PII REDACTION FOR FUTURE USERS)
-- ------------------------------------------------------------------------------
-- Replaces handle_new_user_provisioning() with identical profile, workspace,
-- membership, and timezone logic, but without storing NEW.email in audit_events.details.
CREATE OR REPLACE FUNCTION public.handle_new_user_provisioning()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    new_workspace_id UUID;
    user_name TEXT;
    user_slug TEXT;
BEGIN
    user_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
    user_slug := lower(regexp_replace(user_name, '[^a-zA-Z0-9]', '-', 'g')) || '-' || substr(NEW.id::text, 1, 8);

    -- 1. Create profile with approved Asia/Cairo default
    INSERT INTO public.profiles (id, email, full_name, avatar_url, timezone)
    VALUES (
        NEW.id,
        NEW.email,
        user_name,
        NEW.raw_user_meta_data->>'avatar_url',
        COALESCE(NEW.raw_user_meta_data->>'timezone', 'Asia/Cairo')
    );

    -- 2. Create default personal workspace
    INSERT INTO public.workspaces (name, slug, owner_id)
    VALUES (
        user_name || '''s Workspace',
        user_slug,
        NEW.id
    )
    RETURNING id INTO new_workspace_id;

    -- 3. Add user as owner in workspace_members
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (
        new_workspace_id,
        NEW.id,
        'owner'
    );

    -- 4. Record audit event (Operational non-PII metadata)
    INSERT INTO public.audit_events (workspace_id, actor_type, actor_id, event_type, entity_type, entity_id, details)
    VALUES (
        new_workspace_id,
        'system',
        NEW.id::text,
        'workspace.auto_provisioned',
        'workspace',
        new_workspace_id,
        jsonb_build_object('event_source', 'auth.signup', 'actor_role', 'owner')
    );

    RETURN NEW;
END;
$$;

COMMIT;
