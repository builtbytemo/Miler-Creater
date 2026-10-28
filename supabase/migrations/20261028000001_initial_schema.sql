-- ==============================================================================
-- Initial Database Schema Migration for Content & Task Command Center
-- Migration: 20261028000001_initial_schema.sql
-- Description: Sets up multi-tenant workspace tables, content management,
--              tasks, calendar scheduling, notifications, AI boundaries,
--              audit events, triggers, and comprehensive RLS policies.
-- Audit Status: Audited & Hardened in Phase 1.1
-- ==============================================================================

-- 1. EXTENSIONS & UTILITIES
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Function: update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. CORE IDENTITY & MULTI-TENANCY TABLES
-- ------------------------------------------------------------------------------

-- Table: profiles (mirrors auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    timezone TEXT NOT NULL DEFAULT 'Asia/Cairo',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: workspaces
CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: workspace_members
CREATE TABLE IF NOT EXISTS public.workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_workspace_member UNIQUE (workspace_id, user_id)
);

-- ------------------------------------------------------------------------------
-- 3. SOCIAL ACCOUNTS (PLATFORM IDENTIFIERS)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.social_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'reddit', 'threads', 'x')),
    account_handle TEXT NOT NULL,
    account_name TEXT,
    avatar_url TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'connected', 'disconnected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_social_account UNIQUE (workspace_id, platform, account_handle)
);

-- ------------------------------------------------------------------------------
-- 4. PROJECTS, MILESTONES & RECURRENCE
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#2563eb',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.milestones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    due_date TIMESTAMPTZ,
    is_completed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recurrence_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly', 'custom')),
    interval INTEGER NOT NULL DEFAULT 1 CHECK (interval > 0),
    by_weekday INTEGER[],
    by_monthday INTEGER[],
    until_date TIMESTAMPTZ,
    count INTEGER CHECK (count IS NULL OR count > 0),
    timezone TEXT NOT NULL DEFAULT 'Asia/Cairo',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 5. CONTENT MANAGEMENT & TASKS
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.content_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    social_account_id UUID REFERENCES public.social_accounts(id) ON DELETE SET NULL,
    platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'reddit', 'threads', 'x')),
    action_type TEXT NOT NULL CHECK (action_type IN ('post', 'comment', 'reply', 'share', 'repost', 'reaction')),
    status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'draft', 'scheduled', 'publishing', 'published', 'failed', 'archived')),
    title TEXT,
    body TEXT NOT NULL DEFAULT '',
    scheduled_at TIMESTAMPTZ,
    duration_minutes INTEGER,
    media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    external_links JSONB NOT NULL DEFAULT '[]'::jsonb,
    target_reference JSONB,
    tags TEXT[] NOT NULL DEFAULT '{}',
    notes TEXT,
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    milestone_id UUID REFERENCES public.milestones(id) ON DELETE SET NULL,
    recurrence_rule_id UUID REFERENCES public.recurrence_rules(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    parent_task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    milestone_id UUID REFERENCES public.milestones(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    due_date TIMESTAMPTZ,
    estimated_duration_minutes INTEGER,
    is_all_day BOOLEAN NOT NULL DEFAULT false,
    completed_at TIMESTAMPTZ,
    tags TEXT[] NOT NULL DEFAULT '{}',
    recurrence_rule_id UUID REFERENCES public.recurrence_rules(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_task_schedule CHECK (scheduled_end IS NULL OR scheduled_start IS NULL OR scheduled_end >= scheduled_start)
);

CREATE TABLE IF NOT EXISTS public.task_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    depends_on_task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    dependency_type TEXT NOT NULL DEFAULT 'finish_to_start' CHECK (dependency_type IN ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_task_dependency UNIQUE (task_id, depends_on_task_id),
    CONSTRAINT chk_no_self_dependency CHECK (task_id != depends_on_task_id)
);

-- ------------------------------------------------------------------------------
-- 6. NOTIFICATIONS, AI INTEGRATIONS & AUDIT
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    entity_type TEXT CHECK (entity_type IN ('task', 'content_item', 'system', 'ai_request')),
    entity_id UUID,
    scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'dismissed')),
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_api_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    client_name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    token_prefix TEXT NOT NULL,
    scopes TEXT[] NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT false,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_confirmation_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    ai_token_id UUID NOT NULL REFERENCES public.ai_api_tokens(id) ON DELETE CASCADE,
    operation TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at TIMESTAMPTZ,
    responded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'ai_client', 'system')),
    actor_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 7. PERFORMANCE INDEXES
