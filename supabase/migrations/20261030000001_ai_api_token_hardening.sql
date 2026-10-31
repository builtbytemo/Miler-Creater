-- ==============================================================================
-- Migration: 20261030000001_ai_api_token_hardening.sql
-- Description: Hardens AI API token management, introduces persistent atomic
--              token rate-limiting, tracks token revocation timestamps, prevents
--              direct token-hash selection, and enforces tamper-proof token
--              immutability across all sensitive fields.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTEND ai_api_tokens TABLE (NAME & REVOCATION TIMESTAMP)
-- ------------------------------------------------------------------------------

ALTER TABLE public.ai_api_tokens 
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- Backfill name from client_name if null
UPDATE public.ai_api_tokens
SET name = client_name
WHERE name IS NULL;

-- ------------------------------------------------------------------------------
-- 2. COMPREHENSIVE ANTI-TAMPERING TRIGGER: DEFENSE-IN-DEPTH IMMUTABILITY
-- ------------------------------------------------------------------------------
-- Ensures that token_hash, workspace_id, created_by, scopes, and expires_at
-- can NEVER be modified on an existing token, and that a revoked token can
-- NEVER be un-revoked.

CREATE OR REPLACE FUNCTION public.prevent_ai_token_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Invariant 1: Prevent changing token creator/owner
    IF NEW.created_by <> OLD.created_by THEN
        RAISE EXCEPTION 'Ownership of an AI API token cannot be transferred or modified.';
    END IF;

    -- Invariant 2: Prevent changing workspace binding
    IF NEW.workspace_id <> OLD.workspace_id THEN
        RAISE EXCEPTION 'Workspace binding of an AI API token cannot be modified.';
    END IF;

    -- Invariant 3: Prevent changing cryptographic token hash
    IF NEW.token_hash <> OLD.token_hash THEN
        RAISE EXCEPTION 'token_hash cannot be modified after token generation.';
    END IF;

    -- Invariant 4: Prevent changing token prefix
    IF NEW.token_prefix <> OLD.token_prefix THEN
        RAISE EXCEPTION 'token_prefix cannot be modified after token generation.';
    END IF;

    -- Invariant 5: Prevent privilege escalation through scope alteration
    IF NEW.scopes <> OLD.scopes THEN
        RAISE EXCEPTION 'Granted scopes cannot be modified after token generation.';
    END IF;

    -- Invariant 6: Prevent modifying expiration date
    IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
        RAISE EXCEPTION 'expires_at cannot be modified after token generation.';
    END IF;

    -- Invariant 7: Prevent un-revoking a revoked token
    IF OLD.is_revoked = true AND NEW.is_revoked = false THEN
        RAISE EXCEPTION 'A revoked AI API token cannot be un-revoked.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_tokens_immutable_owner ON public.ai_api_tokens;
DROP TRIGGER IF EXISTS trg_ai_tokens_anti_tampering ON public.ai_api_tokens;

CREATE TRIGGER trg_ai_tokens_anti_tampering
    BEFORE UPDATE ON public.ai_api_tokens
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_ai_token_tampering();

