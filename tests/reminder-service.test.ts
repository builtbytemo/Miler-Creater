import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processUpcomingTaskReminders,
  processOverdueTaskReminders,
  processUpcomingContentReminders,
  processAllReminders,
} from '../src/lib/services/reminder-service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';

describe('Reminder Automation Service Layer (Phase 5, Step 5.1)', () => {
  const wsId = '550e8400-e29b-41d4-a716-446655440000';
  const recipientId = '11111111-1111-4111-a111-111111111111';
  const creatorId = '22222222-2222-4222-a222-222222222222';
  const taskId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
  const contentId = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';

  // Base fixed reference time: 2026-10-29T12:00:00Z
  const fixedNow = new Date('2026-10-29T12:00:00Z');

  function createMockSupabase(config: {
    tasks?: any[];
    contentItems?: any[];
    preferences?: any;
    preferenceError?: Error | null;
    memberRole?: string | null;
    isDuplicateNotification?: boolean;
    insertNotificationError?: Error | null;
  }) {
    const insertedNotifications: any[] = [];
    const fromCalls: string[] = [];

    const client = {
      from: vi.fn((table: string) => {
        fromCalls.push(table);
        const builder: any = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          neq: vi.fn(() => builder),
          gt: vi.fn(() => builder),
          gte: vi.fn(() => builder),
          lt: vi.fn(() => builder),
          lte: vi.fn(() => builder),
          not: vi.fn(() => builder),
          in: vi.fn(() => builder),
          is: vi.fn(() => builder),
          order: vi.fn(() => builder),
          limit: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => {
            if (table === 'workspace_members') {
              if (config.memberRole === null) return { data: null, error: null };
              return { data: { role: config.memberRole ?? 'member' }, error: null };
            }
            if (table === 'notification_preferences') {
              if (config.preferenceError) {
                return { data: null, error: config.preferenceError };
              }
              return { data: config.preferences ?? null, error: null };
            }
            if (table === 'notifications') {
              if (config.isDuplicateNotification) {
                return {
                  data: {
                    id: 'existing-notif-id',
                    workspace_id: wsId,
                    recipient_id: recipientId,
                    idempotency_key: 'duplicate-key',
                  },
                  error: null,
                };
              }
              return { data: null, error: null };
            }
            return { data: null, error: null };
          }),
          single: vi.fn(async () => {
            if (config.insertNotificationError) {
              return { data: null, error: config.insertNotificationError };
            }
            const lastInserted = insertedNotifications[insertedNotifications.length - 1];
            return {
              data: {
                id: 'new-notif-id',
                ...lastInserted,
                created_at: new Date().toISOString(),
              },
              error: null,
            };
          }),
          insert: vi.fn((payload: any) => {
            insertedNotifications.push(payload);
            return builder;
          }),
        };

        // When awaiting query on tasks / content_items directly:
        builder.then = (resolve: any) => {
          if (table === 'tasks') {
            resolve({ data: config.tasks ?? [], error: null });
          } else if (table === 'content_items') {
            resolve({ data: config.contentItems ?? [], error: null });
          } else {
            resolve({ data: [], error: null });
          }
        };

        return builder;
      }),
      _insertedNotifications: insertedNotifications,
      _fromCalls: fromCalls,
    } as unknown as SupabaseClient<Database> & {
      _insertedNotifications: any[];
      _fromCalls: string[];
    };

    return client;
  }

  // ============================================================================
  // 1. UPCOMING TASK REMINDERS
  // ============================================================================
  describe('processUpcomingTaskReminders', () => {
    it('creates upcoming task notification when now is within recipient lead time window', async () => {
      // Task due in 45 minutes (within 60 min default lead time)
      const dueDate = new Date(fixedNow.getTime() + 45 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Prepare Quarterly Review',
            status: 'todo',
            due_date: dueDate,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
        preferences: {
          id: 'pref-1',
          workspace_id: wsId,
          user_id: recipientId,
          in_app_notifications_enabled: true,
          notify_upcoming_tasks: true,
          reminder_lead_minutes: 60,
        },
      });

      const res = await processUpcomingTaskReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.category).toBe('upcoming_tasks');
      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(1);
      expect(res.duplicates).toBe(0);
      expect(res.skipped).toBe(0);
      expect(res.errors).toBe(0);

      expect(mockClient._insertedNotifications).toHaveLength(1);
      const inserted = mockClient._insertedNotifications[0];
      expect(inserted.workspace_id).toBe(wsId);
      expect(inserted.recipient_id).toBe(recipientId);
      expect(inserted.title).toContain('Upcoming Task: Prepare Quarterly Review');
      expect(inserted.idempotency_key).toBe(`task_upcoming:${taskId}:${dueDate}`);
      expect(inserted.status).toBe('delivered');
    });

    it('falls back to created_by when assigned_to is null', async () => {
      const dueDate = new Date(fixedNow.getTime() + 30 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Unassigned Task',
            status: 'in_progress',
            due_date: dueDate,
            assigned_to: null,
            created_by: creatorId,
            completed_at: null,
          },
        ],
      });

      const res = await processUpcomingTaskReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.created).toBe(1);
      expect(mockClient._insertedNotifications[0].recipient_id).toBe(creatorId);
    });

    it('skips task if current time is before the lead time window (too early)', async () => {
      // Due in 3 hours, but lead time is 60 minutes
      const dueDate = new Date(fixedNow.getTime() + 3 * 60 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Future Task',
            status: 'todo',
            due_date: dueDate,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
      });

      const res = await processUpcomingTaskReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
      expect(mockClient._insertedNotifications).toHaveLength(0);
    });

    it('skips task when notify_upcoming_tasks preference is disabled', async () => {
      const dueDate = new Date(fixedNow.getTime() + 30 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Ignored Upcoming Task',
            status: 'todo',
            due_date: dueDate,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
        preferences: {
          id: 'pref-1',
          workspace_id: wsId,
          user_id: recipientId,
          in_app_notifications_enabled: true,
          notify_upcoming_tasks: false, // disabled
          reminder_lead_minutes: 60,
        },
      });

      const res = await processUpcomingTaskReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
      expect(mockClient._insertedNotifications).toHaveLength(0);
    });

    it('skips task when in_app_notifications_enabled is disabled', async () => {
      const dueDate = new Date(fixedNow.getTime() + 30 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Task with in-app disabled',
            status: 'todo',
            due_date: dueDate,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
        preferences: {
          id: 'pref-1',
          workspace_id: wsId,
          user_id: recipientId,
          in_app_notifications_enabled: false, // master toggle off
          notify_upcoming_tasks: true,
          reminder_lead_minutes: 60,
        },
      });

      const res = await processUpcomingTaskReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
    });

    it('detects duplicate reminder via existing idempotency key and counts as duplicate', async () => {
      const dueDate = new Date(fixedNow.getTime() + 30 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Already Reminded Task',
            status: 'todo',
            due_date: dueDate,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
        isDuplicateNotification: true, // simulates existing idempotency record
      });

      const res = await processUpcomingTaskReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(0);
      expect(res.duplicates).toBe(1);
      expect(res.errors).toBe(0);
    });
  });

  // ============================================================================
  // 2. OVERDUE TASK REMINDERS
  // ============================================================================
  describe('processOverdueTaskReminders', () => {
    it('creates overdue notification for incomplete task whose due date has passed', async () => {
      // Due 2 hours ago
      const pastDueDate = new Date(fixedNow.getTime() - 2 * 60 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Overdue Campaign Audit',
            status: 'in_progress',
            due_date: pastDueDate,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
      });

      const res = await processOverdueTaskReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.category).toBe('overdue_tasks');
      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(1);
      expect(res.errors).toBe(0);

      const inserted = mockClient._insertedNotifications[0];
      expect(inserted.title).toContain('Task Overdue: Overdue Campaign Audit');
      expect(inserted.idempotency_key).toBe(`task_overdue:${taskId}:${pastDueDate}`);
      expect(inserted.status).toBe('delivered');
    });

    it('skips overdue task when notify_overdue_tasks preference is false', async () => {
      const pastDueDate = new Date(fixedNow.getTime() - 60 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Ignored Overdue Task',
            status: 'todo',
            due_date: pastDueDate,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
        preferences: {
          id: 'pref-1',
          workspace_id: wsId,
          user_id: recipientId,
          in_app_notifications_enabled: true,
          notify_overdue_tasks: false, // disabled
          notify_upcoming_tasks: true,
          reminder_lead_minutes: 60,
        },
      });

      const res = await processOverdueTaskReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
      expect(mockClient._insertedNotifications).toHaveLength(0);
    });

    it('handles duplicate overdue invocation safely without multiple records', async () => {
      const pastDueDate = new Date(fixedNow.getTime() - 60 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Already Notified Overdue Task',
            status: 'todo',
            due_date: pastDueDate,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
        isDuplicateNotification: true,
      });

      const res = await processOverdueTaskReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.duplicates).toBe(1);
      expect(res.created).toBe(0);
    });
  });

  // ============================================================================
  // 3. UPCOMING CONTENT REMINDERS
  // ============================================================================
  describe('processUpcomingContentReminders', () => {
    it('creates content reminder when publication time is within lead time window', async () => {
      // Scheduled in 50 minutes
      const scheduledAt = new Date(fixedNow.getTime() + 50 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        contentItems: [
          {
            id: contentId,
            workspace_id: wsId,
            title: 'Product Launch Thread',
            platform: 'threads',
            status: 'scheduled',
            scheduled_at: scheduledAt,
            created_by: recipientId,
          },
        ],
      });

      const res = await processUpcomingContentReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.category).toBe('upcoming_content');
      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(1);
      expect(res.errors).toBe(0);

      const inserted = mockClient._insertedNotifications[0];
      expect(inserted.title).toContain('Upcoming Scheduled Content: Threads');
      expect(inserted.message).toContain('Product Launch Thread');
      expect(inserted.entity_type).toBe('content_item');
      expect(inserted.entity_id).toBe(contentId);
      expect(inserted.idempotency_key).toBe(`content_upcoming:${contentId}:${scheduledAt}`);
    });

    it('skips scheduled content when notify_upcoming_content preference is false', async () => {
      const scheduledAt = new Date(fixedNow.getTime() + 45 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        contentItems: [
          {
            id: contentId,
            workspace_id: wsId,
            title: 'Silenced LinkedIn Post',
            platform: 'linkedin',
            status: 'scheduled',
            scheduled_at: scheduledAt,
            created_by: recipientId,
          },
        ],
        preferences: {
          id: 'pref-1',
          workspace_id: wsId,
          user_id: recipientId,
          in_app_notifications_enabled: true,
          notify_upcoming_content: false, // disabled
          reminder_lead_minutes: 60,
        },
      });

      const res = await processUpcomingContentReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
      expect(mockClient._insertedNotifications).toHaveLength(0);
    });

    it('skips scheduled content when current time is earlier than alert window', async () => {
      // Scheduled in 5 hours, lead time is 60 minutes
      const scheduledAt = new Date(fixedNow.getTime() + 5 * 60 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        contentItems: [
          {
            id: contentId,
            workspace_id: wsId,
            title: 'Far Future Post',
            platform: 'x',
            status: 'scheduled',
            scheduled_at: scheduledAt,
            created_by: recipientId,
          },
        ],
      });

      const res = await processUpcomingContentReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
    });
  });

  // ============================================================================
  // 4. PARTIAL FAILURE RESILIENCE & BOUNDED BATCHES
  // ============================================================================
  describe('Resilience and Partial Failure Handling', () => {
    it('continues processing subsequent items when one item dispatch throws an error', async () => {
      const due1 = new Date(fixedNow.getTime() + 20 * 60 * 1000).toISOString();
      const due2 = new Date(fixedNow.getTime() + 25 * 60 * 1000).toISOString();

      const failTaskId = 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01';
      const successTaskId = 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02';

      let callCount = 0;
      const client = {
        from: vi.fn((table: string) => {
          const builder: any = {
            select: vi.fn(() => builder),
            eq: vi.fn(() => builder),
            gt: vi.fn(() => builder),
            lte: vi.fn(() => builder),
            not: vi.fn(() => builder),
            in: vi.fn(() => builder),
            is: vi.fn(() => builder),
            order: vi.fn(() => builder),
            limit: vi.fn(() => builder),
            maybeSingle: vi.fn(async () => {
              if (table === 'workspace_members') {
                callCount++;
                // First recipient has been removed from workspace!
                if (callCount === 1) return { data: null, error: null };
                return { data: { role: 'member' }, error: null };
              }
              return { data: null, error: null };
            }),
            single: vi.fn(async () => ({
              data: { id: 'notif-id' },
              error: null,
            })),
            insert: vi.fn(() => builder),
          };
          builder.then = (resolve: any) => {
            if (table === 'tasks') {
              resolve({
                data: [
                  {
                    id: failTaskId,
                    workspace_id: wsId,
                    title: 'Task by removed user',
                    status: 'todo',
                    due_date: due1,
                    assigned_to: '33333333-3333-4333-a333-333333333333',
                    created_by: creatorId,
                    completed_at: null,
                  },
                  {
                    id: successTaskId,
                    workspace_id: wsId,
                    title: 'Task by valid user',
                    status: 'todo',
                    due_date: due2,
                    assigned_to: recipientId,
                    created_by: creatorId,
                    completed_at: null,
                  },
                ],
                error: null,
              });
            } else {
              resolve({ data: [], error: null });
            }
          };
          return builder;
        }),
      } as unknown as SupabaseClient<Database>;

      const res = await processUpcomingTaskReminders(client, {
        referenceTime: fixedNow,
      });

      expect(res.evaluated).toBe(2);
      expect(res.errors).toBe(1); // Item 1 failed membership validation safely
      expect(res.created).toBe(1); // Item 2 succeeded despite item 1 failure
      expect(res.errorMessages[0]).toContain('Task reminder dispatch failed');
    });
  });

  // ============================================================================
  // 5. PROCESS ALL REMINDERS (AGGREGATOR)
  // ============================================================================
  describe('processAllReminders', () => {
    it('executes all 3 reminder processors and returns a consolidated summary', async () => {
      const taskDue = new Date(fixedNow.getTime() + 30 * 60 * 1000).toISOString();
      const overdueDue = new Date(fixedNow.getTime() - 60 * 60 * 1000).toISOString();
      const contentSched = new Date(fixedNow.getTime() + 40 * 60 * 1000).toISOString();

      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Task A',
            status: 'todo',
            due_date: taskDue,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
        contentItems: [
          {
            id: contentId,
            workspace_id: wsId,
            title: 'Content A',
            platform: 'linkedin',
            status: 'scheduled',
            scheduled_at: contentSched,
            created_by: recipientId,
          },
        ],
      });

      const summary = await processAllReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(summary.success).toBe(true);
      expect(summary.referenceTime).toBe(fixedNow.toISOString());
      expect(summary.totalCreated).toBe(2); // 1 upcoming task + 1 upcoming content
      expect(summary.results.upcomingTasks.created).toBe(1);
      expect(summary.results.overdueTasks.created).toBe(0);
      expect(summary.results.upcomingContent.created).toBe(1);
      expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================================
  // 6. PREFERENCE ENFORCEMENT & OPT-OUT INVARIANTS (PHASE 5, STEP 5.2)
  // ============================================================================
  describe('Preference Enforcement & Opt-Out Invariants', () => {
    it('skips overdue task when in_app_notifications_enabled is false', async () => {
      const pastDueDate = new Date(fixedNow.getTime() - 3600000).toISOString();
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Task Overdue In-App Disabled',
            status: 'todo',
            due_date: pastDueDate,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
        preferences: {
          id: 'pref-1',
          workspace_id: wsId,
          user_id: recipientId,
          in_app_notifications_enabled: false, // master toggle off
          notify_overdue_tasks: true,
          reminder_lead_minutes: 60,
        },
      });

      const res = await processOverdueTaskReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
      expect(mockClient._insertedNotifications).toHaveLength(0);
    });

    it('skips upcoming content when in_app_notifications_enabled is false', async () => {
      const sched = new Date(fixedNow.getTime() + 1800000).toISOString();
      const mockClient = createMockSupabase({
        contentItems: [
          {
            id: contentId,
            workspace_id: wsId,
            title: 'Content In-App Disabled',
            platform: 'reddit',
            status: 'scheduled',
            scheduled_at: sched,
            created_by: recipientId,
          },
        ],
        preferences: {
          id: 'pref-1',
          workspace_id: wsId,
          user_id: recipientId,
          in_app_notifications_enabled: false, // master toggle off
          notify_upcoming_content: true,
          reminder_lead_minutes: 60,
        },
      });

      const res = await processUpcomingContentReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
      expect(mockClient._insertedNotifications).toHaveLength(0);
    });

    it('uses canonical default preferences (60 min lead, all enabled) when no preference row exists', async () => {
      // Due in 45 minutes, no preference row in database
      const dueDate = new Date(fixedNow.getTime() + 45 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Task for User with No Prefs',
            status: 'todo',
            due_date: dueDate,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
        preferences: null, // triggers in-memory defaults
      });

      const res = await processUpcomingTaskReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.created).toBe(1);
      expect(mockClient._insertedNotifications).toHaveLength(1);
      expect(mockClient._insertedNotifications[0].message).toContain('60 min reminder');
    });

    it('fails closed and records error when preference lookup throws, without sending notification', async () => {
      const dueDate = new Date(fixedNow.getTime() + 30 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Task with broken preferences query',
            status: 'todo',
            due_date: dueDate,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
        preferenceError: new Error('Postgres connection pool exhausted'),
      });

      const res = await processUpcomingTaskReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(0);
      expect(res.errors).toBe(1);
      expect(res.errorMessages[0]).toContain('Postgres connection pool exhausted');
      expect(mockClient._insertedNotifications).toHaveLength(0);
    });
  });

  // ============================================================================
  // 7. TIMING BOUNDARY CONDITIONS (PHASE 5, STEP 5.2)
  // ============================================================================
  describe('Deterministic Timing Boundary Conditions', () => {
    // Target event: due at 2026-10-29T12:00:00.000Z
    const targetDueIso = '2026-10-29T12:00:00.000Z';
    const targetDueMs = new Date(targetDueIso).getTime();
    // With 60m lead time, alert starts at 2026-10-29T11:00:00.000Z
    const leadMs = 60 * 60 * 1000;
    const alertStartMs = targetDueMs - leadMs;

    it('skips when clock is exactly 1ms before the alert window', async () => {
      const clockBefore = new Date(alertStartMs - 1);
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Task Timing Test',
            status: 'todo',
            due_date: targetDueIso,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
      });

      const res = await processUpcomingTaskReminders(mockClient, {
        referenceTime: clockBefore,
      });

      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
    });

    it('creates notification when clock is exactly at the start of the alert window', async () => {
      const clockAtStart = new Date(alertStartMs);
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Task Timing Test',
            status: 'todo',
            due_date: targetDueIso,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
      });

      const res = await processUpcomingTaskReminders(mockClient, {
        referenceTime: clockAtStart,
      });

      expect(res.created).toBe(1);
      expect(res.skipped).toBe(0);
    });

    it('creates notification when clock is inside the alert window', async () => {
      const clockInside = new Date(alertStartMs + 30 * 60 * 1000); // 30 min before due
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Task Timing Test',
            status: 'todo',
            due_date: targetDueIso,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
      });

      const res = await processUpcomingTaskReminders(mockClient, {
        referenceTime: clockInside,
      });

      expect(res.created).toBe(1);
    });

    it('skips upcoming reminder when clock is exactly at the due time', async () => {
      const clockAtDue = new Date(targetDueMs);
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Task Timing Test',
            status: 'todo',
            due_date: targetDueIso,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
      });

      const res = await processUpcomingTaskReminders(mockClient, {
        referenceTime: clockAtDue,
      });

      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
    });

    it('skips upcoming reminder when clock is after the due time', async () => {
      const clockAfterDue = new Date(targetDueMs + 1000);
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Task Timing Test',
            status: 'todo',
            due_date: targetDueIso,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
      });

      const res = await processUpcomingTaskReminders(mockClient, {
        referenceTime: clockAfterDue,
      });

      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
    });

    it('skips tasks with invalid or non-date due_date strings safely without crashing', async () => {
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Task Invalid Date',
            status: 'todo',
            due_date: 'not-a-valid-timestamp',
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
      });

      const res = await processUpcomingTaskReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
      expect(res.errors).toBe(0);
    });

    it('creates a new notification when task due date is rescheduled to a new future time', async () => {
      const originalDueDate = '2026-10-29T13:00:00.000Z';
      const rescheduledDueDate = '2026-10-29T16:00:00.000Z';

      // 1. First run at 12:30 (inside original window 12:00-13:00)
      const mockClient1 = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Rescheduled Task',
            status: 'todo',
            due_date: originalDueDate,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
      });

      const res1 = await processUpcomingTaskReminders(mockClient1, {
        referenceTime: new Date('2026-10-29T12:30:00.000Z'),
      });
      expect(res1.created).toBe(1);
      expect(mockClient1._insertedNotifications[0].idempotency_key).toBe(`task_upcoming:${taskId}:${originalDueDate}`);

      // 2. Second run at 15:30 with rescheduled due date (inside new window 15:00-16:00)
      const mockClient2 = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Rescheduled Task',
            status: 'todo',
            due_date: rescheduledDueDate,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
      });

      const res2 = await processUpcomingTaskReminders(mockClient2, {
        referenceTime: new Date('2026-10-29T15:30:00.000Z'),
      });
      expect(res2.created).toBe(1);
      expect(mockClient2._insertedNotifications[0].idempotency_key).toBe(`task_upcoming:${taskId}:${rescheduledDueDate}`);
    });

    it('overdue task: creates reminder 1ms after due date, but skips if clock is at or before due date', async () => {
      const taskDue = '2026-10-29T12:00:00.000Z';

      // Clock exactly at due time: not strictly overdue
      const clientAtDue = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Overdue Edge Case',
            status: 'todo',
            due_date: taskDue,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
      });
      const resAtDue = await processOverdueTaskReminders(clientAtDue, {
        referenceTime: new Date(taskDue),
      });
      expect(resAtDue.created).toBe(0);

      // Clock 1ms past due: overdue!
      const clientPastDue = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Overdue Edge Case',
            status: 'todo',
            due_date: taskDue,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
      });
      const resPastDue = await processOverdueTaskReminders(clientPastDue, {
        referenceTime: new Date('2026-10-29T12:00:00.001Z'),
      });
      expect(resPastDue.created).toBe(1);
    });

    it('overdue task: skips tasks that are older than the lookback window (e.g. 50 hours old with 48h lookback)', async () => {
      // 50 hours ago
      const ancientDueDate = new Date(fixedNow.getTime() - 50 * 60 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Ancient Overdue Task',
            status: 'todo',
            due_date: ancientDueDate,
            assigned_to: recipientId,
            created_by: creatorId,
            completed_at: null,
          },
        ],
      });

      const res = await processOverdueTaskReminders(mockClient, {
        referenceTime: fixedNow,
        overdueLookbackMs: 48 * 60 * 60 * 1000, // 48h limit
      });

      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
    });
  });

  // ============================================================================
  // 8. RECIPIENT ASSIGNMENT & WORKSPACE ISOLATION (PHASE 5, STEP 5.2)
  // ============================================================================
  describe('Recipient Assignment & Workspace Isolation', () => {
    it('skips task reminder when both assigned_to and created_by are missing (null)', async () => {
      const dueDate = new Date(fixedNow.getTime() + 30 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Orphaned Task',
            status: 'todo',
            due_date: dueDate,
            assigned_to: null,
            created_by: null,
            completed_at: null,
          },
        ],
      });

      const res = await processUpcomingTaskReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
      expect(res.errors).toBe(0);
    });

    it('skips content reminder when created_by is null', async () => {
      const sched = new Date(fixedNow.getTime() + 30 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        contentItems: [
          {
            id: contentId,
            workspace_id: wsId,
            title: 'Orphaned Content',
            platform: 'linkedin',
            status: 'scheduled',
            scheduled_at: sched,
            created_by: null,
          },
        ],
      });

      const res = await processUpcomingContentReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
      expect(res.errors).toBe(0);
    });

    it('fails closed when recipient is not an active member of the workspace (memberRole = null)', async () => {
      const dueDate = new Date(fixedNow.getTime() + 30 * 60 * 1000).toISOString();
      const mockClient = createMockSupabase({
        tasks: [
          {
            id: taskId,
            workspace_id: wsId,
            title: 'Task for ex-member',
            status: 'todo',
            due_date: dueDate,
            assigned_to: '44444444-4444-4444-a444-444444444444',
            created_by: creatorId,
            completed_at: null,
          },
        ],
        memberRole: null, // simulates removed/non-member
      });

      const res = await processUpcomingTaskReminders(mockClient, {
        referenceTime: fixedNow,
      });

      expect(res.evaluated).toBe(1);
      expect(res.created).toBe(0);
      expect(res.errors).toBe(1);
      expect(res.errorMessages[0]).toContain('is not an active member of workspace');
      expect(mockClient._insertedNotifications).toHaveLength(0);
    });
  });
});