-- ------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON public.workspaces(owner_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON public.workspace_members(user_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_content_calendar ON public.content_items(workspace_id, scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_status ON public.content_items(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_content_platform ON public.content_items(workspace_id, platform);
CREATE INDEX IF NOT EXISTS idx_tasks_calendar ON public.tasks(workspace_id, scheduled_start, scheduled_end) WHERE scheduled_start IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON public.tasks(workspace_id, due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(workspace_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON public.tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_task ON public.task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_dep ON public.task_dependencies(depends_on_task_id);
CREATE INDEX IF NOT EXISTS idx_notifications_sched ON public.notifications(recipient_id, status, scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_ai_tokens_lookup ON public.ai_api_tokens(token_hash) WHERE is_revoked = false;
CREATE INDEX IF NOT EXISTS idx_audit_time ON public.audit_events(workspace_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- 8. TRIGGERS: AUTOMATIC UPDATED_AT, IMMUTABILITY & INTEGRITY
-- ------------------------------------------------------------------------------

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_workspaces_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_social_accounts_updated_at BEFORE UPDATE ON public.social_accounts FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_milestones_updated_at BEFORE UPDATE ON public.milestones FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_recurrence_rules_updated_at BEFORE UPDATE ON public.recurrence_rules FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_content_items_updated_at BEFORE UPDATE ON public.content_items FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Trigger: Prevent workspace_id tampering across all domain entities
CREATE OR REPLACE FUNCTION public.prevent_workspace_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.workspace_id <> OLD.workspace_id THEN
        RAISE EXCEPTION 'Workspace reassignment is forbidden.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_content_immutable_ws BEFORE UPDATE ON public.content_items FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_change();
CREATE TRIGGER trg_tasks_immutable_ws BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_change();
CREATE TRIGGER trg_projects_immutable_ws BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_change();
CREATE TRIGGER trg_milestones_immutable_ws BEFORE UPDATE ON public.milestones FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_change();
CREATE TRIGGER trg_social_accounts_immutable_ws BEFORE UPDATE ON public.social_accounts FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_change();
CREATE TRIGGER trg_recurrence_rules_immutable_ws BEFORE UPDATE ON public.recurrence_rules FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_change();
CREATE TRIGGER trg_task_deps_immutable_ws BEFORE UPDATE ON public.task_dependencies FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_change();
CREATE TRIGGER trg_ai_tokens_immutable_ws BEFORE UPDATE ON public.ai_api_tokens FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_change();
CREATE TRIGGER trg_ai_confirm_immutable_ws BEFORE UPDATE ON public.ai_confirmation_requests FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_change();
CREATE TRIGGER trg_notifications_immutable_ws BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_change();

-- Trigger: Protect workspace owner from unauthorized reassignment
CREATE OR REPLACE FUNCTION public.protect_workspace_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.owner_id <> OLD.owner_id THEN
        IF auth.uid() IS NULL OR auth.uid() <> OLD.owner_id THEN
            RAISE EXCEPTION 'Only the current workspace owner can transfer workspace ownership.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_workspaces_owner_protection BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_owner();

-- Trigger: Protect workspace members (prevent deleting owner, prevent non-owner assigning owner)
CREATE OR REPLACE FUNCTION public.protect_workspace_members()
RETURNS TRIGGER
LANGUAGE plpgsql
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
            IF auth.uid() IS NULL OR auth.uid() <> ws_owner THEN
                RAISE EXCEPTION 'Only the workspace owner can assign or hold the owner role.';
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_members_owner_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_members
    FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_members();

-- Trigger: Validate task foreign key workspace isolation
CREATE OR REPLACE FUNCTION public.validate_task_workspace_relations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.project_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = NEW.project_id AND workspace_id = NEW.workspace_id) THEN
            RAISE EXCEPTION 'Associated project does not belong to the same workspace.';
        END IF;
    END IF;

    IF NEW.milestone_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.milestones WHERE id = NEW.milestone_id AND workspace_id = NEW.workspace_id) THEN
            RAISE EXCEPTION 'Associated milestone does not belong to the same workspace.';
        END IF;
    END IF;

    IF NEW.recurrence_rule_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.recurrence_rules WHERE id = NEW.recurrence_rule_id AND workspace_id = NEW.workspace_id) THEN
            RAISE EXCEPTION 'Associated recurrence rule does not belong to the same workspace.';
        END IF;
    END IF;

    IF NEW.parent_task_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = NEW.parent_task_id AND workspace_id = NEW.workspace_id) THEN
            RAISE EXCEPTION 'Parent task does not belong to the same workspace.';
        END IF;
        IF NEW.parent_task_id = NEW.id THEN
            RAISE EXCEPTION 'A task cannot be its own parent.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tasks_workspace_relations
    BEFORE INSERT OR UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.validate_task_workspace_relations();

-- Trigger: Validate content items foreign key workspace isolation
CREATE OR REPLACE FUNCTION public.validate_content_workspace_relations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.project_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = NEW.project_id AND workspace_id = NEW.workspace_id) THEN
            RAISE EXCEPTION 'Associated project does not belong to the same workspace.';
        END IF;
    END IF;

    IF NEW.milestone_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.milestones WHERE id = NEW.milestone_id AND workspace_id = NEW.workspace_id) THEN
            RAISE EXCEPTION 'Associated milestone does not belong to the same workspace.';
        END IF;
    END IF;

    IF NEW.social_account_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.social_accounts WHERE id = NEW.social_account_id AND workspace_id = NEW.workspace_id) THEN
            RAISE EXCEPTION 'Associated social account does not belong to the same workspace.';
        END IF;
    END IF;

    IF NEW.recurrence_rule_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.recurrence_rules WHERE id = NEW.recurrence_rule_id AND workspace_id = NEW.workspace_id) THEN
            RAISE EXCEPTION 'Associated recurrence rule does not belong to the same workspace.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_content_workspace_relations
    BEFORE INSERT OR UPDATE ON public.content_items
    FOR EACH ROW EXECUTE FUNCTION public.validate_content_workspace_relations();

