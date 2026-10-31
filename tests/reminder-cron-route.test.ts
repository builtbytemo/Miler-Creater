import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../src/app/api/cron/reminders/route';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(),
  })),
}));

vi.mock('@/lib/services/reminder-service', () => ({
  processAllReminders: vi.fn(),
}));

import { processAllReminders } from '@/lib/services/reminder-service';

describe('Reminder Scheduled Cron Endpoint (/api/cron/reminders)', () => {
  const originalEnv = process.env;
  const TEST_CRON_SECRET = 'test_cron_secret_abc123';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('fails closed with HTTP 500 when CRON_SECRET is not configured on the server', async () => {
    delete process.env.CRON_SECRET;

    const req = new NextRequest('http://localhost:3000/api/cron/reminders', {
      method: 'GET',
      headers: {
        authorization: 'Bearer any-token',
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe('Scheduler secret is not configured');
    expect(processAllReminders).not.toHaveBeenCalled();
  });

  it('rejects requests with missing Authorization header with HTTP 401', async () => {
    process.env.CRON_SECRET = TEST_CRON_SECRET;

    const req = new NextRequest('http://localhost:3000/api/cron/reminders', {
      method: 'GET',
    });

    const res = await GET(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
    expect(processAllReminders).not.toHaveBeenCalled();
  });

  it('rejects requests with incorrect Bearer token with HTTP 401', async () => {
    process.env.CRON_SECRET = TEST_CRON_SECRET;

    const req = new NextRequest('http://localhost:3000/api/cron/reminders', {
      method: 'GET',
      headers: {
        authorization: 'Bearer wrong-secret',
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
    expect(processAllReminders).not.toHaveBeenCalled();
  });

  it('authorizes valid GET requests and returns execution summary with HTTP 200', async () => {
    process.env.CRON_SECRET = TEST_CRON_SECRET;

    vi.mocked(processAllReminders).mockResolvedValueOnce({
      success: true,
      referenceTime: '2026-10-29T12:00:00.000Z',
      results: {
        upcomingTasks: {
          category: 'upcoming_tasks',
          evaluated: 5,
          created: 2,
          duplicates: 0,
          skipped: 3,
          errors: 0,
          errorMessages: [],
        },
        overdueTasks: {
          category: 'overdue_tasks',
          evaluated: 2,
          created: 1,
          duplicates: 0,
          skipped: 1,
          errors: 0,
          errorMessages: [],
        },
        upcomingContent: {
          category: 'upcoming_content',
          evaluated: 1,
          created: 1,
          duplicates: 0,
          skipped: 0,
          errors: 0,
          errorMessages: [],
        },
      },
      totalCreated: 4,
      totalDuplicates: 0,
      totalSkipped: 4,
      totalErrors: 0,
      durationMs: 42,
    });

    const req = new NextRequest('http://localhost:3000/api/cron/reminders', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${TEST_CRON_SECRET}`,
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.totalCreated).toBe(4);
    expect(json.totalDuplicates).toBe(0);
    expect(json.totalErrors).toBe(0);
    expect(json.summary.upcomingTasks.created).toBe(2);
    expect(json.summary.overdueTasks.created).toBe(1);
    expect(json.summary.upcomingContent.created).toBe(1);
    expect(processAllReminders).toHaveBeenCalledTimes(1);
  });

  it('authorizes valid POST requests similarly', async () => {
    process.env.CRON_SECRET = TEST_CRON_SECRET;

    vi.mocked(processAllReminders).mockResolvedValueOnce({
      success: true,
      referenceTime: '2026-10-29T12:00:00.000Z',
      results: {
        upcomingTasks: {
          category: 'upcoming_tasks',
          evaluated: 0,
          created: 0,
          duplicates: 0,
          skipped: 0,
          errors: 0,
          errorMessages: [],
        },
        overdueTasks: {
          category: 'overdue_tasks',
          evaluated: 0,
          created: 0,
          duplicates: 0,
          skipped: 0,
          errors: 0,
          errorMessages: [],
        },
        upcomingContent: {
          category: 'upcoming_content',
          evaluated: 0,
          created: 0,
          duplicates: 0,
          skipped: 0,
          errors: 0,
          errorMessages: [],
        },
      },
      totalCreated: 0,
      totalDuplicates: 0,
      totalSkipped: 0,
      totalErrors: 0,
      durationMs: 15,
    });

    const req = new NextRequest('http://localhost:3000/api/cron/reminders', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TEST_CRON_SECRET}`,
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.totalCreated).toBe(0);
  });

  it('handles unexpected exceptions safely and returns HTTP 500 without leaking stack traces', async () => {
    process.env.CRON_SECRET = TEST_CRON_SECRET;

    vi.mocked(processAllReminders).mockRejectedValueOnce(new Error('Database network timeout'));

    const req = new NextRequest('http://localhost:3000/api/cron/reminders', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${TEST_CRON_SECRET}`,
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe('Internal server error processing reminders');
  });
});
