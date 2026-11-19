import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createContentItemInputSchema,
  updateContentItemInputSchema,
  rescheduleContentInputSchema,
} from '../src/lib/mcp/schemas';

const mockCreateContentItem = vi.fn();
const mockUpdateContentItem = vi.fn();
const mockGetContentItemById = vi.fn();

vi.mock('@/lib/services/content-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/services/content-service')>();
  return {
    ...actual,
    createContentItem: (...args: unknown[]) => mockCreateContentItem(...args),
    updateContentItem: (...args: unknown[]) => mockUpdateContentItem(...args),
    getContentItemById: (...args: unknown[]) => mockGetContentItemById(...args),
  };
});

import { dispatchTool } from '../src/lib/mcp/dispatcher';
import type { AIExecutionContext } from '../src/lib/mcp/types';

describe('MCP Content Schedule (Date + 12h Time + AM/PM)', () => {
  const validUuid = '123e4567-e89b-12d3-a456-426614174000';
  const baseContext: AIExecutionContext = {
    supabase: {} as AIExecutionContext['supabase'],
    userId: 'user-1',
    workspaceId: 'ws-1',
    actorId: 'tok-1',
    scopes: ['content:read', 'content:write'],
    timeZone: 'America/New_York',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateContentItem.mockResolvedValue({ id: validUuid, status: 'scheduled' });
    mockUpdateContentItem.mockResolvedValue({ id: validUuid, status: 'scheduled' });
    mockGetContentItemById.mockResolvedValue({ id: validUuid, status: 'draft' });
  });

  it('schemas accept scheduled_date, scheduled_hour, scheduled_minute, and scheduled_meridiem', () => {
    const created = createContentItemInputSchema.parse({
      platform: 'x',
      body: 'Hello world',
      scheduled_date: '2026-11-20',
      scheduled_hour: 3,
      scheduled_minute: 30,
      scheduled_meridiem: 'PM',
    });
    expect(created.scheduled_date).toBe('2026-11-20');
    expect(created.scheduled_hour).toBe(3);
    expect(created.scheduled_minute).toBe(30);
    expect(created.scheduled_meridiem).toBe('PM');

    const updated = updateContentItemInputSchema.parse({
      content_id: validUuid,
      scheduled_date: '2026-11-20',
      scheduled_hour: 12,
      scheduled_minute: 0,
      scheduled_meridiem: 'AM',
    });
    expect(updated.scheduled_meridiem).toBe('AM');

    const rescheduled = rescheduleContentInputSchema.parse({
      content_id: validUuid,
      scheduled_date: '2026-11-20',
      scheduled_hour: 12,
      scheduled_minute: 15,
      scheduled_meridiem: 'PM',
    });
    expect(rescheduled.scheduled_date).toBe('2026-11-20');
  });

  it('create_content_item converts 12h AM/PM in user timezone to UTC ISO and strips helper fields', async () => {
    const result = await dispatchTool('create_content_item', {
      platform: 'x',
      body: 'Afternoon post',
      scheduled_date: '2026-11-20',
      scheduled_hour: 3,
      scheduled_minute: 30,
      scheduled_meridiem: 'PM',
    }, baseContext);

    expect(result.success).toBe(true);
    expect(mockCreateContentItem).toHaveBeenCalledTimes(1);
    const payload = mockCreateContentItem.mock.calls[0][2];
    // 2026-11-20 15:30 America/New_York (EST, UTC-5) -> 2026-11-20T20:30:00.000Z
    expect(payload.scheduled_at).toBe('2026-11-20T20:30:00.000Z');
    expect(payload.status).toBe('scheduled');
    expect(payload.scheduled_date).toBeUndefined();
    expect(payload.scheduled_hour).toBeUndefined();
    expect(payload.scheduled_minute).toBeUndefined();
    expect(payload.scheduled_meridiem).toBeUndefined();
  });

  it('reschedule_content converts 12:00 AM and 12:00 PM accurately in user timezone', async () => {
    const resMidnight = await dispatchTool('reschedule_content', {
      content_id: validUuid,
      scheduled_date: '2026-11-20',
      scheduled_hour: 12,
      scheduled_minute: 0,
      scheduled_meridiem: 'AM',
    }, baseContext);
    expect(resMidnight.success).toBe(true);
    expect(mockUpdateContentItem.mock.calls[0][3].scheduled_at).toBe('2026-11-20T05:00:00.000Z');

    const resNoon = await dispatchTool('reschedule_content', {
      content_id: validUuid,
      scheduled_date: '2026-11-20',
      scheduled_hour: 12,
      scheduled_minute: 0,
      scheduled_meridiem: 'PM',
    }, baseContext);
    expect(resNoon.success).toBe(true);
    expect(mockUpdateContentItem.mock.calls[1][3].scheduled_at).toBe('2026-11-20T17:00:00.000Z');
  });

  it('rejects ambiguous scheduled_at + scheduled_date or time without scheduled_date', async () => {
    const both = await dispatchTool('update_content_item', {
      content_id: validUuid,
      scheduled_at: '2026-11-20T20:30:00.000Z',
      scheduled_date: '2026-11-20',
      scheduled_hour: 3,
      scheduled_meridiem: 'PM',
    }, baseContext);
    expect(both.success).toBe(false);

    const noDate = await dispatchTool('update_content_item', {
      content_id: validUuid,
      scheduled_hour: 3,
      scheduled_meridiem: 'PM',
    }, baseContext);
    expect(noDate.success).toBe(false);
  });
});
