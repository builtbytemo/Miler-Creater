-- ==============================================================================
-- Migration: 20261031000002_mcp_oauth_authorization_server.sql
-- Description: Implements OAuth 2.1 Authorization Server persistence for remote
--              MCP connectors (Claude Web), including RFC 7591 Dynamic Client
--              Registration, single-use PKCE S256 authorization codes, atomic
--              refresh-token rotation with replay detection, RFC 8707 resource
--              binding on AI API tokens, cascade revocation, and strict RLS /
--              privilege hardening.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTEND public.ai_api_tokens FOR RFC 8707 RESOURCE & OAUTH CLIENT BINDING
-- ------------------------------------------------------------------------------
-- Nullable columns so existing and manually generated ctc_live_ tokens remain
-- unaffected (resource IS NULL), while OAuth-minted ctc_live_ access tokens are
-- strictly bound to the canonical MCP resource and OAuth client_id.

ALTER TABLE public.ai_api_tokens
    ADD COLUMN IF NOT EXISTS resource TEXT,
    ADD COLUMN IF NOT EXISTS oauth_client_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_tokens_oauth_client
    ON public.ai_api_tokens(oauth_client_id)
    WHERE oauth_client_id IS NOT NULL;

-- Update anti-tampering trigger function with pinned empty search_path ('')
-- and immutability protection for resource and oauth_client_id.
CREATE OR REPLACE FUNCTION public.prevent_ai_token_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

    -- Invariant 8: Prevent modifying RFC 8707 resource binding
    IF NEW.resource IS DISTINCT FROM OLD.resource THEN
        RAISE EXCEPTION 'resource binding cannot be modified after token generation.';
    END IF;

    -- Invariant 9: Prevent modifying OAuth client binding
    IF NEW.oauth_client_id IS DISTINCT FROM OLD.oauth_client_id THEN
        RAISE EXCEPTION 'oauth_client_id cannot be modified after token generation.';
    END IF;

    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. OAUTH 2.1 DYNAMIC CLIENT REGISTRATION TABLE (RFC 7591)
-- ------------------------------------------------------------------------------
-- Public clients only (token_endpoint_auth_method = 'none').
-- Never generates or stores unnecessary client secrets.

