-- Migration: 20261111000003_daily_briefing_delivery.sql
-- Daily Briefing delivery infrastructure (Email + Telegram).
-- Infrastructure only: no briefing content is generated here.
-- Existing notification_preferences / notifications tables are NOT modified.

BEGIN;

-- ============================================================================
-- 1. PER-USER PREFERENCES (default: everything disabled)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.daily_briefing_preferences (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT false,
    email_enabled BOOLEAN NOT NULL DEFAULT false,
    telegram_enabled BOOLEAN NOT NULL DEFAULT false,
    timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
    delivery_local_time TIME NOT NULL DEFAULT '00:00',
    email_consent_at TIMESTAMPTZ,
    last_test_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.daily_briefing_preferences_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.timezone) THEN
        RAISE EXCEPTION 'Invalid IANA timezone: %', NEW.timezone;
    END IF;
    -- Explicit consent is recorded server-side when email delivery is switched on.
    IF NEW.email_enabled AND (TG_OP = 'INSERT' OR NOT OLD.email_enabled OR NEW.email_consent_at IS NULL) THEN
        NEW.email_consent_at := now();
    ELSIF NOT NEW.email_enabled THEN
        NEW.email_consent_at := NULL;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_daily_briefing_preferences_guard ON public.daily_briefing_preferences;
CREATE TRIGGER trg_daily_briefing_preferences_guard
    BEFORE INSERT OR UPDATE ON public.daily_briefing_preferences
    FOR EACH ROW EXECUTE FUNCTION public.daily_briefing_preferences_guard();

ALTER TABLE public.daily_briefing_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_briefing_prefs_select_own" ON public.daily_briefing_preferences
    FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "daily_briefing_prefs_insert_own" ON public.daily_briefing_preferences
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "daily_briefing_prefs_update_own" ON public.daily_briefing_preferences
    FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Column-level grants: clients cannot forge consent / rate-limit columns.
REVOKE ALL ON public.daily_briefing_preferences FROM anon, authenticated;
GRANT SELECT ON public.daily_briefing_preferences TO authenticated;
GRANT INSERT (user_id, enabled, email_enabled, telegram_enabled, timezone, delivery_local_time)
    ON public.daily_briefing_preferences TO authenticated;
GRANT UPDATE (enabled, email_enabled, telegram_enabled, timezone, delivery_local_time)
    ON public.daily_briefing_preferences TO authenticated;
GRANT ALL ON public.daily_briefing_preferences TO service_role;

CREATE INDEX IF NOT EXISTS idx_daily_briefing_prefs_enabled
    ON public.daily_briefing_preferences(user_id) WHERE enabled;

