import { describe, it, expect, vi } from 'vitest';
import { getUnifiedSchedule } from '../src/lib/services/scheduling-service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';

type MockClient = SupabaseClient<Database>;

describe('Unified Scheduling Service (Server-side Shared Layer)', () => {
  const workspaceId = 'ws-test-1111';

  it('rejects invalid or inverted date ranges', async () => {
    const mockSupabase = {} as unknown as MockClient;

    await expect(
      getUnifiedSchedule(mockSupabase, workspaceId, {
        startDate: 'invalid-date',
        endDate: '2026-11-10T00:00:00Z',
      })
    ).rejects.toThrow(/Invalid startDate or endDate/);

    await expect(
      getUnifiedSchedule(mockSupabase, workspaceId, {
        startDate: '2026-11-10T00:00:00Z',
        endDate: '2026-11-01T00:00:00Z', // Inverted: end < start
      })
    ).rejects.toThrow(/endDate cannot be earlier than startDate/);
  });

  it('rejects unbounded date ranges exceeding 120 days', async () => {
    const mockSupabase = {} as unknown as MockClient;

    await expect(
      getUnifiedSchedule(mockSupabase, workspaceId, {
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-06-01T00:00:00Z', // ~150 days
      })
    ).rejects.toThrow(/exceeds the maximum allowed window of 120 days/);
  });

  it('correctly maps and sorts tasks and content items in one consistent interface', async () => {
    // Mock Supabase client responses
    const mockTasks = [
      {
        id: 'task-1',
        title: 'Review Q4 Architecture',
        status: 'todo',
        priority: 'high',
        scheduled_start: '2026-11-05T08:00:00Z',
        scheduled_end: '2026-11-05T09:30:00Z',
        due_date: '2026-11-05T17:00:00Z',
        is_all_day: false,
        project_id: 'proj-1',
        projects: { id: 'proj-1', name: 'Q4 Strategy', color: '#2563eb' },
      },
    ];

    const mockDeadlines = [
      {
        id: 'task-deadline-only',
        title: 'Submit Tax Documents',
        status: 'todo',
        priority: 'urgent',
        scheduled_start: null,
        scheduled_end: null,
        due_date: '2026-11-07T12:00:00Z',
        is_all_day: false,
        project_id: null,
        projects: null,
      },
    ];

    const mockContent = [
      {
        id: 'content-1',
        title: 'LinkedIn Launch Post',
        platform: 'linkedin',
        action_type: 'post',
        status: 'scheduled',
        scheduled_at: '2026-11-05T10:00:00Z',
        duration_minutes: 30,
        project_id: 'proj-1',
        projects: { id: 'proj-1', name: 'Q4 Strategy', color: '#2563eb' },
      },
    ];

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'tasks') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                not: vi.fn(() => ({
                  gte: vi.fn(() => ({
                    lte: vi.fn(() => Promise.resolve({ data: mockTasks, error: null })),
                  })),
                })),
                is: vi.fn(() => ({
                  not: vi.fn(() => ({
                    gte: vi.fn(() => ({
                      lte: vi.fn(() => Promise.resolve({ data: mockDeadlines, error: null })),
                    })),
                  })),
                })),
              })),
            })),
          };
        } else if (table === 'content_items') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                not: vi.fn(() => ({
                  gte: vi.fn(() => ({
                    lte: vi.fn(() => Promise.resolve({ data: mockContent, error: null })),
                  })),
                })),
              })),
            })),
          };
        }
        return { select: vi.fn() };
      }),
    } as unknown as MockClient;

    const result = await getUnifiedSchedule(mockSupabase, workspaceId, {
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-11-10T23:59:59Z',
      userTimeZone: 'Asia/Cairo',
    });

    expect(result.events.length).toBe(2);
    expect(result.deadlineItems.length).toBe(1);

    // Event 1: task-1 at 08:00 UTC (10:00 AM Cairo)
    // Event 2: content-1 at 10:00 UTC (12:00 PM Cairo)
    expect(result.events[0].id).toBe('task-1');
    expect(result.events[0].itemType).toBe('task');
    expect(result.events[0].projectName).toBe('Q4 Strategy');

    expect(result.events[1].id).toBe('content-1');
    expect(result.events[1].itemType).toBe('content');
    expect(result.events[1].platform).toBe('linkedin');

    // Deadline: task-deadline-only
    expect(result.deadlineItems[0].id).toBe('task-deadline-only');
    expect(result.deadlineItems[0].startTime).toBeNull();
    expect(result.deadlineItems[0].deadline).toBe('2026-11-07T12:00:00Z');
  });
});