-- Trigger: Task Dependency Integrity and Multi-Step Cycle Detection
CREATE OR REPLACE FUNCTION public.check_task_dependency_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    has_cycle BOOLEAN;
BEGIN
    IF NEW.task_id = NEW.depends_on_task_id THEN
        RAISE EXCEPTION 'A task cannot depend on itself.';
    END IF;

    -- Workspace isolation check: both tasks must belong to NEW.workspace_id
    IF NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = NEW.task_id AND workspace_id = NEW.workspace_id) THEN
        RAISE EXCEPTION 'Source task does not exist or does not belong to the specified workspace.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = NEW.depends_on_task_id AND workspace_id = NEW.workspace_id) THEN
        RAISE EXCEPTION 'Target dependency task does not exist or does not belong to the specified workspace.';
    END IF;

    -- Recursive cycle check
    WITH RECURSIVE dependency_chain AS (
        SELECT depends_on_task_id AS current_task
        FROM public.task_dependencies
        WHERE task_id = NEW.depends_on_task_id

        UNION ALL

        SELECT td.depends_on_task_id
        FROM public.task_dependencies td
        JOIN dependency_chain dc ON td.task_id = dc.current_task
    )
    SELECT EXISTS (
        SELECT 1 FROM dependency_chain WHERE current_task = NEW.task_id
    ) INTO has_cycle;

    IF has_cycle THEN
        RAISE EXCEPTION 'Circular task dependency detected: adding this dependency would create a cycle.';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_dependencies_cycle_check
    BEFORE INSERT OR UPDATE ON public.task_dependencies
    FOR EACH ROW EXECUTE FUNCTION public.check_task_dependency_cycle();

-- Trigger: Prevent modification or deletion of audit events (strictly append-only)
CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Audit events are immutable and cannot be updated or deleted.';
END;
$$;

