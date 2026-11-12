/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker, {
  triggerDailyBriefingCron,
  validateTargetUrl,
  ALLOWED_STAGING_HOST,
  ALLOWED_PRODUCTION_HOST,
  ALLOWED_CRON_PATH,
  type Env,
} from '../workers/daily-briefing-scheduler/src/index';

describe('Cloudflare Worker Daily Briefing Scheduler Suite', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const validTargetUrl = `https://${ALLOWED_STAGING_HOST}${ALLOWED_CRON_PATH}`;

  const validEnv: Env = {
    TARGET_URL: validTargetUrl,
    CRON_SECRET: 'test-cron-secret-cf-12345',
    VERCEL_PROTECTION_BYPASS_SECRET: 'test-bypass-secret-xyz987',
    REQUEST_TIMEOUT_MS: '5000',
    ALLOW_MANUAL_TRIGGER: 'true',
  };

  describe('Target URL Strict Allowlist & Production Isolation Validation', () => {
    it('accepts valid staging preview URL with exact host, https protocol, and exact cron path', () => {
      const res = validateTargetUrl(validTargetUrl, 'staging');
      expect(res.valid).toBe(true);
      expect(res.url?.hostname).toBe(ALLOWED_STAGING_HOST);
      expect(res.url?.pathname).toBe(ALLOWED_CRON_PATH);
    });

    it('accepts valid production URL with exact host when environment is production', () => {
      const prodUrl = `https://${ALLOWED_PRODUCTION_HOST}${ALLOWED_CRON_PATH}`;
      const res = validateTargetUrl(prodUrl, 'production');
      expect(res.valid).toBe(true);
      expect(res.url?.hostname).toBe(ALLOWED_PRODUCTION_HOST);
      expect(res.url?.pathname).toBe(ALLOWED_CRON_PATH);
    });

    it('rejects production host when environment is staging', () => {
      const prodUrl = `https://${ALLOWED_PRODUCTION_HOST}${ALLOWED_CRON_PATH}`;
      const res = validateTargetUrl(prodUrl, 'staging');
      expect(res.valid).toBe(false);
      expect(res.error).toContain(`Strictly restricted to ${ALLOWED_STAGING_HOST}`);
    });

    it('rejects staging preview host when environment is production', () => {
      const res = validateTargetUrl(validTargetUrl, 'production');
      expect(res.valid).toBe(false);
      expect(res.error).toContain(`Strictly restricted to ${ALLOWED_PRODUCTION_HOST}`);
    });

    it('rejects missing or empty TARGET_URL', () => {
      expect(validateTargetUrl('')).toMatchObject({ valid: false, error: 'TARGET_URL is required' });
    });

    it('rejects invalid URL string', () => {
      expect(validateTargetUrl('not-a-valid-url')).toMatchObject({
        valid: false,
        error: 'TARGET_URL is not a valid URL',
      });
    });

    it('rejects non-https protocol', () => {
      const res = validateTargetUrl(`http://${ALLOWED_STAGING_HOST}${ALLOWED_CRON_PATH}`);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Only https: is permitted');
    });

    it('rejects disallowed hostnames even if path is correct', () => {
      const res = validateTargetUrl(`https://evil-host.com${ALLOWED_CRON_PATH}`);
      expect(res.valid).toBe(false);
      expect(res.error).toContain(`Strictly restricted to ${ALLOWED_STAGING_HOST}`);
    });

    it('rejects disallowed pathnames even if host is correct', () => {
      const res = validateTargetUrl(`https://${ALLOWED_STAGING_HOST}/api/cron/reminders`);
      expect(res.valid).toBe(false);
      expect(res.error).toContain(`Strictly restricted to ${ALLOWED_CRON_PATH}`);
    });

    it('rejects query parameters or hash fragments', () => {
      const resWithQuery = validateTargetUrl(`${validTargetUrl}?foo=bar`);
      expect(resWithQuery.valid).toBe(false);
      expect(resWithQuery.error).toContain('must not contain query parameters or hash fragments');

      const resWithHash = validateTargetUrl(`${validTargetUrl}#section`);
      expect(resWithHash.valid).toBe(false);
      expect(resWithHash.error).toContain('must not contain query parameters or hash fragments');
    });

    it('refuses to execute if TARGET_URL references production Supabase project ref', () => {
      const res = validateTargetUrl(`https://${ALLOWED_STAGING_HOST}${ALLOWED_CRON_PATH}?db=zcpdpizrbaaekteurwup`);
      expect(res.valid).toBe(false);
    });
  });

  describe('triggerDailyBriefingCron execution & HTTP handling', () => {
    it('fails closed when TARGET_URL fails validation', async () => {
      const env: Env = { ...validEnv, TARGET_URL: 'https://unexpected-host.com/api/cron' };
      const result = await triggerDailyBriefingCron(env);
      expect(result.ok).toBe(false);
      expect(result.statusText).toBe('TARGET_GUARD_VIOLATION');
      expect(result.error).toContain(ALLOWED_STAGING_HOST);
    });

    it('fails closed when CRON_SECRET is missing or whitespace-only', async () => {
      const env: Env = { ...validEnv, CRON_SECRET: '   ' };
      const result = await triggerDailyBriefingCron(env);
      expect(result.ok).toBe(false);
      expect(result.statusText).toBe('CONFIG_ERROR');
      expect(result.error).toBe('CRON_SECRET is required');
    });

    it('sends correct headers including Authorization and x-vercel-protection-bypass with redirect manual', async () => {
      let capturedUrl = '';
      let capturedInit: RequestInit | undefined;

      global.fetch = vi.fn().mockImplementation(async (url: any, init: any) => {
        capturedUrl = String(url);
        capturedInit = init;
        return new Response(
          JSON.stringify({
            success: true,
            enabled: false,
            message: 'Daily Briefing delivery is disabled',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      });

      const result = await triggerDailyBriefingCron(validEnv);

      expect(result.ok).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(capturedUrl).toBe(validEnv.TARGET_URL);
      expect(capturedInit?.redirect).toBe('manual');

      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Bearer ${validEnv.CRON_SECRET}`);
      expect(headers['x-vercel-protection-bypass']).toBe(validEnv.VERCEL_PROTECTION_BYPASS_SECRET);
      expect(headers['User-Agent']).toContain('Miler-Cloudflare-Cron-Scheduler');
    });

    it('detects Vercel SSO redirect (HTTP 302) and fails closed without following', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          statusText: 'Found',
          headers: {
            Location: 'https://vercel.com/sso-api?teamSlug=temo-ctrls-projects',
          },
        })
      );

      const result = await triggerDailyBriefingCron(validEnv);

      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(302);
      expect(result.error).toContain('Deployment protection active');
    });

    it('handles HTTP 401 Unauthorized from target', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          statusText: 'Unauthorized',
        })
      );

      const result = await triggerDailyBriefingCron(validEnv);

      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(result.error).toContain('unauthorized');
    });

    it('handles HTTP 403 Forbidden from target', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Refusing to execute cron against production Supabase instance' }), {
          status: 403,
          statusText: 'Forbidden',
        })
      );

      const result = await triggerDailyBriefingCron(validEnv);

      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.error).toContain('403 Forbidden');
    });

    it('handles HTTP 429 Rate Limited from target', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Too Many Requests' }), {
          status: 429,
          statusText: 'Too Many Requests',
        })
      );

      const result = await triggerDailyBriefingCron(validEnv);

      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(429);
      expect(result.error).toBe('Target rate limited the request');
    });

    it('handles HTTP 500 / 502 server errors from target', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          statusText: 'Internal Server Error',
        })
      );

      const result = await triggerDailyBriefingCron(validEnv);

      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.error).toContain('HTTP 500');
    });

    it('handles network timeout (AbortError) cleanly', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        return Promise.reject(abortError);
      });

      const result = await triggerDailyBriefingCron(validEnv);

      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(504);
      expect(result.statusText).toBe('TIMEOUT');
      expect(result.error).toContain('timed out');
    });
  });

  describe('Worker Interface Handlers (scheduled & fetch)', () => {
    it('worker default scheduled handler awaits execution promise and calls waitUntil', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, enabled: false }), { status: 200 })
      );

      const waitUntilMock = vi.fn();
      await worker.scheduled(
        { cron: '*/5 * * * *', scheduledTime: Date.now() },
        validEnv,
        { waitUntil: waitUntilMock }
      );

      expect(waitUntilMock).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalled();
    });

    it('worker fetch handler responds to /health without leaking secrets', async () => {
      const req = new Request('https://worker.local/health');
      const res = await worker.fetch(req, validEnv);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        service: 'miler-daily-briefing-scheduler',
        environment: 'staging',
        status: 'healthy',
        targetConfigured: true,
        hasCronSecret: true,
        hasBypassSecret: true,
        manualTriggerAllowed: true,
      });

      // When ENVIRONMENT is production, reports production service and environment
      const prodRes = await worker.fetch(req, { ...validEnv, ENVIRONMENT: 'production' });
      const prodBody = await prodRes.json();
      expect(prodBody.service).toBe('miler-daily-briefing-scheduler-production');
      expect(prodBody.environment).toBe('production');

      // When ALLOW_MANUAL_TRIGGER is missing or not 'true', health reports manualTriggerAllowed: false
      const disabledRes = await worker.fetch(req, { ...validEnv, ALLOW_MANUAL_TRIGGER: undefined });
      const disabledBody = await disabledRes.json();
      expect(disabledBody.manualTriggerAllowed).toBe(false);
    });

    it('rejects GET on /trigger with HTTP 405 Method Not Allowed', async () => {
      const getReq = new Request('https://worker.local/trigger', { method: 'GET' });
      const getRes = await worker.fetch(getReq, validEnv);

      expect(getRes.status).toBe(405);
      const body = await getRes.json();
      expect(body.error).toContain('Method Not Allowed');
    });

    it('rejects /trigger when ALLOW_MANUAL_TRIGGER is false, undefined, or unexpected with HTTP 403', async () => {
      const invalidValues = ['false', undefined, '', '1', 'yes', 'TRUE', '0', 'disabled'];

      for (const val of invalidValues) {
        const testEnv: Env = { ...validEnv, ALLOW_MANUAL_TRIGGER: val };
        const req = new Request('https://worker.local/trigger', {
          method: 'POST',
          headers: { Authorization: `Bearer ${validEnv.CRON_SECRET}` },
        });
        const res = await worker.fetch(req, testEnv);

        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toContain('Manual trigger is disabled');
      }
    });

    it('rejects unauthenticated or invalid /trigger request with HTTP 401', async () => {
      // Missing auth header
      const noAuthReq = new Request('https://worker.local/trigger', { method: 'POST' });
      const noAuthRes = await worker.fetch(noAuthReq, validEnv);
      expect(noAuthRes.status).toBe(401);

      // Wrong secret
      const wrongAuthReq = new Request('https://worker.local/trigger', {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-secret' },
      });
      const wrongAuthRes = await worker.fetch(wrongAuthReq, validEnv);
      expect(wrongAuthRes.status).toBe(401);
    });

    it('authorizes valid POST /trigger with Bearer secret and executes against allowlisted target', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, enabled: false }), { status: 200 })
      );

      const authReq = new Request('https://worker.local/trigger', {
        method: 'POST',
        headers: { Authorization: `Bearer ${validEnv.CRON_SECRET}` },
      });
      const authRes = await worker.fetch(authReq, validEnv);

      expect(authRes.status).toBe(200);
      const body = await authRes.json();
      expect(body.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(validTargetUrl, expect.anything());
    });
  });
});
