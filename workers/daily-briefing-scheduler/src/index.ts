/**
 * Miler Daily Briefing - Cloudflare Worker Cron Trigger Handler
 *
 * Runs on a 5-minute cron schedule on Cloudflare's global edge network (initially crons = [] until approved).
 * Dispatches an authenticated request to the Vercel Preview cron endpoint:
 *   /api/cron/daily-briefing
 *
 * Operational Safeguards:
 * 1. Strict Host & Path Allowlist: Strictly targets approved staging Preview URL and /api/cron/daily-briefing.
 * 2. Authenticates via constant-time `Authorization: Bearer <CRON_SECRET>`.
 * 3. Bypasses Vercel Deployment Protection via `x-vercel-protection-bypass` header.
 * 4. Sets `redirect: 'manual'` to immediately detect Vercel SSO protection challenges without following.
 * 5. Never automatically retries on timeout or ambiguous network outcomes.
 * 6. Never logs secrets (`CRON_SECRET`, `VERCEL_PROTECTION_BYPASS_SECRET`).
 * 7. Fits comfortably inside Cloudflare Worker free-tier limits:
 *    - 288 runs/day (<0.3% of 100,000 requests/day).
 *    - <1ms CPU time/execution (limit: 10ms CPU time).
 */

import { timingSafeEqual, createHash } from 'node:crypto';

export interface Env {
  ENVIRONMENT?: 'staging' | 'production';
  TARGET_URL: string;
  CRON_SECRET: string;
  VERCEL_PROTECTION_BYPASS_SECRET?: string;
  REQUEST_TIMEOUT_MS?: string;
  ALLOW_MANUAL_TRIGGER?: string;
}

export interface SchedulerExecutionResult {
  ok: boolean;
  statusCode: number;
  statusText: string;
  durationMs: number;
  body?: unknown;
  error?: string;
}

// Strict allowlist parameters
export const ALLOWED_STAGING_HOST = 'miler-creater-git-feat-daily-briefin-f2acc6-temo-ctrls-projects.vercel.app';
export const ALLOWED_PRODUCTION_HOST = 'miler-creater.vercel.app';
export const ALLOWED_CRON_PATH = '/api/cron/daily-briefing';
export const PRODUCTION_SUPABASE_REF = 'zcpdpizrbaaekteurwup';

export function timingSafeTokenCompare(provided: string | null, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function validateTargetUrl(
  rawUrl: string,
  environment: 'staging' | 'production' = 'staging'
): { valid: boolean; error?: string; url?: URL } {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'TARGET_URL is required' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, error: 'TARGET_URL is not a valid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, error: `Disallowed protocol "${parsed.protocol}". Only https: is permitted` };
  }

  const expectedHost = environment === 'production' ? ALLOWED_PRODUCTION_HOST : ALLOWED_STAGING_HOST;

  if (parsed.hostname !== expectedHost) {
    return {
      valid: false,
      error: `Disallowed host "${parsed.hostname}". Strictly restricted to ${expectedHost}`,
    };
  }

  if (parsed.pathname !== ALLOWED_CRON_PATH) {
    return { valid: false, error: `Disallowed path "${parsed.pathname}". Strictly restricted to ${ALLOWED_CRON_PATH}` };
  }

  if (parsed.search || parsed.hash) {
    return { valid: false, error: 'TARGET_URL must not contain query parameters or hash fragments' };
  }

  if (environment === 'staging' && rawUrl.includes(PRODUCTION_SUPABASE_REF)) {
    return { valid: false, error: 'Refusing to execute against production project reference' };
  }

  return { valid: true, url: parsed };
}