CREATE TABLE IF NOT EXISTS public.oauth_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL UNIQUE,
    client_name TEXT NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(client_name)) BETWEEN 1 AND 100),
    redirect_uris TEXT[] NOT NULL CHECK (pg_catalog.array_length(redirect_uris, 1) BETWEEN 1 AND 5),
    grant_types TEXT[] NOT NULL DEFAULT ARRAY['authorization_code', 'refresh_token']::TEXT[],
    response_types TEXT[] NOT NULL DEFAULT ARRAY['code']::TEXT[],
    token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none' CHECK (token_endpoint_auth_method = 'none'),
    created_by_ip TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_clients_created_at
    ON public.oauth_clients(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oauth_clients_ip_created_at
    ON public.oauth_clients(created_by_ip, created_at DESC)
    WHERE created_by_ip IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 3. OAUTH 2.1 SINGLE-USE AUTHORIZATION CODES TABLE (PKCE S256 + RFC 8707)
-- ------------------------------------------------------------------------------
-- Stores only SHA-256 hashes of authorization codes.

CREATE TABLE IF NOT EXISTS public.oauth_authorization_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_hash TEXT NOT NULL UNIQUE CHECK (pg_catalog.char_length(code_hash) = 64),
    client_id TEXT NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    scopes TEXT[] NOT NULL CHECK (pg_catalog.array_length(scopes, 1) >= 1),
    code_challenge TEXT NOT NULL CHECK (pg_catalog.char_length(code_challenge) BETWEEN 43 AND 128),
    code_challenge_method TEXT NOT NULL DEFAULT 'S256' CHECK (code_challenge_method = 'S256'),
    resource TEXT NOT NULL,
    consumed_at TIMESTAMPTZ,
    grant_id UUID,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_expires_at
    ON public.oauth_authorization_codes(expires_at);

CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_user_workspace
    ON public.oauth_authorization_codes(user_id, workspace_id);

-- ------------------------------------------------------------------------------
-- 4. OAUTH 2.1 REFRESH TOKENS TABLE (SINGLE-USE ROTATION & REPLAY DETECTION)
-- ------------------------------------------------------------------------------
-- Stores only SHA-256 hashes of refresh tokens and links each refresh token to
-- its issued access token in public.ai_api_tokens and its grant family (grant_id).

CREATE TABLE IF NOT EXISTS public.oauth_refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT NOT NULL UNIQUE CHECK (pg_catalog.char_length(token_hash) = 64),
    grant_id UUID NOT NULL DEFAULT gen_random_uuid(),
    access_token_id UUID NOT NULL REFERENCES public.ai_api_tokens(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    scopes TEXT[] NOT NULL CHECK (pg_catalog.array_length(scopes, 1) >= 1),
    resource TEXT NOT NULL,
    consumed_at TIMESTAMPTZ,
    replaced_by_hash TEXT,
    is_revoked BOOLEAN NOT NULL DEFAULT false,
    revoked_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_access_token
    ON public.oauth_refresh_tokens(access_token_id);

CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_grant_id
    ON public.oauth_refresh_tokens(grant_id);

CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_user_workspace
    ON public.oauth_refresh_tokens(user_id, workspace_id);

-- ------------------------------------------------------------------------------
-- 5. CASCADE REVOCATION TRIGGER: ACCESS TOKEN -> LINKED REFRESH TOKENS
-- ------------------------------------------------------------------------------
-- When an access token is revoked (e.g. via /settings/tokens UI or /api/oauth/revoke),
-- any linked refresh token is immediately marked revoked in the same transaction.

CREATE OR REPLACE FUNCTION public.cascade_revoke_oauth_refresh_tokens()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF OLD.is_revoked = false AND NEW.is_revoked = true THEN
        UPDATE public.oauth_refresh_tokens
        SET is_revoked = true,
            revoked_at = COALESCE(NEW.revoked_at, pg_catalog.now())
        WHERE access_token_id = NEW.id
          AND is_revoked = false;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_revoke_oauth_refresh_tokens ON public.ai_api_tokens;

CREATE TRIGGER trg_cascade_revoke_oauth_refresh_tokens
    AFTER UPDATE OF is_revoked ON public.ai_api_tokens
    FOR EACH ROW
    EXECUTE FUNCTION public.cascade_revoke_oauth_refresh_tokens();

-- ------------------------------------------------------------------------------
-- 6. ATOMIC AUTHORIZATION CODE EXCHANGE RPC
-- ------------------------------------------------------------------------------
-- Atomically locks and consumes a single-use authorization code, verifies PKCE
-- S256 challenge, client_id, redirect_uri, resource binding, and active workspace
-- membership/role, and mints the access token + refresh token in one transaction.

CREATE OR REPLACE FUNCTION public.exchange_oauth_authorization_code(
    p_code_hash TEXT,
    p_client_id TEXT,
    p_redirect_uri TEXT,
    p_computed_code_challenge TEXT,
    p_expected_resource TEXT,
    p_requested_scopes TEXT[],
    p_new_access_token_hash TEXT,
    p_new_access_token_prefix TEXT,
    p_new_refresh_token_hash TEXT,
    p_token_name TEXT,
    p_access_expires_at TIMESTAMPTZ,
    p_refresh_expires_at TIMESTAMPTZ,
    p_now TIMESTAMPTZ DEFAULT pg_catalog.now()
)
RETURNS TABLE (
    allowed BOOLEAN,
    error_code TEXT,
    error_reason TEXT,
    access_token_id UUID,
    workspace_id UUID,
    user_id UUID,
    granted_scopes TEXT[],
    resource TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_code public.oauth_authorization_codes%ROWTYPE;
    v_member_role TEXT;
    v_effective_scopes TEXT[];
    v_access_token_id UUID;
    v_grant_id UUID;
BEGIN
    IF p_now IS NULL THEN
        p_now := pg_catalog.clock_timestamp();
    END IF;

    -- 1. Lock authorization code row for atomic single-use verification
    SELECT *
    INTO v_code
    FROM public.oauth_authorization_codes
    WHERE code_hash = p_code_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'invalid_grant'::TEXT, 'code_not_found'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    -- 2. Single-use enforcement: reject if already consumed
    IF v_code.consumed_at IS NOT NULL THEN
        -- Replay detection: revoke only the specific grant family that was issued for this code
        IF v_code.grant_id IS NOT NULL THEN
            UPDATE public.oauth_refresh_tokens
            SET is_revoked = true,
                revoked_at = p_now
            WHERE grant_id = v_code.grant_id
              AND is_revoked = false;

            UPDATE public.ai_api_tokens
            SET is_revoked = true,
                revoked_at = p_now
            WHERE id IN (
                SELECT r.access_token_id
                FROM public.oauth_refresh_tokens r
                WHERE r.grant_id = v_code.grant_id
            )
            AND is_revoked = false;
        END IF;
        -- If v_code.grant_id IS NULL, no grant family was ever minted for this code.
        -- Broad client/user/workspace revocation is avoided to protect unrelated grants and manual tokens.

        RETURN QUERY SELECT FALSE, 'invalid_grant'::TEXT, 'code_reused'::TEXT, NULL::UUID, v_code.workspace_id, v_code.user_id, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    -- 3. Check expiration
    IF v_code.expires_at <= p_now THEN
        RETURN QUERY SELECT FALSE, 'invalid_grant'::TEXT, 'code_expired'::TEXT, NULL::UUID, v_code.workspace_id, v_code.user_id, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    -- 4. Verify client_id and exact redirect_uri binding
    IF v_code.client_id <> p_client_id THEN
        RETURN QUERY SELECT FALSE, 'invalid_grant'::TEXT, 'client_mismatch'::TEXT, NULL::UUID, v_code.workspace_id, v_code.user_id, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    IF v_code.redirect_uri <> p_redirect_uri THEN
        RETURN QUERY SELECT FALSE, 'invalid_grant'::TEXT, 'redirect_uri_mismatch'::TEXT, NULL::UUID, v_code.workspace_id, v_code.user_id, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    -- 5. Verify PKCE S256 challenge
    IF v_code.code_challenge_method <> 'S256' OR v_code.code_challenge <> p_computed_code_challenge THEN
        RETURN QUERY SELECT FALSE, 'invalid_grant'::TEXT, 'pkce_verification_failed'::TEXT, NULL::UUID, v_code.workspace_id, v_code.user_id, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    -- 6. Verify RFC 8707 resource binding
    IF v_code.resource <> p_expected_resource THEN
        RETURN QUERY SELECT FALSE, 'invalid_target'::TEXT, 'resource_mismatch'::TEXT, NULL::UUID, v_code.workspace_id, v_code.user_id, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    -- 7. Verify requested scopes do not escalate beyond consented scopes
    IF p_requested_scopes IS NOT NULL AND pg_catalog.array_length(p_requested_scopes, 1) > 0 THEN
        IF NOT (p_requested_scopes <@ v_code.scopes) THEN
            RETURN QUERY SELECT FALSE, 'invalid_scope'::TEXT, 'scope_escalation'::TEXT, NULL::UUID, v_code.workspace_id, v_code.user_id, NULL::TEXT[], NULL::TEXT;
            RETURN;
        END IF;
        v_effective_scopes := p_requested_scopes;
    ELSE
        v_effective_scopes := v_code.scopes;
    END IF;

    -- 8. Verify active workspace membership and non-viewer role
    SELECT m.role
    INTO v_member_role
    FROM public.workspace_members m
    WHERE m.workspace_id = v_code.workspace_id
      AND m.user_id = v_code.user_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'invalid_grant'::TEXT, 'membership_revoked'::TEXT, NULL::UUID, v_code.workspace_id, v_code.user_id, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    IF v_member_role = 'viewer' THEN
        RETURN QUERY SELECT FALSE, 'invalid_grant'::TEXT, 'viewer_role_forbidden'::TEXT, NULL::UUID, v_code.workspace_id, v_code.user_id, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    -- 9. Generate unique grant family ID and atomically mark authorization code consumed
    v_grant_id := pg_catalog.gen_random_uuid();

    UPDATE public.oauth_authorization_codes
    SET consumed_at = p_now,
        grant_id = v_grant_id
    WHERE id = v_code.id;

    -- 10. Mint access token in public.ai_api_tokens
    INSERT INTO public.ai_api_tokens (
        workspace_id,
        client_name,
        name,
        token_hash,
        token_prefix,
        scopes,
        is_revoked,
        created_by,
        expires_at,
        resource,
        oauth_client_id
    )
    VALUES (
        v_code.workspace_id,
        p_token_name,
        p_token_name,
        p_new_access_token_hash,
        p_new_access_token_prefix,
        v_effective_scopes,
        false,
        v_code.user_id,
        p_access_expires_at,
        v_code.resource,
        v_code.client_id
    )
    RETURNING id INTO v_access_token_id;

    -- 11. Mint refresh token in public.oauth_refresh_tokens using the same grant_id
    INSERT INTO public.oauth_refresh_tokens (
        token_hash,
        grant_id,
        access_token_id,
        client_id,
        user_id,
        workspace_id,
        scopes,
        resource,
        expires_at
    )
    VALUES (
        p_new_refresh_token_hash,
        v_grant_id,
        v_access_token_id,
        v_code.client_id,
        v_code.user_id,
        v_code.workspace_id,
        v_effective_scopes,
        v_code.resource,
        p_refresh_expires_at
    );

    RETURN QUERY SELECT
        TRUE,
        NULL::TEXT,
        NULL::TEXT,
        v_access_token_id,
        v_code.workspace_id,
        v_code.user_id,
        v_effective_scopes,
        v_code.resource;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. ATOMIC REFRESH-TOKEN ROTATION RPC WITH REPLAY DETECTION
-- ------------------------------------------------------------------------------
-- Atomically rotates a refresh token, detects replay of already-consumed tokens
-- (revoking the entire grant family on replay), verifies the linked access token
-- has not been revoked, re-verifies active workspace membership and role, revokes
-- the superseded access token, and issues a new access token + refresh token.

CREATE OR REPLACE FUNCTION public.rotate_oauth_refresh_token(
    p_old_refresh_token_hash TEXT,
    p_client_id TEXT,
    p_expected_resource TEXT,
    p_requested_scopes TEXT[],
    p_new_access_token_hash TEXT,
    p_new_access_token_prefix TEXT,
    p_new_refresh_token_hash TEXT,
    p_token_name TEXT,
    p_access_expires_at TIMESTAMPTZ,
    p_refresh_expires_at TIMESTAMPTZ,
    p_now TIMESTAMPTZ DEFAULT pg_catalog.now()
)
RETURNS TABLE (
    allowed BOOLEAN,
    error_code TEXT,
    error_reason TEXT,
    new_access_token_id UUID,
    old_access_token_id UUID,
    workspace_id UUID,
    user_id UUID,
    granted_scopes TEXT[],
    resource TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rt public.oauth_refresh_tokens%ROWTYPE;
    v_access_revoked BOOLEAN;
    v_member_role TEXT;
    v_effective_scopes TEXT[];
    v_new_access_id UUID;
BEGIN
    IF p_now IS NULL THEN
        p_now := pg_catalog.clock_timestamp();
    END IF;

    -- 1. Lock refresh token row for atomic single-use rotation
    SELECT *
    INTO v_rt
    FROM public.oauth_refresh_tokens
    WHERE token_hash = p_old_refresh_token_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'invalid_grant'::TEXT, 'refresh_token_not_found'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    -- 2. Replay Detection: if already consumed, revoke the entire grant family immediately
    IF v_rt.consumed_at IS NOT NULL THEN
        UPDATE public.oauth_refresh_tokens
        SET is_revoked = true,
            revoked_at = p_now
        WHERE grant_id = v_rt.grant_id
          AND is_revoked = false;

        UPDATE public.ai_api_tokens
        SET is_revoked = true,
            revoked_at = p_now
        WHERE id IN (
            SELECT r.access_token_id
            FROM public.oauth_refresh_tokens r
            WHERE r.grant_id = v_rt.grant_id
        )
        AND is_revoked = false;

        RETURN QUERY SELECT FALSE, 'invalid_grant'::TEXT, 'refresh_token_replayed'::TEXT, NULL::UUID, v_rt.access_token_id, v_rt.workspace_id, v_rt.user_id, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    -- 3. Check refresh token revocation & expiration
    IF v_rt.is_revoked THEN
        RETURN QUERY SELECT FALSE, 'invalid_grant'::TEXT, 'refresh_token_revoked'::TEXT, NULL::UUID, v_rt.access_token_id, v_rt.workspace_id, v_rt.user_id, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    IF v_rt.expires_at <= p_now THEN
        RETURN QUERY SELECT FALSE, 'invalid_grant'::TEXT, 'refresh_token_expired'::TEXT, NULL::UUID, v_rt.access_token_id, v_rt.workspace_id, v_rt.user_id, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    -- 4. Check linked access token revocation state
    SELECT t.is_revoked
    INTO v_access_revoked
    FROM public.ai_api_tokens t
    WHERE t.id = v_rt.access_token_id;

    IF NOT FOUND OR v_access_revoked = true THEN
        UPDATE public.oauth_refresh_tokens
        SET is_revoked = true,
            revoked_at = p_now
        WHERE id = v_rt.id;

        RETURN QUERY SELECT FALSE, 'invalid_grant'::TEXT, 'linked_access_token_revoked'::TEXT, NULL::UUID, v_rt.access_token_id, v_rt.workspace_id, v_rt.user_id, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    -- 5. Check client_id and RFC 8707 resource binding
    IF v_rt.client_id <> p_client_id THEN
        RETURN QUERY SELECT FALSE, 'invalid_grant'::TEXT, 'client_mismatch'::TEXT, NULL::UUID, v_rt.access_token_id, v_rt.workspace_id, v_rt.user_id, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    IF v_rt.resource <> p_expected_resource THEN
        RETURN QUERY SELECT FALSE, 'invalid_target'::TEXT, 'resource_mismatch'::TEXT, NULL::UUID, v_rt.access_token_id, v_rt.workspace_id, v_rt.user_id, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    -- 6. Check scope subset
    IF p_requested_scopes IS NOT NULL AND pg_catalog.array_length(p_requested_scopes, 1) > 0 THEN
        IF NOT (p_requested_scopes <@ v_rt.scopes) THEN
            RETURN QUERY SELECT FALSE, 'invalid_scope'::TEXT, 'scope_escalation'::TEXT, NULL::UUID, v_rt.access_token_id, v_rt.workspace_id, v_rt.user_id, NULL::TEXT[], NULL::TEXT;
            RETURN;
        END IF;
        v_effective_scopes := p_requested_scopes;
    ELSE
        v_effective_scopes := v_rt.scopes;
    END IF;

    -- 7. Recheck active workspace membership and role
    SELECT m.role
    INTO v_member_role
    FROM public.workspace_members m
    WHERE m.workspace_id = v_rt.workspace_id
      AND m.user_id = v_rt.user_id;

    IF NOT FOUND THEN
        UPDATE public.oauth_refresh_tokens
        SET is_revoked = true,
            revoked_at = p_now
        WHERE id = v_rt.id;

        UPDATE public.ai_api_tokens
        SET is_revoked = true,
            revoked_at = p_now
        WHERE id = v_rt.access_token_id
          AND is_revoked = false;

        RETURN QUERY SELECT FALSE, 'invalid_grant'::TEXT, 'membership_revoked'::TEXT, NULL::UUID, v_rt.access_token_id, v_rt.workspace_id, v_rt.user_id, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    IF v_member_role = 'viewer' THEN
        UPDATE public.oauth_refresh_tokens
        SET is_revoked = true,
            revoked_at = p_now
        WHERE id = v_rt.id;

        UPDATE public.ai_api_tokens
        SET is_revoked = true,
            revoked_at = p_now
        WHERE id = v_rt.access_token_id
          AND is_revoked = false;

        RETURN QUERY SELECT FALSE, 'invalid_grant'::TEXT, 'viewer_role_forbidden'::TEXT, NULL::UUID, v_rt.access_token_id, v_rt.workspace_id, v_rt.user_id, NULL::TEXT[], NULL::TEXT;
        RETURN;
    END IF;

    -- 8. Consume old refresh token & revoke superseded access token
    UPDATE public.oauth_refresh_tokens
    SET consumed_at = p_now,
        replaced_by_hash = p_new_refresh_token_hash
    WHERE id = v_rt.id;

    UPDATE public.ai_api_tokens
    SET is_revoked = true,
        revoked_at = p_now
    WHERE id = v_rt.access_token_id
      AND is_revoked = false;

    -- 9. Mint new access token in public.ai_api_tokens
    INSERT INTO public.ai_api_tokens (
        workspace_id,
        client_name,
        name,
        token_hash,
        token_prefix,
        scopes,
        is_revoked,
        created_by,
        expires_at,
        resource,
        oauth_client_id
    )
    VALUES (
        v_rt.workspace_id,
        p_token_name,
        p_token_name,
        p_new_access_token_hash,
        p_new_access_token_prefix,
        v_effective_scopes,
        false,
        v_rt.user_id,
        p_access_expires_at,
        v_rt.resource,
        v_rt.client_id
    )
    RETURNING id INTO v_new_access_id;

    -- 10. Mint rotated refresh token in same grant family
    INSERT INTO public.oauth_refresh_tokens (
        token_hash,
        grant_id,
        access_token_id,
        client_id,
        user_id,
        workspace_id,
        scopes,
        resource,
        expires_at
    )
    VALUES (
        p_new_refresh_token_hash,
        v_rt.grant_id,
        v_new_access_id,
        v_rt.client_id,
        v_rt.user_id,
        v_rt.workspace_id,
        v_effective_scopes,
        v_rt.resource,
        p_refresh_expires_at
    );

    RETURN QUERY SELECT
        TRUE,
        NULL::TEXT,
        NULL::TEXT,
        v_new_access_id,
        v_rt.access_token_id,
        v_rt.workspace_id,
        v_rt.user_id,
        v_effective_scopes,
        v_rt.resource;
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY & STRICT SERVICE_ROLE PRIVILEGE HARDENING
-- ------------------------------------------------------------------------------

ALTER TABLE public.oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.oauth_clients FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.oauth_authorization_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.oauth_refresh_tokens FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.oauth_clients TO service_role;
GRANT ALL ON public.oauth_authorization_codes TO service_role;
GRANT ALL ON public.oauth_refresh_tokens TO service_role;

REVOKE ALL ON FUNCTION public.prevent_ai_token_tampering() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cascade_revoke_oauth_refresh_tokens() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.exchange_oauth_authorization_code(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.exchange_oauth_authorization_code(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION public.rotate_oauth_refresh_token(
    TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rotate_oauth_refresh_token(
    TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;