CREATE TRIGGER trg_audit_events_immutable
    BEFORE UPDATE OR DELETE ON public.audit_events
    FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation();

-- ------------------------------------------------------------------------------
-- 9. USER SIGNUP PROVISIONING TRIGGER (AUTOMATIC PERSONAL WORKSPACE)
-- ------------------------------------------------------------------------------

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

    -- 4. Record audit event
    INSERT INTO public.audit_events (workspace_id, actor_type, actor_id, event_type, entity_type, entity_id, details)
    VALUES (
        new_workspace_id,
        'system',
        NEW.id::text,
        'workspace.auto_provisioned',
        'workspace',
        new_workspace_id,
        jsonb_build_object('user_email', NEW.email)
    );

    RETURN NEW;
END;
$$;

-- Connect trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_provisioning();

-- ------------------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurrence_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_confirmation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Helper function: check workspace membership without triggering policy recursion
CREATE OR REPLACE FUNCTION public.is_workspace_member(
    lookup_workspace_id UUID,
    required_role TEXT DEFAULT 'viewer'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    user_role TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT role INTO user_role
    FROM public.workspace_members
    WHERE workspace_id = lookup_workspace_id
      AND user_id = auth.uid();

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    IF required_role = 'viewer' THEN
        RETURN TRUE;
    ELSIF required_role = 'member' AND user_role IN ('owner', 'admin', 'member') THEN
        RETURN TRUE;
    ELSIF required_role = 'admin' AND user_role IN ('owner', 'admin') THEN
        RETURN TRUE;
    ELSIF required_role = 'owner' AND user_role = 'owner' THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

-- PROFILES POLICIES
CREATE POLICY "profiles_select_own_or_workspace" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.workspace_members wm1
            JOIN public.workspace_members wm2 ON wm1.workspace_id = wm2.workspace_id
            WHERE wm1.user_id = auth.uid() AND wm2.user_id = profiles.id
        )
    );

CREATE POLICY "profiles_update_own" ON public.profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- WORKSPACES POLICIES
CREATE POLICY "workspaces_select_member" ON public.workspaces
    FOR SELECT TO authenticated
    USING (public.is_workspace_member(id, 'viewer'));

CREATE POLICY "workspaces_insert_owner" ON public.workspaces
    FOR INSERT TO authenticated
    WITH CHECK (owner_id = auth.uid());

CREATE POLICY "workspaces_update_admin" ON public.workspaces
    FOR UPDATE TO authenticated
    USING (public.is_workspace_member(id, 'admin'))
    WITH CHECK (public.is_workspace_member(id, 'admin'));

CREATE POLICY "workspaces_delete_owner" ON public.workspaces
    FOR DELETE TO authenticated
    USING (public.is_workspace_member(id, 'owner'));

-- WORKSPACE_MEMBERS POLICIES
CREATE POLICY "members_select" ON public.workspace_members
    FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id, 'viewer'));

CREATE POLICY "members_insert_admin" ON public.workspace_members
    FOR INSERT TO authenticated
    WITH CHECK (public.is_workspace_member(workspace_id, 'admin'));

CREATE POLICY "members_update_admin" ON public.workspace_members
    FOR UPDATE TO authenticated
    USING (public.is_workspace_member(workspace_id, 'admin'))
    WITH CHECK (public.is_workspace_member(workspace_id, 'admin'));

CREATE POLICY "members_delete_admin" ON public.workspace_members
    FOR DELETE TO authenticated
    USING (public.is_workspace_member(workspace_id, 'admin'));

-- SOCIAL ACCOUNTS POLICIES
CREATE POLICY "social_select" ON public.social_accounts
    FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id, 'viewer'));

CREATE POLICY "social_modify" ON public.social_accounts
    FOR ALL TO authenticated
    USING (public.is_workspace_member(workspace_id, 'admin'))
    WITH CHECK (public.is_workspace_member(workspace_id, 'admin'));

-- PROJECTS & MILESTONES POLICIES
CREATE POLICY "projects_select" ON public.projects
    FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id, 'viewer'));