-- ============================================================================
-- 2. TELEGRAM CONNECTIONS (verified destinations) + ONE-TIME LINK TOKENS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.telegram_connections (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    chat_id BIGINT NOT NULL UNIQUE,
    telegram_username TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "telegram_connections_select_own" ON public.telegram_connections
    FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "telegram_connections_delete_own" ON public.telegram_connections
    FOR DELETE TO authenticated USING (user_id = auth.uid());

-- chat_id is never readable by clients.
REVOKE ALL ON public.telegram_connections FROM anon, authenticated;
GRANT SELECT (user_id, telegram_username, status, linked_at) ON public.telegram_connections TO authenticated;
GRANT DELETE ON public.telegram_connections TO authenticated;
GRANT ALL ON public.telegram_connections TO service_role;

CREATE TABLE IF NOT EXISTS public.telegram_link_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_user ON public.telegram_link_tokens(user_id, created_at DESC);

ALTER TABLE public.telegram_link_tokens ENABLE ROW LEVEL SECURITY;  -- no policies: no direct client access
REVOKE ALL ON public.telegram_link_tokens FROM anon, authenticated;
GRANT ALL ON public.telegram_link_tokens TO service_role;

-- Webhook replay protection (Telegram update_id is unique per bot).
CREATE TABLE IF NOT EXISTS public.telegram_webhook_updates (
    update_id BIGINT PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_webhook_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_webhook_updates FROM anon, authenticated;
GRANT ALL ON public.telegram_webhook_updates TO service_role;

-- Authenticated user creates a token for THEMSELVES only (no service role needed).
CREATE OR REPLACE FUNCTION public.create_telegram_link_token(p_token_hash TEXT, p_ttl_seconds INT DEFAULT 600)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_expires TIMESTAMPTZ;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_ttl_seconds < 60 OR p_ttl_seconds > 900 THEN
        RAISE EXCEPTION 'Invalid token lifetime';
    END IF;
    IF (SELECT count(*) FROM public.telegram_link_tokens
        WHERE user_id = v_uid AND created_at > now() - interval '1 hour') >= 10 THEN
        RAISE EXCEPTION 'Too many link attempts; try again later' USING ERRCODE = '54000';
    END IF;
    -- Invalidate any previous unconsumed token.
    UPDATE public.telegram_link_tokens SET consumed_at = now()
        WHERE user_id = v_uid AND consumed_at IS NULL;
    v_expires := now() + make_interval(secs => p_ttl_seconds);
    INSERT INTO public.telegram_link_tokens(user_id, token_hash, expires_at)
        VALUES (v_uid, p_token_hash, v_expires);
    RETURN v_expires;
END;
$$;

-- Atomic one-time consumption; called only by the webhook (service role).
-- Returns: 'linked' | 'invalid' | 'chat_in_use'
CREATE OR REPLACE FUNCTION public.consume_telegram_link_token(p_token_hash TEXT, p_chat_id BIGINT, p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_user UUID;
BEGIN
    UPDATE public.telegram_link_tokens
        SET consumed_at = now()
        WHERE token_hash = p_token_hash AND consumed_at IS NULL AND expires_at > now()
        RETURNING user_id INTO v_user;
    IF v_user IS NULL THEN
        RETURN 'invalid';
    END IF;
    IF EXISTS (SELECT 1 FROM public.telegram_connections WHERE chat_id = p_chat_id AND user_id <> v_user) THEN
        RETURN 'chat_in_use';
    END IF;
    INSERT INTO public.telegram_connections(user_id, chat_id, telegram_username, status)
        VALUES (v_user, p_chat_id, p_username, 'active')
    ON CONFLICT (user_id) DO UPDATE
        SET chat_id = EXCLUDED.chat_id, telegram_username = EXCLUDED.telegram_username,
            status = 'active', linked_at = now(), status_changed_at = now();
    RETURN 'linked';
END;
$$;

-- ============================================================================
-- 3. DELIVERY QUEUE + ATTEMPTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.briefing_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (channel IN ('email', 'telegram')),
    local_date DATE NOT NULL,
    timezone TEXT NOT NULL,
    scheduled_for TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'claimed', 'retry', 'sent', 'failed', 'skipped', 'ambiguous')),
    attempt_count INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claim_token UUID,
    claimed_at TIMESTAMPTZ,
    claim_expires_at TIMESTAMPTZ,
    last_error_code TEXT,
    last_error_message TEXT,
    provider_message_id TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One delivery per user, channel and local day: no duplicate queue records.
    CONSTRAINT uq_briefing_delivery_slot UNIQUE (user_id, channel, local_date)
);
CREATE INDEX IF NOT EXISTS idx_briefing_deliveries_due
    ON public.briefing_deliveries(next_attempt_at) WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS idx_briefing_deliveries_lease
    ON public.briefing_deliveries(claim_expires_at) WHERE status = 'claimed';
CREATE INDEX IF NOT EXISTS idx_briefing_deliveries_user
    ON public.briefing_deliveries(user_id, local_date DESC);

CREATE TABLE IF NOT EXISTS public.briefing_delivery_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id UUID NOT NULL REFERENCES public.briefing_deliveries(id) ON DELETE CASCADE,
    attempt_no INT NOT NULL,
    outcome TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    CONSTRAINT uq_briefing_attempt UNIQUE (delivery_id, attempt_no)
);

ALTER TABLE public.briefing_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefing_delivery_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "briefing_deliveries_select_own" ON public.briefing_deliveries
    FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "briefing_attempts_select_own" ON public.briefing_delivery_attempts
    FOR SELECT TO authenticated USING (
        EXISTS (SELECT 1 FROM public.briefing_deliveries d
                WHERE d.id = delivery_id AND d.user_id = auth.uid()));

REVOKE ALL ON public.briefing_deliveries, public.briefing_delivery_attempts FROM anon, authenticated;
GRANT SELECT (id, user_id, channel, local_date, timezone, scheduled_for, status, attempt_count, completed_at)
    ON public.briefing_deliveries TO authenticated;
GRANT ALL ON public.briefing_deliveries, public.briefing_delivery_attempts TO service_role;

