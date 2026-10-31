-- ==============================================================================
-- Migration: 20261029000002_fix_workspace_cascade_deletion.sql
-- Description: Allow workspace cascade deletion while preserving strict protection
--              against removing the workspace owner while the workspace exists.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. UPDATE BEFORE TRIGGER ON workspace_members (INSERT / UPDATE ONLY)
-- ------------------------------------------------------------------------------
-- Retains strict 1:1 owner invariant and assignment permissions established in
-- Migration 3 (20261028000003_fix_workspace_owner_provisioning.sql), while
-- delegating DELETE operations to a dedicated deferred constraint trigger.

CREATE OR REPLACE FUNCTION public.protect_workspace_members()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    ws_owner UUID;
BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        IF NEW.role = 'owner' THEN
            SELECT owner_id INTO ws_owner FROM public.workspaces WHERE id = NEW.workspace_id;

            -- Invariant 1: Only the user whose ID matches workspaces.owner_id may hold the owner role.
            -- This allows initial Auth provisioning (where NEW.user_id = ws_owner and auth.uid() is NULL)
            -- while strictly preventing any non-owner user from ever holding the owner role.
            IF NEW.user_id <> ws_owner THEN
                RAISE EXCEPTION 'Only the workspace owner can hold the owner role.';
            END IF;

            -- Invariant 2: When an authenticated session performs the operation, the actor must be the workspace owner.
            IF auth.uid() IS NOT NULL AND auth.uid() <> ws_owner THEN
                RAISE EXCEPTION 'Only the workspace owner can assign or hold the owner role.';
            END IF;
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- DELETE enforcement is handled by public.protect_workspace_members_delete()
        -- via trg_workspace_members_protect_owner_delete (AFTER DELETE CONSTRAINT TRIGGER).
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_members_owner_guard ON public.workspace_members;

CREATE TRIGGER trg_members_owner_guard
    BEFORE INSERT OR UPDATE ON public.workspace_members
    FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_members();

-- ------------------------------------------------------------------------------
-- 2. DEDICATED DEFERRED CONSTRAINT TRIGGER FOR MEMBERSHIP REMOVAL
-- ------------------------------------------------------------------------------
-- Invariant: A workspace owner must not be removable as a member while their
-- workspace still exists, but deleting a workspace through an authorized cleanup
-- or lifecycle operation must not be blocked by that invariant.
--
-- Why a DEFERRED CONSTRAINT TRIGGER on AFTER DELETE:
-- 1. When an individual membership row is deleted directly (e.g. DELETE FROM
--    workspace_members WHERE user_id = owner_id), the parent workspace still
--    exists in public.workspaces. When the constraint trigger evaluates at the
--    end of the statement/transaction, FOUND is true and ws_owner = OLD.user_id,
--    so the deletion is rejected with an exception.
-- 2. When a workspace is deleted (e.g. DELETE FROM workspaces WHERE id = ws_id),
--    PostgreSQL foreign-key cascades delete the dependent workspace_members rows.
--    When the constraint trigger evaluates at the end of the statement/transaction,
--    public.workspaces no longer contains the workspace row (FOUND is false).
--    The check evaluates cleanly without error, allowing the workspace and all
--    its dependent rows to be deleted.

CREATE OR REPLACE FUNCTION public.protect_workspace_members_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    ws_owner pg_catalog.uuid;
BEGIN
    -- Query parent workspace to see if it still exists in public.workspaces.
    -- Executed as SECURITY DEFINER with fixed search_path = '' to eliminate search-path
    -- substitution attacks and bypass caller RLS on public.workspaces. All database objects
    -- are explicitly schema-qualified. If a workspace owner deletes their own membership,
    -- this ensures the existence check inspects public.workspaces directly rather than being
    -- blinded by caller RLS (which would see 0 membership rows in the transaction snapshot).
    SELECT owner_id INTO ws_owner
    FROM public.workspaces
    WHERE id = OLD.workspace_id;

    -- If the workspace still exists in public.workspaces and the deleted member
    -- is the workspace owner, forbid the removal.
    IF FOUND AND ws_owner = OLD.user_id THEN
        RAISE EXCEPTION 'The workspace owner cannot be removed from workspace members while the workspace exists.';
    END IF;

    RETURN OLD;
END;
$$;

-- Revoke all default execution privileges from PUBLIC. Trigger functions are invoked
-- internally by PostgreSQL's trigger engine and do not require explicit execution grants.
REVOKE ALL ON FUNCTION public.protect_workspace_members_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_workspace_members_protect_owner_delete ON public.workspace_members;

CREATE CONSTRAINT TRIGGER trg_workspace_members_protect_owner_delete
    AFTER DELETE ON public.workspace_members
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_workspace_members_delete();
