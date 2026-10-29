-- ==============================================================================
-- Migration: 20261028000003_fix_workspace_owner_provisioning.sql
-- Description: Allow initial workspace owner membership provisioning during signup
--              while enforcing strict 1:1 parity between workspaces.owner_id and
--              the owner role in workspace_members.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.protect_workspace_members()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    ws_owner UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT owner_id INTO ws_owner FROM public.workspaces WHERE id = OLD.workspace_id;
        IF OLD.user_id = ws_owner THEN
            RAISE EXCEPTION 'The workspace owner cannot be removed from workspace members.';
        END IF;
        RETURN OLD;
    ELSIF TG_OP IN ('INSERT', 'UPDATE') THEN
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
    END IF;
    RETURN NULL;
END;
$$;
