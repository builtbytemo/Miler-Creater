/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker, { triggerDailyBriefingCron, type Env } from '../workers/daily-briefing-scheduler/src/index';

describe('Cloudflare Worker Daily Briefing Scheduler Suite', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const validEnv: Env = {
    TARGET_URL: 'https://miler-creater-git-feat-daily-briefin-f2acc6-temo-ctrls-projects.vercel.app/api/cron/daily-briefing',
    CRON_SECRET: 'test-cron-secret-cf-12345',
    VERCEL_PROTECTION_BYPASS_SECRET: 'test-bypass-secret-xyz987',
    REQUEST_TIMEOUT_MS: '5000',
  };

  it('fails closed when TARGET_URL is missing or empty', async () => {
    const env: Env = { ...validEnv, TARGET_URL: '' };
    const result = await triggerDailyBriefingCron(env);
    expect(result.ok).toBe(false);
    expect(result.statusText).toBe('CONFIG_ERROR');
    expect(result.error).toBe('TARGET_URL is required');
  });

  it('fails closed when CRON_SECRET is missing or empty', async () => {
    const env: Env = { ...validEnv, CRON_SECRET: '   ' };
    const result = await triggerDailyBriefingCron(env);
    expect(result.ok).toBe(false);
    expect(result.statusText).toBe('CONFIG_ERROR');
    expect(result.error).toBe('CRON_SECRET is required');
  });

  it('refuses to execute if TARGET_URL references production Supabase project ref', async () => {
    const env: Env = {
      ...validEnv,
      TARGET_URL: 'https://api.miler.app/api/cron/daily-briefing?db=zcpdpizrbaaekteurwup',
    };
    const result = await triggerDailyBriefingCron(env);
    expect(result.ok).toBe(false);
    expect(result.statusText).toBe('TARGET_GUARD_VIOLATION');
    expect(result.error).toContain('production project reference');
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

  it('worker default scheduled handler executes successfully', async () => {
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
  });

  it('worker fetch handler responds to /health without secrets', async () => {
    const req = new Request('https://worker.local/health');
    const res = await worker.fetch(req, validEnv);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      service: 'miler-daily-briefing-scheduler',
      status: 'healthy',
      targetConfigured: true,
      hasCronSecret: true,
      hasBypassSecret: true,
    });
  });

  it('worker fetch handler authorizes manual /trigger with Bearer secret', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, enabled: false }), { status: 200 })
    );

    // Without secret -> 401
    const unauthReq = new Request('https://worker.local/trigger');
    const unauthRes = await worker.fetch(unauthReq, validEnv);
    expect(unauthRes.status).toBe(401);

    // With valid secret -> 200
    const authReq = new Request('https://worker.local/trigger', {
      headers: { Authorization: `Bearer ${validEnv.CRON_SECRET}` },
    });
    const authRes = await worker.fetch(authReq, validEnv);
    expect(authRes.status).toBe(200);
    const body = await authRes.json();
    expect(body.ok).toBe(true);
  });
});