-- ------------------------------------------------------------------------------
-- 3. PERSISTENT SERVERLESS RATE LIMITING TABLE & INDEXES
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_token_rate_limits (
    token_id UUID PRIMARY KEY REFERENCES public.ai_api_tokens(id) ON DELETE CASCADE,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    request_count INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_tokens_workspace_list 
    ON public.ai_api_tokens(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_token_rate_limits_window 
    ON public.ai_token_rate_limits(window_start);

-- ------------------------------------------------------------------------------
-- 4. ATOMIC DATABASE-SIDE RATE LIMITING FUNCTION (CONCURRENCY-SAFE)
-- ------------------------------------------------------------------------------
-- Uses SELECT ... FOR UPDATE to guarantee atomic inspection and counter increment
-- across concurrent serverless invocations. Eliminates check-then-act race conditions.

CREATE OR REPLACE FUNCTION public.check_and_increment_ai_token_rate_limit(
    p_token_id UUID,
    p_window_seconds INTEGER DEFAULT 60,
    p_max_requests INTEGER DEFAULT 60,
    p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
    allowed BOOLEAN,
    remaining_requests INTEGER,
    retry_after_seconds INTEGER,
    current_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_window_start TIMESTAMPTZ;
    v_request_count INTEGER;
    v_elapsed_seconds INTEGER;
    v_retry_after INTEGER;
BEGIN
    -- Ensure record exists for this token (DO NOTHING on conflict)
    INSERT INTO public.ai_token_rate_limits (token_id, window_start, request_count, updated_at)
    VALUES (p_token_id, p_now, 1, p_now)
    ON CONFLICT (token_id) DO NOTHING;

    -- Acquire an exclusive row lock on this token's rate limit bucket
    SELECT window_start, request_count
    INTO v_window_start, v_request_count
    FROM public.ai_token_rate_limits
    WHERE token_id = p_token_id
    FOR UPDATE;

    -- Calculate elapsed seconds since window start
    v_elapsed_seconds := GREATEST(0, EXTRACT(EPOCH FROM (p_now - v_window_start))::INTEGER);

    IF v_elapsed_seconds >= p_window_seconds THEN
        -- Window expired: start a new rolling window with counter = 1
        UPDATE public.ai_token_rate_limits
        SET window_start = p_now,
            request_count = 1,
            updated_at = p_now
        WHERE token_id = p_token_id;

        RETURN QUERY SELECT
            TRUE,
            GREATEST(0, p_max_requests - 1),
            0,
            1;
        RETURN;
    ELSIF v_request_count >= p_max_requests THEN
        -- Quota exhausted within active window
        v_retry_after := GREATEST(1, p_window_seconds - v_elapsed_seconds);
        RETURN QUERY SELECT
            FALSE,
            0,
            v_retry_after,
            v_request_count;
        RETURN;
    ELSE
        -- Quota available: atomically increment counter
        v_request_count := v_request_count + 1;
        UPDATE public.ai_token_rate_limits
        SET request_count = v_request_count,
            updated_at = p_now
        WHERE token_id = p_token_id;

        RETURN QUERY SELECT
            TRUE,
            GREATEST(0, p_max_requests - v_request_count),
            0,
            v_request_count;
        RETURN;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_increment_ai_token_rate_limit(UUID, INTEGER, INTEGER, TIMESTAMPTZ)
    TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. COLUMN-LEVEL ACCESS CONTROL & ROW LEVEL SECURITY
-- ------------------------------------------------------------------------------

-- Step 5a: Prevent ordinary authenticated users from selecting token_hash
REVOKE ALL ON public.ai_api_tokens FROM authenticated, anon;

-- Grant column-level SELECT on non-sensitive columns only
GRANT SELECT (
    id, workspace_id, client_name, name, token_prefix, scopes,
    is_revoked, revoked_at, created_by, last_used_at, expires_at, created_at
) ON public.ai_api_tokens TO authenticated;

-- Grant INSERT only on appropriate creation columns
GRANT INSERT (
    workspace_id, client_name, name, token_hash, token_prefix,
    scopes, is_revoked, created_by, expires_at
) ON public.ai_api_tokens TO authenticated;

-- Grant UPDATE only on user-modifiable columns (name, client_name, is_revoked, revoked_at)
-- Notice token_hash, scopes, created_by, and expires_at are excluded from UPDATE grant
GRANT UPDATE (
    name, client_name, is_revoked, revoked_at
) ON public.ai_api_tokens TO authenticated;

-- Hard delete restricted to authenticated (further gated by RLS)
GRANT DELETE ON public.ai_api_tokens TO authenticated;

-- Step 5b: Configure Row Level Security policies
ALTER TABLE public.ai_api_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_tokens_select_admin" ON public.ai_api_tokens;
DROP POLICY IF EXISTS "ai_tokens_modify_admin" ON public.ai_api_tokens;
DROP POLICY IF EXISTS "ai_tokens_select_member_or_admin" ON public.ai_api_tokens;
DROP POLICY IF EXISTS "ai_tokens_insert_member" ON public.ai_api_tokens;
DROP POLICY IF EXISTS "ai_tokens_update_own_or_admin" ON public.ai_api_tokens;
DROP POLICY IF EXISTS "ai_tokens_delete_admin" ON public.ai_api_tokens;

-- SELECT: Admins/Owners view all workspace tokens; Members view only tokens they created
CREATE POLICY "ai_tokens_select_member_or_admin" ON public.ai_api_tokens
    FOR SELECT TO authenticated
    USING (
        (created_by = auth.uid() AND public.is_workspace_member(workspace_id, 'member'))
        OR public.is_workspace_member(workspace_id, 'admin')
    );

-- INSERT: Members/Admins create tokens for themselves in workspaces they belong to
CREATE POLICY "ai_tokens_insert_member" ON public.ai_api_tokens
    FOR INSERT TO authenticated
    WITH CHECK (
        created_by = auth.uid() 
        AND public.is_workspace_member(workspace_id, 'member')
    );

-- UPDATE: Members update/revoke own tokens; Admins update/revoke workspace tokens
CREATE POLICY "ai_tokens_update_own_or_admin" ON public.ai_api_tokens
    FOR UPDATE TO authenticated
    USING (
        (created_by = auth.uid() AND public.is_workspace_member(workspace_id, 'member'))
        OR public.is_workspace_member(workspace_id, 'admin')
    )
    WITH CHECK (
        (created_by = auth.uid() AND public.is_workspace_member(workspace_id, 'member'))
        OR public.is_workspace_member(workspace_id, 'admin')
    );

-- DELETE: Only workspace admins/owners can permanently delete tokens
CREATE POLICY "ai_tokens_delete_admin" ON public.ai_api_tokens
    FOR DELETE TO authenticated
    USING (public.is_workspace_member(workspace_id, 'admin'));

-- ------------------------------------------------------------------------------
-- 6. RATE LIMITS TABLE RLS
-- ------------------------------------------------------------------------------

ALTER TABLE public.ai_token_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rate_limits_admin_select" ON public.ai_token_rate_limits;

CREATE POLICY "rate_limits_admin_select" ON public.ai_token_rate_limits
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.ai_api_tokens t
            WHERE t.id = token_id
              AND public.is_workspace_member(t.workspace_id, 'admin')
        )
    );

-- ------------------------------------------------------------------------------
-- 7. SAFE CLIENT-FACING VIEW (NEVER EXPOSES TOKEN HASHES)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.ai_api_tokens_safe
WITH (security_invoker = true) AS
SELECT
    id,
    workspace_id,
    COALESCE(name, client_name) AS name,
    client_name,
    token_prefix,
    scopes,
    is_revoked,
    revoked_at,
    created_by,
    last_used_at,
    expires_at,
    created_at
FROM public.ai_api_tokens;

GRANT SELECT ON public.ai_api_tokens_safe TO authenticated;
