-- ==============================================================================
-- Migration: 20261030000002_ai_token_rpc_privilege_hardening.sql
-- Description: Hardens rate-limiter RPC execution privileges, revoking access from
--              PUBLIC, anon, and authenticated, restricting execution strictly to
--              service_role, adding strict parameter validation, and locking down
--              direct table mutation grants on ai_token_rate_limits.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. HARDEN RATE-LIMITER RPC: STRICT VALIDATION & TOKEN EXISTENCE CHECK
-- ------------------------------------------------------------------------------

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
    -- Input Validation 1: Token ID must be present
    IF p_token_id IS NULL THEN
        RAISE EXCEPTION 'p_token_id cannot be null in check_and_increment_ai_token_rate_limit';
    END IF;

    -- Input Validation 2: Parameters must be positive; default safely otherwise
    IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
        p_window_seconds := 60;
    END IF;

    IF p_max_requests IS NULL OR p_max_requests <= 0 THEN
        p_max_requests := 60;
    END IF;

    IF p_now IS NULL THEN
        p_now := clock_timestamp();
    END IF;

    -- Input Validation 3: Verified token existence & active status check
    -- Prevents phantom counter creation or manipulation for non-existent/revoked tokens
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_api_tokens
        WHERE id = p_token_id AND is_revoked = false
    ) THEN
        RETURN QUERY SELECT
            FALSE,
            0,
            p_window_seconds,
            0;
        RETURN;
    END IF;

    -- Ensure a counter row exists for this token (concurrency-safe upsert seed)
    INSERT INTO public.ai_token_rate_limits (token_id, window_start, request_count, updated_at)
    VALUES (p_token_id, p_now, 1, p_now)
    ON CONFLICT (token_id) DO NOTHING;

    -- Acquire an exclusive row lock on this token's rate-limit bucket
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

-- ------------------------------------------------------------------------------
-- 2. RESTRICT RPC PRIVILEGES: REVOKE FROM PUBLIC / GRANT ONLY TO SERVICE_ROLE
-- ------------------------------------------------------------------------------
-- SECURITY FIX:
-- Prevents ordinary users or anonymous clients from executing this RPC directly
-- over PostgREST to manipulate or exhaust rate-limit counters of arbitrary tokens.
-- The RPC is strictly reserved for the trusted server-side gateway authentication layer.

REVOKE ALL ON FUNCTION public.check_and_increment_ai_token_rate_limit(UUID, INTEGER, INTEGER, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.check_and_increment_ai_token_rate_limit(UUID, INTEGER, INTEGER, TIMESTAMPTZ)
    TO service_role;

-- ------------------------------------------------------------------------------
-- 3. RESTRICT TABLE-LEVEL PRIVILEGES ON ai_token_rate_limits
-- ------------------------------------------------------------------------------
-- Ensure authenticated users cannot issue direct INSERT/UPDATE/DELETE queries
-- to manipulate rate-limit records. Only SELECT is permitted (governed by RLS).

REVOKE ALL ON public.ai_token_rate_limits FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.ai_token_rate_limits FROM authenticated;

GRANT SELECT ON public.ai_token_rate_limits TO authenticated;
GRANT ALL ON public.ai_token_rate_limits TO service_role;

-- ------------------------------------------------------------------------------
-- 4. RESTRICT PSEUDOROLE PUBLIC ON ai_api_tokens & SAFE VIEW
-- ------------------------------------------------------------------------------
-- Cleanly eliminate any inherited PUBLIC privileges on the token table and views.

REVOKE ALL ON public.ai_api_tokens FROM PUBLIC;
REVOKE ALL ON public.ai_api_tokens_safe FROM PUBLIC, anon;

GRANT SELECT ON public.ai_api_tokens_safe TO authenticated;