export async function triggerDailyBriefingCron(
  env: Env,
  source: 'cron' | 'manual' = 'cron'
): Promise<SchedulerExecutionResult> {
  const startTime = Date.now();

  const cronSecret = env.CRON_SECRET?.trim();
  const bypassSecret = env.VERCEL_PROTECTION_BYPASS_SECRET?.trim();
  const timeoutMs = parseInt(env.REQUEST_TIMEOUT_MS || '20000', 10) || 20000;

  const environment = env.ENVIRONMENT === 'production' ? 'production' : 'staging';

  // Strict host, protocol, path, and production isolation validation
  const validation = validateTargetUrl(env.TARGET_URL, environment);
  if (!validation.valid || !validation.url) {
    console.error(`[Daily Briefing Scheduler] [${source}] Configuration/Target Guard Violation: ${validation.error}`);
    return {
      ok: false,
      statusCode: 0,
      statusText: 'TARGET_GUARD_VIOLATION',
      durationMs: 0,
      error: validation.error,
    };
  }

  const targetUrl = validation.url.toString();

  if (!cronSecret) {
    console.error(`[Daily Briefing Scheduler] [${source}] Configuration Error: CRON_SECRET is not configured.`);
    return {
      ok: false,
      statusCode: 0,
      statusText: 'CONFIG_ERROR',
      durationMs: 0,
      error: 'CRON_SECRET is required',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${cronSecret}`,
    'User-Agent': 'Miler-Cloudflare-Cron-Scheduler/1.0',
    'Accept': 'application/json',
  };

  if (bypassSecret) {
    headers['x-vercel-protection-bypass'] = bypassSecret;
  }

  try {
    // Crucial: redirect: 'manual' ensures we do NOT automatically follow Vercel SSO redirects
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
      redirect: 'manual',
    });

    clearTimeout(timer);
    const durationMs = Date.now() - startTime;
    const statusCode = response.status;
    const statusText = response.statusText;

    // Detect Vercel Deployment Protection SSO redirect (301, 302, 307, 308)
    if (statusCode >= 300 && statusCode < 400) {
      const location = response.headers.get('location') || 'unknown';
      console.warn(
        `[Daily Briefing Scheduler] [${source}] Target responded with redirect (HTTP ${statusCode}). ` +
        `Likely Vercel Deployment Protection intercepting the request. Location: ${location.split('?')[0]}. ` +
        `Ensure VERCEL_PROTECTION_BYPASS_SECRET is configured.`
      );
      return {
        ok: false,
        statusCode,
        statusText,
        durationMs,
        error: `Redirected to ${location.split('?')[0]} (Deployment protection active)`,
      };
    }

    if (statusCode === 401) {
      console.error(
        `[Daily Briefing Scheduler] [${source}] HTTP 401 Unauthorized from target. Check CRON_SECRET.`
      );
      return {
        ok: false,
        statusCode,
        statusText,
        durationMs,
        error: 'Target rejected CRON_SECRET as unauthorized',
      };
    }

    if (statusCode === 403) {
      console.error(
        `[Daily Briefing Scheduler] [${source}] HTTP 403 Forbidden from target. Check target configuration / project ref.`
      );
      return {
        ok: false,
        statusCode,
        statusText,
        durationMs,
        error: 'Target returned 403 Forbidden',
      };
    }

    if (statusCode === 429) {
      console.warn(
        `[Daily Briefing Scheduler] [${source}] HTTP 429 Rate Limited from target.`
      );
      return {
        ok: false,
        statusCode,
        statusText,
        durationMs,
        error: 'Target rate limited the request',
      };
    }

    if (statusCode >= 500) {
      console.error(
        `[Daily Briefing Scheduler] [${source}] HTTP ${statusCode} Server Error from target.`
      );
      return {
        ok: false,
        statusCode,
        statusText,
        durationMs,
        error: `Target server error HTTP ${statusCode}`,
      };
    }

    let parsedBody: unknown = null;
    try {
      parsedBody = await response.json();
    } catch {
      parsedBody = null;
    }

    const isSuccess = statusCode >= 200 && statusCode < 300;
    const resultObj = parsedBody as Record<string, unknown> | null;
    const enqueueObj = resultObj?.enqueue as Record<string, unknown> | undefined;
    const dispatchObj = resultObj?.dispatch as Record<string, unknown> | undefined;

    console.log(
      `[Daily Briefing Scheduler] [${source}] Tick completed: HTTP ${statusCode} (${durationMs}ms), ` +
      `enabled=${resultObj?.enabled ?? 'unknown'}, ` +
      `enqueued=${enqueueObj?.enqueued ?? 0}, ` +
      `claimed=${dispatchObj?.claimed ?? 0}, ` +
      `sent=${dispatchObj?.sent ?? 0}`
    );

    return {
      ok: isSuccess,
      statusCode,
      statusText,
      durationMs,
      body: parsedBody,
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    const durationMs = Date.now() - startTime;
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const errorMessage = isTimeout
      ? `Request timed out after ${timeoutMs}ms`
      : err instanceof Error
      ? err.message
      : 'Network or fetch failure';

    console.error(`[Daily Briefing Scheduler] [${source}] Execution failed (${durationMs}ms): ${errorMessage}`);

    return {
      ok: false,
      statusCode: isTimeout ? 504 : 0,
      statusText: isTimeout ? 'TIMEOUT' : 'FETCH_ERROR',
      durationMs,
      error: errorMessage,
    };
  }
}

const worker = {
  /**
   * Cloudflare Cron Trigger entrypoint
   */
  async scheduled(event: { cron: string; scheduledTime: number }, env: Env, ctx?: { waitUntil: (p: Promise<unknown>) => void }): Promise<void> {
    const promise = triggerDailyBriefingCron(env, 'cron');
    if (ctx?.waitUntil) {
      ctx.waitUntil(promise);
    }
    await promise;
  },

  /**
   * Manual invocation / health-check endpoint (HTTP GET/POST)
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(
        JSON.stringify({
          service: env.ENVIRONMENT === 'production' ? 'miler-daily-briefing-scheduler-production' : 'miler-daily-briefing-scheduler',
          environment: env.ENVIRONMENT === 'production' ? 'production' : 'staging',
          status: 'healthy',
          targetConfigured: Boolean(env.TARGET_URL),
          hasCronSecret: Boolean(env.CRON_SECRET),
          hasBypassSecret: Boolean(env.VERCEL_PROTECTION_BYPASS_SECRET),
          manualTriggerAllowed: env.ALLOW_MANUAL_TRIGGER === 'true',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Manual test trigger endpoint
    if (url.pathname === '/trigger') {
      // 1. Safeguard: Strictly require ALLOW_MANUAL_TRIGGER === 'true' (fail-closed if missing, false, or unexpected)
      if (env.ALLOW_MANUAL_TRIGGER !== 'true') {
        return new Response(JSON.stringify({ error: 'Manual trigger is disabled' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 2. Safeguard: Strictly enforce POST method
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json', 'Allow': 'POST' },
        });
      }

      // 3. Safeguard: Strong constant-time Bearer authentication check
      const authHeader = request.headers.get('Authorization');
      const expectedSecret = env.CRON_SECRET?.trim();

      if (!expectedSecret || !timingSafeTokenCompare(authHeader, `Bearer ${expectedSecret}`)) {
        return new Response(JSON.stringify({ error: 'Unauthorized manual trigger' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 4. Safeguard: Execute trigger strictly against allowlisted TARGET_URL (arbitrary URLs rejected)
      const result = await triggerDailyBriefingCron(env, 'manual');
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

export default worker;