CREATE POLICY "projects_modify" ON public.projects
    FOR ALL TO authenticated
    USING (public.is_workspace_member(workspace_id, 'member'))
    WITH CHECK (public.is_workspace_member(workspace_id, 'member'));

CREATE POLICY "milestones_select" ON public.milestones
    FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id, 'viewer'));

CREATE POLICY "milestones_modify" ON public.milestones
    FOR ALL TO authenticated
    USING (public.is_workspace_member(workspace_id, 'member'))
    WITH CHECK (public.is_workspace_member(workspace_id, 'member'));

-- RECURRENCE RULES POLICIES
CREATE POLICY "recurrence_select" ON public.recurrence_rules
    FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id, 'viewer'));

CREATE POLICY "recurrence_modify" ON public.recurrence_rules
    FOR ALL TO authenticated
    USING (public.is_workspace_member(workspace_id, 'member'))
    WITH CHECK (public.is_workspace_member(workspace_id, 'member'));

-- CONTENT ITEMS POLICIES
CREATE POLICY "content_select" ON public.content_items
    FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id, 'viewer'));

CREATE POLICY "content_insert" ON public.content_items
    FOR INSERT TO authenticated
    WITH CHECK (public.is_workspace_member(workspace_id, 'member'));

CREATE POLICY "content_update" ON public.content_items
    FOR UPDATE TO authenticated
    USING (public.is_workspace_member(workspace_id, 'member'))
    WITH CHECK (public.is_workspace_member(workspace_id, 'member'));

CREATE POLICY "content_delete" ON public.content_items
    FOR DELETE TO authenticated
    USING (public.is_workspace_member(workspace_id, 'admin'));

-- TASKS POLICIES
CREATE POLICY "tasks_select" ON public.tasks
    FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id, 'viewer'));

CREATE POLICY "tasks_insert" ON public.tasks
    FOR INSERT TO authenticated
    WITH CHECK (public.is_workspace_member(workspace_id, 'member'));

CREATE POLICY "tasks_update" ON public.tasks
    FOR UPDATE TO authenticated
    USING (public.is_workspace_member(workspace_id, 'member'))
    WITH CHECK (public.is_workspace_member(workspace_id, 'member'));

CREATE POLICY "tasks_delete" ON public.tasks
    FOR DELETE TO authenticated
    USING (public.is_workspace_member(workspace_id, 'member'));

-- TASK DEPENDENCIES POLICIES
CREATE POLICY "task_deps_select" ON public.task_dependencies
    FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id, 'viewer'));

CREATE POLICY "task_deps_modify" ON public.task_dependencies
    FOR ALL TO authenticated
    USING (public.is_workspace_member(workspace_id, 'member'))
    WITH CHECK (public.is_workspace_member(workspace_id, 'member'));

-- NOTIFICATIONS POLICIES
CREATE POLICY "notifications_select_recipient" ON public.notifications
    FOR SELECT TO authenticated
    USING (recipient_id = auth.uid());

CREATE POLICY "notifications_update_recipient" ON public.notifications
    FOR UPDATE TO authenticated
    USING (recipient_id = auth.uid())
    WITH CHECK (recipient_id = auth.uid());

-- AI TOKENS & CONFIRMATIONS POLICIES
CREATE POLICY "ai_tokens_select_admin" ON public.ai_api_tokens
    FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id, 'admin'));

CREATE POLICY "ai_tokens_modify_admin" ON public.ai_api_tokens
    FOR ALL TO authenticated
    USING (public.is_workspace_member(workspace_id, 'admin'))
    WITH CHECK (public.is_workspace_member(workspace_id, 'admin'));

CREATE POLICY "ai_confirm_select" ON public.ai_confirmation_requests
    FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id, 'member'));

CREATE POLICY "ai_confirm_respond_admin" ON public.ai_confirmation_requests
    FOR UPDATE TO authenticated
    USING (public.is_workspace_member(workspace_id, 'admin'))
    WITH CHECK (public.is_workspace_member(workspace_id, 'admin'));

-- AUDIT EVENTS POLICIES (Append-only by system / read-only by admin)
CREATE POLICY "audit_select_admin" ON public.audit_events
    FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id, 'admin'));
