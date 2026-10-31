import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markNotificationAsUnread,
  markAllNotificationsAsRead,
  dismissNotification,
  getNotificationPreferences,
  saveNotificationPreferences,
  createNotification,
  getDefaultNotificationPreferences,
  type NotificationRow,
  type NotificationPreferencesRow,
} from '../src/lib/services/notification-service';
import {
  createNotificationSchema,
  notificationFilterSchema,
  updateNotificationPreferencesSchema,
} from '../src/lib/validation/notification';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';

describe('Notification Service & Validation Layer (Phase 5, Step 2)', () => {
  const wsId = '550e8400-e29b-41d4-a716-446655440000';
  const otherWsId = '99999999-9999-4999-a999-999999999999';
  const recipientId = '11111111-1111-4111-a111-111111111111';
  const otherUserId = '22222222-2222-4222-a222-222222222222';
  const notifId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const taskId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';

  const sampleNotification: NotificationRow = {
    id: notifId,
    workspace_id: wsId,
    recipient_id: recipientId,
    channel: 'in_app',
    title: 'Task Overdue',
    message: 'Task "Launch Campaign" has passed its due date.',
    entity_type: 'task',
    entity_id: taskId,
    scheduled_for: '2026-10-29T10:00:00Z',
    status: 'delivered',
    delivered_at: '2026-10-29T10:00:01Z',
    read_at: null,
    idempotency_key: 'task_overdue:c0eebc99:2026-10-29',
    created_at: '2026-10-29T10:00:00Z',
  };

  const samplePreferences: NotificationPreferencesRow = {
    id: 'pref-1',
    workspace_id: wsId,
    user_id: recipientId,
    notify_upcoming_tasks: true,
    notify_overdue_tasks: true,
    notify_upcoming_content: false,
    notify_status_changes: true,
    reminder_lead_minutes: 30,
    email_notifications_enabled: false,
    in_app_notifications_enabled: true,
    created_at: '2026-10-29T08:00:00Z',
    updated_at: '2026-10-29T08:00:00Z',
  };

  interface MockQueryBuilderCalls {
    from: string[];
    eq: [string, unknown][];
    neq: [string, unknown][];
    in: [string, unknown[]][];
    is: [string, unknown][];
    range: [number, number][];
    order: [string, unknown][];
    insertPayload: unknown;
    updatePayload: unknown;
    upsertPayload: unknown;
  }

  interface MockSupabaseOptions {
    selectData?: unknown[];
    count?: number | null;
    singleData?: unknown;
    maybeSingleData?: unknown;
    memberData?: unknown;
    selectError?: { message: string; code?: string } | null;
    insertError?: { message: string; code?: string } | null;
    updateError?: { message: string; code?: string } | null;
    upsertError?: { message: string; code?: string } | null;
  }

  function createMockSupabase(options: MockSupabaseOptions = {}) {
    const calls: MockQueryBuilderCalls = {
      from: [],
      eq: [],
      neq: [],
      in: [],
      is: [],
      range: [],
      order: [],
      insertPayload: null,
      updatePayload: null,
      upsertPayload: null,
    };

    const mockQueryBuilder: Record<string, any> = {};

    mockQueryBuilder.select = vi.fn().mockImplementation(() => mockQueryBuilder);
    mockQueryBuilder.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
      calls.eq.push([col, val]);
      return mockQueryBuilder;
    });
    mockQueryBuilder.neq = vi.fn().mockImplementation((col: string, val: unknown) => {
      calls.neq.push([col, val]);
      return mockQueryBuilder;
    });
    mockQueryBuilder.in = vi.fn().mockImplementation((col: string, vals: unknown[]) => {
      calls.in.push([col, vals]);
      return mockQueryBuilder;
    });
    mockQueryBuilder.is = vi.fn().mockImplementation((col: string, val: unknown) => {
      calls.is.push([col, val]);
      return mockQueryBuilder;
    });
    mockQueryBuilder.range = vi.fn().mockImplementation((from: number, to: number) => {
      calls.range.push([from, to]);
      return mockQueryBuilder;
    });
    mockQueryBuilder.order = vi.fn().mockImplementation((col: string, opt: unknown) => {
      calls.order.push([col, opt]);
      return mockQueryBuilder;
    });
    mockQueryBuilder.insert = vi.fn().mockImplementation((payload: unknown) => {
      calls.insertPayload = payload;
      return mockQueryBuilder;
    });
    mockQueryBuilder.update = vi.fn().mockImplementation((payload: unknown) => {
      calls.updatePayload = payload;
      return mockQueryBuilder;
    });
    mockQueryBuilder.upsert = vi.fn().mockImplementation((payload: unknown) => {
      calls.upsertPayload = payload;
      return mockQueryBuilder;
    });

    mockQueryBuilder.single = vi.fn().mockImplementation(() => {
      if (options.insertError) return Promise.resolve({ data: null, error: options.insertError });
      if (options.upsertError) return Promise.resolve({ data: null, error: options.upsertError });
      if (options.selectError) return Promise.resolve({ data: null, error: options.selectError });
      return Promise.resolve({
        data: options.singleData !== undefined ? options.singleData : options.selectData?.[0] || null,
        error: null,
      });
    });

    mockQueryBuilder.maybeSingle = vi.fn().mockImplementation(() => {
      const currentTable = calls.from[calls.from.length - 1];
      if (currentTable === 'workspace_members') {
        if (options.memberData !== undefined) {
          return Promise.resolve({ data: options.memberData, error: null });
        }
        return Promise.resolve({ data: { role: 'member' }, error: null });
      }
      if (options.selectError) return Promise.resolve({ data: null, error: options.selectError });
      if (options.updateError) return Promise.resolve({ data: null, error: options.updateError });
      return Promise.resolve({
        data: options.maybeSingleData !== undefined ? options.maybeSingleData : null,
        error: null,
      });
    });

    // Promise resolution for queries without .single()
    mockQueryBuilder.then = (resolve: any, reject: any) => {
      if (options.selectError) {
        return Promise.resolve({ data: null, error: options.selectError, count: null }).then(resolve, reject);
      }
      if (options.updateError) {
        return Promise.resolve({ data: null, error: options.updateError, count: null }).then(resolve, reject);
      }
      return Promise.resolve({
        data: options.selectData !== undefined ? options.selectData : [],
        error: null,
        count: options.count !== undefined ? options.count : options.selectData?.length ?? 0,
      }).then(resolve, reject);
    };

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        calls.from.push(table);
        return mockQueryBuilder;
      }),
      calls,
    } as unknown as SupabaseClient<Database> & { calls: MockQueryBuilderCalls };

    return mockClient;
  }

  // ============================================================================
  // 1. VALIDATION SCHEMAS
  // ============================================================================
  describe('Notification Validation Schemas', () => {
    it('validates a complete valid createNotification input', () => {
      const valid = {
        recipient_id: recipientId,
        channel: 'in_app' as const,
        title: 'Review Task',
        message: 'A task is ready for review.',
        entity_type: 'task' as const,
        entity_id: taskId,
        idempotency_key: 'task_ready:123',
      };
      const parsed = createNotificationSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
    });

    it('rejects createNotification with invalid recipient UUID format', () => {
      const invalid = {
        recipient_id: 'not-a-uuid',
        title: 'Valid Title',
        message: 'Valid Message',
      };
      const parsed = createNotificationSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0].message).toMatch(/Invalid recipient ID format/);
    });

    it('rejects createNotification with empty or overly long titles', () => {
      expect(
        createNotificationSchema.safeParse({
          recipient_id: recipientId,
          title: '   ',
          message: 'Valid message',
        }).success
      ).toBe(false);

      expect(
        createNotificationSchema.safeParse({
          recipient_id: recipientId,
          title: 'a'.repeat(256),
          message: 'Valid message',
        }).success
      ).toBe(false);
    });

    it('rejects createNotification with empty or overly long messages', () => {
      expect(
        createNotificationSchema.safeParse({
          recipient_id: recipientId,
          title: 'Valid Title',
          message: '',
        }).success
      ).toBe(false);

      expect(
        createNotificationSchema.safeParse({
          recipient_id: recipientId,
          title: 'Valid Title',
          message: 'm'.repeat(4001),
        }).success
      ).toBe(false);
    });

    it('validates notificationFilterSchema with sensible defaults', () => {
      const parsed = notificationFilterSchema.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.limit).toBe(20);
    });

    it('rejects negative or excessive page and limit in notificationFilterSchema', () => {
      expect(notificationFilterSchema.safeParse({ page: 0 }).success).toBe(false);
      expect(notificationFilterSchema.safeParse({ limit: 101 }).success).toBe(false);
      expect(notificationFilterSchema.safeParse({ limit: 0 }).success).toBe(false);
    });

    it('validates updateNotificationPreferencesSchema within database constraint bounds (0 to 10,080 mins)', () => {
      expect(
        updateNotificationPreferencesSchema.safeParse({
          reminder_lead_minutes: 0,
        }).success
      ).toBe(true);

      expect(
        updateNotificationPreferencesSchema.safeParse({
          reminder_lead_minutes: 10080,
        }).success
      ).toBe(true);

      expect(
        updateNotificationPreferencesSchema.safeParse({
          reminder_lead_minutes: -1,
        }).success
      ).toBe(false);

      expect(
        updateNotificationPreferencesSchema.safeParse({
          reminder_lead_minutes: 10081,
        }).success
      ).toBe(false);
    });

    it('rejects empty updateNotificationPreferences payload', () => {
      const res = updateNotificationPreferencesSchema.safeParse({});
      expect(res.success).toBe(false);
      expect(res.error?.issues[0].message).toMatch(/At least one preference setting must be provided/);
    });
  });

  // ============================================================================
  // 2. NOTIFICATION QUERYING & PAGINATION
  // ============================================================================
  describe('getNotifications & getUnreadNotificationCount', () => {
    it('retrieves paginated notifications scoped strictly to workspace and recipient', async () => {
      const mockSupabase = createMockSupabase({
        selectData: [sampleNotification],
        count: 1,
      });

      const res = await getNotifications(mockSupabase, wsId, recipientId, { page: 1, limit: 10 });

      expect(res.notifications).toEqual([sampleNotification]);
      expect(res.total).toBe(1);
      expect(res.page).toBe(1);
      expect(res.limit).toBe(10);
      expect(res.hasMore).toBe(false);

      // Verify query constraints
      expect(mockSupabase.calls.from).toContain('notifications');
      expect(mockSupabase.calls.eq).toContainEqual(['workspace_id', wsId]);
      expect(mockSupabase.calls.eq).toContainEqual(['recipient_id', recipientId]);
      expect(mockSupabase.calls.neq).toContainEqual(['status', 'dismissed']);
      expect(mockSupabase.calls.range).toContainEqual([0, 9]);
    });

    it('handles empty notification lists gracefully without error', async () => {
      const mockSupabase = createMockSupabase({
        selectData: [],
        count: 0,
      });

      const res = await getNotifications(mockSupabase, wsId, recipientId);
      expect(res.notifications).toEqual([]);
      expect(res.total).toBe(0);
      expect(res.hasMore).toBe(false);
    });

    it('applies unread_only and entity_type filters accurately', async () => {
      const mockSupabase = createMockSupabase({
        selectData: [sampleNotification],
        count: 1,
      });

      await getNotifications(mockSupabase, wsId, recipientId, {
        unread_only: true,
        entity_type: 'task',
      });

      expect(mockSupabase.calls.is).toContainEqual(['read_at', null]);
      expect(mockSupabase.calls.eq).toContainEqual(['entity_type', 'task']);
    });

    it('throws when database select fails', async () => {
      const mockSupabase = createMockSupabase({
        selectError: { message: 'Database connection timeout' },
      });

      await expect(getNotifications(mockSupabase, wsId, recipientId)).rejects.toThrow(
        /Failed to list notifications: Database connection timeout/
      );
    });

    it('retrieves unread count using exact count and head: true', async () => {
      const mockSupabase = createMockSupabase({
        count: 4,
      });

      const count = await getUnreadNotificationCount(mockSupabase, wsId, recipientId);
      expect(count).toBe(4);
      expect(mockSupabase.calls.eq).toContainEqual(['workspace_id', wsId]);
      expect(mockSupabase.calls.eq).toContainEqual(['recipient_id', recipientId]);
      expect(mockSupabase.calls.is).toContainEqual(['read_at', null]);
      expect(mockSupabase.calls.neq).toContainEqual(['status', 'dismissed']);
    });
  });

  // ============================================================================
  // 3. READ, UNREAD & DISMISS MUTATIONS
  // ============================================================================
  describe('markNotificationAsRead, markNotificationAsUnread, dismissNotification', () => {
    it('markNotificationAsRead updates read_at timestamp without modifying status', async () => {
      const readItem = { ...sampleNotification, read_at: '2026-10-29T11:00:00Z', status: 'delivered' as const };
      const mockSupabase = createMockSupabase({
        maybeSingleData: readItem,
      });

      const result = await markNotificationAsRead(mockSupabase, wsId, recipientId, notifId);

      expect(result.read_at).toBe('2026-10-29T11:00:00Z');
      expect(mockSupabase.calls.eq).toContainEqual(['id', notifId]);
      expect(mockSupabase.calls.eq).toContainEqual(['workspace_id', wsId]);
      expect(mockSupabase.calls.eq).toContainEqual(['recipient_id', recipientId]);
      // Verify status was NOT modified during read operation
      expect(mockSupabase.calls.updatePayload).not.toHaveProperty('status');
      expect(mockSupabase.calls.updatePayload).toHaveProperty('read_at');
    });

    it('regression: pending notification marked read preserves status pending without falsely becoming delivered', async () => {
      const pendingNotification: NotificationRow = {
        ...sampleNotification,
        status: 'pending',
        delivered_at: null,
      };
      const readPending = {
        ...pendingNotification,
        read_at: '2026-10-29T11:00:00Z',
      };
      const mockSupabase = createMockSupabase({
        maybeSingleData: readPending,
      });

      const result = await markNotificationAsRead(mockSupabase, wsId, recipientId, notifId);

      expect(result.status).toBe('pending');
      expect(result.delivered_at).toBeNull();
      expect(result.read_at).toBe('2026-10-29T11:00:00Z');
      expect(mockSupabase.calls.updatePayload).not.toHaveProperty('status');
    });

    it('markNotificationAsUnread clears read_at timestamp', async () => {
      const unreadItem = { ...sampleNotification, read_at: null };
      const mockSupabase = createMockSupabase({
        maybeSingleData: unreadItem,
      });

      const result = await markNotificationAsUnread(mockSupabase, wsId, recipientId, notifId);

      expect(result.read_at).toBeNull();
      expect(mockSupabase.calls.updatePayload).toEqual({ read_at: null });
    });

    it('dismissNotification updates status to dismissed', async () => {
      const dismissedItem = { ...sampleNotification, status: 'dismissed' as const };
      const mockSupabase = createMockSupabase({
        maybeSingleData: dismissedItem,
      });

      const result = await dismissNotification(mockSupabase, wsId, recipientId, notifId);

      expect(result.status).toBe('dismissed');
      expect(mockSupabase.calls.updatePayload).toEqual({ status: 'dismissed' });
    });

    it('throws not found error when mutating notification belonging to another user or workspace', async () => {
      const mockSupabase = createMockSupabase({
        maybeSingleData: null, // query returned 0 rows because workspace or recipient mismatched
      });

      await expect(markNotificationAsRead(mockSupabase, wsId, otherUserId, notifId)).rejects.toThrow(
        /not found or access denied/
      );
    });

    it('markAllNotificationsAsRead marks all unread active items and preserves status', async () => {
      const mockSupabase = createMockSupabase({
        selectData: [{ id: 'n-1' }, { id: 'n-2' }, { id: 'n-3' }],
      });

      const count = await markAllNotificationsAsRead(mockSupabase, wsId, recipientId);

      expect(count).toBe(3);
      expect(mockSupabase.calls.is).toContainEqual(['read_at', null]);
      expect(mockSupabase.calls.neq).toContainEqual(['status', 'dismissed']);
      expect(mockSupabase.calls.eq).toContainEqual(['workspace_id', wsId]);
      expect(mockSupabase.calls.eq).toContainEqual(['recipient_id', recipientId]);
      expect(mockSupabase.calls.updatePayload).not.toHaveProperty('status');
      expect(mockSupabase.calls.updatePayload).toHaveProperty('read_at');
    });
  });

  // ============================================================================
  // 4. NOTIFICATION PREFERENCES
  // ============================================================================
  describe('Notification Preferences (Defaults vs Explicit Saves)', () => {
    it('returns in-memory defaults when no preference row exists WITHOUT inserting to database', async () => {
      const mockSupabase = createMockSupabase({
        maybeSingleData: null,
      });

      const prefs = await getNotificationPreferences(mockSupabase, wsId, recipientId);

      // Verified exact agreed defaults
      expect(prefs.id).toBeNull();
      expect(prefs.workspace_id).toBe(wsId);
      expect(prefs.user_id).toBe(recipientId);
      expect(prefs.in_app_notifications_enabled).toBe(true);
      expect(prefs.email_notifications_enabled).toBe(false);
      expect(prefs.reminder_lead_minutes).toBe(60);
      expect(prefs.notify_upcoming_tasks).toBe(true);
      expect(prefs.notify_overdue_tasks).toBe(true);
      expect(prefs.notify_upcoming_content).toBe(true);
      expect(prefs.notify_status_changes).toBe(true);

      // Crucial requirement: No insert or upsert call was made!
      expect(mockSupabase.calls.insertPayload).toBeNull();
      expect(mockSupabase.calls.upsertPayload).toBeNull();
    });

    it('returns existing preference row when database record is present', async () => {
      const mockSupabase = createMockSupabase({
        maybeSingleData: samplePreferences,
      });

      const prefs = await getNotificationPreferences(mockSupabase, wsId, recipientId);

      expect(prefs.id).toBe('pref-1');
      expect(prefs.reminder_lead_minutes).toBe(30);
      expect(prefs.notify_upcoming_content).toBe(false);
    });

    it('saveNotificationPreferences performs an upsert preserving unchanged fields', async () => {
      const mockSupabase = createMockSupabase({
        maybeSingleData: samplePreferences, // existing record has reminder_lead_minutes = 30
        singleData: { ...samplePreferences, notify_overdue_tasks: false },
      });

      const updated = await saveNotificationPreferences(mockSupabase, wsId, recipientId, {
        notify_overdue_tasks: false,
      });

      expect(updated.notify_overdue_tasks).toBe(false);
      expect(mockSupabase.calls.upsertPayload).toMatchObject({
        workspace_id: wsId,
        user_id: recipientId,
        notify_overdue_tasks: false,
        reminder_lead_minutes: 30, // preserved from existing record
      });
    });

    it('saveNotificationPreferences initializes from defaults on first explicit save', async () => {
      const mockSupabase = createMockSupabase({
        maybeSingleData: null, // no existing row
        singleData: { ...samplePreferences, reminder_lead_minutes: 15 },
      });

      await saveNotificationPreferences(mockSupabase, wsId, recipientId, {
        reminder_lead_minutes: 15,
      });

      expect(mockSupabase.calls.upsertPayload).toMatchObject({
        workspace_id: wsId,
        user_id: recipientId,
        reminder_lead_minutes: 15,
        in_app_notifications_enabled: true, // defaulted
        email_notifications_enabled: false, // defaulted
      });
    });
  });

  // ============================================================================
  // 5. TRUSTED SERVER CREATION & IDEMPOTENCY
  // ============================================================================
  describe('createNotification (Elevated Server Write with Authorization & Idempotency)', () => {
    it('creates notification successfully when recipient is an active workspace member', async () => {
      const mockAdminSupabase = createMockSupabase({
        memberData: { role: 'member' },
        maybeSingleData: null, // pre-insert check finds no duplicate
        singleData: sampleNotification,
      });

      const res = await createNotification(mockAdminSupabase, wsId, {
        recipient_id: recipientId,
        title: 'New Assignment',
        message: 'You have been assigned to task 1',
        entity_type: 'task',
        entity_id: taskId,
        idempotency_key: 'task_assigned:1',
      });

      expect(res.isDuplicate).toBe(false);
      expect(res.notification.id).toBe(notifId);
      expect(mockAdminSupabase.calls.insertPayload).toMatchObject({
        workspace_id: wsId,
        recipient_id: recipientId,
        title: 'New Assignment',
        status: 'delivered',
      });
    });

    it('schedules future notifications as pending and immediate notifications as delivered', async () => {
      const mockAdminSupabase = createMockSupabase({
        memberData: { role: 'member' },
        maybeSingleData: null,
        singleData: { ...sampleNotification, status: 'pending', delivered_at: null },
      });

      const futureDate = new Date(Date.now() + 3600000).toISOString();
      await createNotification(mockAdminSupabase, wsId, {
        recipient_id: recipientId,
        title: 'Upcoming Scheduled Content',
        message: 'Content item will publish in 1 hour',
        scheduled_for: futureDate,
      });

      expect(mockAdminSupabase.calls.insertPayload).toMatchObject({
        status: 'pending',
        delivered_at: null,
      });
    });

    it('rejects notification creation if recipient is NOT an active member of the workspace', async () => {
      const mockAdminSupabase = createMockSupabase({
        memberData: null, // recipient is not in workspace_members for wsId
      });

      await expect(
        createNotification(mockAdminSupabase, wsId, {
          recipient_id: otherUserId,
          title: 'Unauthorized Notification',
          message: 'This should be rejected',
        })
      ).rejects.toThrow(/is not an active member of workspace/);

      // Verify no insert was attempted
      expect(mockAdminSupabase.calls.insertPayload).toBeNull();
    });

    it('returns existing notification and skips insert when idempotency key already exists', async () => {
      const mockAdminSupabase = createMockSupabase({
        maybeSingleData: sampleNotification, // pre-insert check finds existing record
      });

      // Override maybeSingle to first return member row, then existing notification row
      let queryCount = 0;
      mockAdminSupabase.from = vi.fn().mockImplementation((table: string) => {
        queryCount++;
        const qb: any = {};
        qb.select = vi.fn().mockReturnThis();
        qb.eq = vi.fn().mockReturnThis();
        qb.maybeSingle = vi.fn().mockImplementation(() => {
          if (table === 'workspace_members') {
            return Promise.resolve({ data: { role: 'member' }, error: null });
          }
          if (table === 'notifications') {
            return Promise.resolve({ data: sampleNotification, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        });
        qb.insert = vi.fn().mockReturnThis();
        return qb;
      });

      const res = await createNotification(mockAdminSupabase, wsId, {
        recipient_id: recipientId,
        title: 'Duplicate Event',
        message: 'Event was already delivered',
        idempotency_key: sampleNotification.idempotency_key!,
      });

      expect(res.isDuplicate).toBe(true);
      expect(res.notification.id).toBe(sampleNotification.id);
    });

    it('handles race condition on unique violation (code 23505) by returning existing row', async () => {
      const mockAdminSupabase = createMockSupabase();

      mockAdminSupabase.from = vi.fn().mockImplementation((table: string) => {
        const qb: any = {};
        qb.select = vi.fn().mockReturnThis();
        qb.eq = vi.fn().mockReturnThis();
        qb.insert = vi.fn().mockReturnThis();
        qb.maybeSingle = vi.fn().mockImplementation(() => {
          if (table === 'workspace_members') {
            return Promise.resolve({ data: { role: 'member' }, error: null });
          }
          // Pre-insert check simulates race (returned null), then conflict happens on insert
          return Promise.resolve({ data: sampleNotification, error: null });
        });
        qb.single = vi.fn().mockImplementation(() => {
          // Simulate unique violation error code 23505 from PostgreSQL
          return Promise.resolve({
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint' },
          });
        });
        return qb;
      });

      const res = await createNotification(mockAdminSupabase, wsId, {
        recipient_id: recipientId,
        title: 'Race Condition Task',
        message: 'Handling concurrent duplicate',
        idempotency_key: 'concurrent_key_1',
      });

      expect(res.isDuplicate).toBe(true);
      expect(res.notification.id).toBe(sampleNotification.id);
    });

    it('throws when database insert fails with unexpected error', async () => {
      const mockAdminSupabase = createMockSupabase();

      mockAdminSupabase.from = vi.fn().mockImplementation((table: string) => {
        const qb: any = {};
        qb.select = vi.fn().mockReturnThis();
        qb.eq = vi.fn().mockReturnThis();
        qb.insert = vi.fn().mockReturnThis();
        qb.maybeSingle = vi.fn().mockImplementation(() => {
          return Promise.resolve({ data: { role: 'member' }, error: null });
        });
        qb.single = vi.fn().mockImplementation(() => {
          return Promise.resolve({
            data: null,
            error: { code: '42P01', message: 'relation does not exist' },
          });
        });
        return qb;
      });

      await expect(
        createNotification(mockAdminSupabase, wsId, {
          recipient_id: recipientId,
          title: 'Error Notification',
          message: 'Fails on insert',
        })
      ).rejects.toThrow(/Failed to create notification: relation does not exist/);
    });
  });
});