-- Transactional claiming. Expired leases (crashed worker) become 'ambiguous' and are
-- NOT retried automatically, since the provider call may or may not have happened.
CREATE OR REPLACE FUNCTION public.claim_briefing_deliveries(p_limit INT DEFAULT 25, p_lease_seconds INT DEFAULT 300)
RETURNS SETOF public.briefing_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
    WITH expired AS (
        UPDATE public.briefing_deliveries
           SET status = 'ambiguous', last_error_code = 'lease_expired',
               last_error_message = 'Worker lease expired; delivery outcome unknown',
               claim_token = NULL, completed_at = now(), updated_at = now()
         WHERE status = 'claimed' AND claim_expires_at < now()
        RETURNING id, attempt_count
    )
    INSERT INTO public.briefing_delivery_attempts(delivery_id, attempt_no, outcome, error_code, finished_at)
        SELECT id, attempt_count, 'ambiguous', 'lease_expired', now() FROM expired
    ON CONFLICT (delivery_id, attempt_no) DO UPDATE
        SET outcome = 'ambiguous', error_code = 'lease_expired', finished_at = now();

    RETURN QUERY
    WITH due AS (
        SELECT id FROM public.briefing_deliveries
         WHERE status IN ('pending', 'retry') AND next_attempt_at <= now()
         ORDER BY next_attempt_at
         LIMIT GREATEST(1, LEAST(p_limit, 100))
         FOR UPDATE SKIP LOCKED
    )
    UPDATE public.briefing_deliveries d
       SET status = 'claimed', claim_token = gen_random_uuid(), claimed_at = now(),
           claim_expires_at = now() + make_interval(secs => p_lease_seconds),
           attempt_count = d.attempt_count + 1, updated_at = now()
      FROM due WHERE d.id = due.id
    RETURNING d.*;
END;
$$;

-- Completes an attempt. Only the holder of the current claim_token may finalize,
-- which also makes duplicate/late callbacks harmless (returns false).
CREATE OR REPLACE FUNCTION public.finalize_briefing_delivery(
    p_id UUID, p_claim_token UUID, p_outcome TEXT,
    p_error_code TEXT DEFAULT NULL, p_error_message TEXT DEFAULT NULL,
    p_provider_message_id TEXT DEFAULT NULL, p_retry_after_seconds INT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    d public.briefing_deliveries;
    v_status TEXT := p_outcome;
    v_delay INT;
BEGIN
    IF p_outcome NOT IN ('sent', 'retry', 'failed', 'skipped', 'ambiguous') THEN
        RAISE EXCEPTION 'Invalid outcome';
    END IF;
    SELECT * INTO d FROM public.briefing_deliveries
        WHERE id = p_id AND claim_token = p_claim_token AND status = 'claimed' FOR UPDATE;
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    IF p_outcome = 'retry' AND d.attempt_count >= d.max_attempts THEN
        v_status := 'failed';
        p_error_code := COALESCE(p_error_code, 'retries_exhausted');
    END IF;
    v_delay := GREATEST(LEAST(3600, 60 * (2 ^ LEAST(d.attempt_count - 1, 10))::INT), COALESCE(p_retry_after_seconds, 0));
    UPDATE public.briefing_deliveries SET
        status = v_status,
        claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
        next_attempt_at = CASE WHEN v_status = 'retry' THEN now() + make_interval(secs => v_delay) ELSE next_attempt_at END,
        last_error_code = p_error_code,
        last_error_message = LEFT(p_error_message, 300),
        provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
        completed_at = CASE WHEN v_status = 'retry' THEN NULL ELSE now() END,
        updated_at = now()
    WHERE id = p_id;
    INSERT INTO public.briefing_delivery_attempts(delivery_id, attempt_no, outcome, error_code, error_message, finished_at)
        VALUES (p_id, d.attempt_count, v_status, p_error_code, LEFT(p_error_message, 300), now())
    ON CONFLICT (delivery_id, attempt_no) DO UPDATE
        SET outcome = EXCLUDED.outcome, error_code = EXCLUDED.error_code,
            error_message = EXCLUDED.error_message, finished_at = now();
    RETURN true;
END;
$$;

-- ============================================================================
-- 4. PRIVILEGE HARDENING: privileged functions are service_role only,
--    except create_telegram_link_token which acts strictly on auth.uid().
-- ============================================================================
REVOKE ALL ON FUNCTION public.consume_telegram_link_token(TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_briefing_deliveries(INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_briefing_delivery(UUID, UUID, TEXT, TEXT, TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_telegram_link_token(TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_telegram_link_token(TEXT, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_briefing_deliveries(INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_briefing_delivery(UUID, UUID, TEXT, TEXT, TEXT, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_telegram_link_token(TEXT, INT) TO authenticated;

COMMIT;
