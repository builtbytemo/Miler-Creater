/**
 * Miler Daily Briefing - Cloudflare Worker Cron Trigger Handler
 *
 * Runs on a 5-minute cron schedule (`* /5 * * * *`) on Cloudflare's global edge network.
 * Dispatches an authenticated request to the Vercel Preview cron endpoint:
 *   /api/cron/daily-briefing
 *
 * Operational Safeguards:
 * 1. Authenticates via `Authorization: Bearer <CRON_SECRET>`.
 * 2. Bypasses Vercel Deployment Protection via `x-vercel-protection-bypass` header.
 * 3. Sets `redirect: 'manual'` to immediately detect Vercel SSO protection challenges.
 * 4. Never automatically retries on timeout or ambiguous network outcomes.
 * 5. Never logs secrets (`CRON_SECRET`, `VERCEL_PROTECTION_BYPASS_SECRET`).
 * 6. Fits comfortably inside Cloudflare Worker free-tier limits:
 *    - 288 runs/day (<0.3% of 100,000 requests/day).
 *    - <1ms CPU time/execution (limit: 10ms CPU time).
 */

export interface Env {
  TARGET_URL: string;
  CRON_SECRET: string;
  VERCEL_PROTECTION_BYPASS_SECRET?: string;
  REQUEST_TIMEOUT_MS?: string;
}

export interface SchedulerExecutionResult {
  ok: boolean;
  statusCode: number;
  statusText: string;
  durationMs: number;
  body?: unknown;
  error?: string;
}

export async function triggerDailyBriefingCron(
  env: Env,
  source: 'cron' | 'manual' = 'cron'
): Promise<SchedulerExecutionResult> {
  const startTime = Date.now();

  const targetUrl = env.TARGET_URL?.trim();
  const cronSecret = env.CRON_SECRET?.trim();
  const bypassSecret = env.VERCEL_PROTECTION_BYPASS_SECRET?.trim();
  const timeoutMs = parseInt(env.REQUEST_TIMEOUT_MS || '20000', 10) || 20000;

  if (!targetUrl) {
    console.error(`[Daily Briefing Scheduler] [${source}] Configuration Error: TARGET_URL is not defined.`);
    return {
      ok: false,
      statusCode: 0,
      statusText: 'CONFIG_ERROR',
      durationMs: 0,
      error: 'TARGET_URL is required',
    };
  }

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

  // Safety check: protect against accidental production targeting
  if (targetUrl.includes('zcpdpizrbaaekteurwup')) {
    console.error(
      `[Daily Briefing Scheduler] [${source}] Target Guard Violation: TARGET_URL references production Supabase project ref!`
    );
    return {
      ok: false,
      statusCode: 0,
      statusText: 'TARGET_GUARD_VIOLATION',
      durationMs: 0,
      error: 'Refusing to execute against production project reference',
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
        `[Daily Briefing Scheduler] [${source}] HTTP 403 Forbidden from target. Check Vercel protection headers.`
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
    } else {
      await promise;
    }
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
          service: 'miler-daily-briefing-scheduler',
          status: 'healthy',
          targetConfigured: Boolean(env.TARGET_URL),
          hasCronSecret: Boolean(env.CRON_SECRET),
          hasBypassSecret: Boolean(env.VERCEL_PROTECTION_BYPASS_SECRET),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Manual test trigger endpoint
    if (url.pathname === '/trigger') {
      const authHeader = request.headers.get('Authorization');
      const expectedSecret = env.CRON_SECRET?.trim();

      // Require same secret to manually trigger via HTTP
      if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
        return new Response(JSON.stringify({ error: 'Unauthorized manual trigger' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

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
