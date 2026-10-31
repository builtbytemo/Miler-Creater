import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getNotificationsAction,
  getUnreadNotificationCountAction,
  markNotificationAsReadAction,
  markNotificationAsUnreadAction,
  markAllNotificationsAsReadAction,
  dismissNotificationAction,
  getNotificationPreferencesAction,
  updateNotificationPreferencesAction,
} from '../src/lib/actions/notification-actions';
import {
  completeTaskAction,
  cancelTaskAction,
  updateTaskAction,
} from '../src/lib/actions/task-actions';
import { updateContentItemAction } from '../src/lib/actions/content-actions';
import * as notificationService from '../src/lib/services/notification-service';
import * as taskService from '../src/lib/services/task-service';
import * as contentService from '../src/lib/services/content-service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';

// Mock dependencies
const mockRevalidatePath = vi.fn();
const mockGetUser = vi.fn();
const mockWorkspaceMembersSelect = vi.fn();

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => mockRevalidatePath(path),
}));

const mockSupabase = {
  auth: {
    getUser: () => mockGetUser(),
  },
  from: vi.fn((table: string) => {
    if (table === 'workspace_members') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: () => mockWorkspaceMembersSelect(),
      };
    }
    throw new Error(`Unexpected table queried in mockSupabase: ${table}`);
  }),
} as unknown as SupabaseClient<Database>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
}));

const wsId = '11111111-1111-4111-a111-111111111111';
const actorId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const creatorId = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb';
const notifId = '22222222-2222-4222-a222-222222222222';
const taskId = '33333333-3333-4333-a333-333333333333';
const contentId = '44444444-4444-4444-a444-444444444444';

const mockAdminSupabase = {
  from: vi.fn((table: string) => {
    const builder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(async () => {
        if (table === 'notification_preferences') {
          return {
            data: {
              workspace_id: wsId,
              user_id: creatorId,
              notify_upcoming_tasks: true,
              notify_overdue_tasks: true,
              notify_upcoming_content: true,
              notify_status_changes: true,
              reminder_lead_minutes: 15,
              email_notifications_enabled: false,
              in_app_notifications_enabled: true,
            },
            error: null,
          };
        }
        if (table === 'workspace_members') {
          return { data: { role: 'member' }, error: null };
        }
        return { data: null, error: null };
      }),
      single: vi.fn().mockImplementation(async () => {
        return { data: { id: notifId }, error: null };
      }),
    };
    return builder;
  }),
} as unknown as SupabaseClient<Database>;

const mockCreateAdminClient = vi.fn(() => mockAdminSupabase);

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

vi.mock('@/lib/services/notification-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/services/notification-service')>();
  return {
    ...actual,
    getNotifications: vi.fn(),
    getUnreadNotificationCount: vi.fn(),
    markNotificationAsRead: vi.fn(),
    markNotificationAsUnread: vi.fn(),
    markAllNotificationsAsRead: vi.fn(),
    dismissNotification: vi.fn(),
    getNotificationPreferences: vi.fn(),
    saveNotificationPreferences: vi.fn(),
    notifyDomainEvent: vi.fn(),
  };
});

vi.mock('@/lib/services/task-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/services/task-service')>();
  return {
    ...actual,
    completeTask: vi.fn(),
    cancelTask: vi.fn(),
    updateTask: vi.fn(),
  };
});

vi.mock('@/lib/services/content-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/services/content-service')>();
  return {
    ...actual,
    updateContentItem: vi.fn(),
  };
});

describe('Notification Server Actions & Domain Event Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Part B: Notification Server Actions', () => {
    describe('Authentication and Authorization Enforcements', () => {
      it('rejects getNotificationsAction when user is unauthenticated', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: null } });

        const res = await getNotificationsAction(wsId);
        expect(res).toEqual({ error: 'Authentication required' });
      });

      it('rejects getNotificationsAction when workspace membership is invalid', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: null, error: null });

        const res = await getNotificationsAction(wsId);
        expect(res.error).toMatch(/Unauthorized/);
      });

      it('resolves default workspace if none is supplied', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        mockWorkspaceMembersSelect.mockResolvedValueOnce({
          data: { workspace_id: wsId },
          error: null,
        });
        vi.mocked(notificationService.getNotifications).mockResolvedValueOnce({
          notifications: [],
          total: 0,
          page: 1,
          limit: 20,
          hasMore: false,
        });

        const res = await getNotificationsAction();
        expect(res.success).toBe(true);
        expect(notificationService.getNotifications).toHaveBeenCalledWith(
          expect.anything(),
          wsId,
          actorId,
          expect.anything()
        );
      });
    });

    describe('getNotificationsAction & getUnreadNotificationCountAction', () => {
      it('derives recipient user ID strictly from the authenticated session', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'member' }, error: null });
        vi.mocked(notificationService.getNotifications).mockResolvedValueOnce({
          notifications: [],
          total: 0,
          page: 1,
          limit: 10,
          hasMore: false,
        });

        const res = await getNotificationsAction(wsId, { limit: 10, unread_only: true });
        expect(res.success).toBe(true);
        expect(notificationService.getNotifications).toHaveBeenCalledWith(
          expect.anything(),
          wsId,
          actorId, // recipient is strictly the authenticated user
          expect.objectContaining({ limit: 10, unread_only: true })
        );
      });

      it('retrieves unread notification count', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'member' }, error: null });
        vi.mocked(notificationService.getUnreadNotificationCount).mockResolvedValueOnce(5);

        const res = await getUnreadNotificationCountAction(wsId);
        expect(res).toEqual({ success: true, data: 5 });
        expect(notificationService.getUnreadNotificationCount).toHaveBeenCalledWith(
          expect.anything(),
          wsId,
          actorId
        );
      });
    });

    describe('Lifecycle Actions (read, unread, mark all read, dismiss)', () => {
      it('markNotificationAsReadAction marks notification as read and revalidates dashboard', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'member' }, error: null });
        const mockNotification = { id: notifId, read_at: new Date().toISOString() } as any;
        vi.mocked(notificationService.markNotificationAsRead).mockResolvedValueOnce(mockNotification);

        const res = await markNotificationAsReadAction(wsId, notifId);
        expect(res).toEqual({ success: true, data: mockNotification });
        expect(notificationService.markNotificationAsRead).toHaveBeenCalledWith(
          expect.anything(),
          wsId,
          actorId,
          notifId
        );
        expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
      });

      it('markNotificationAsUnreadAction marks notification as unread', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'member' }, error: null });
        const mockNotification = { id: notifId, read_at: null } as any;
        vi.mocked(notificationService.markNotificationAsUnread).mockResolvedValueOnce(mockNotification);

        const res = await markNotificationAsUnreadAction(wsId, notifId);
        expect(res).toEqual({ success: true, data: mockNotification });
        expect(notificationService.markNotificationAsUnread).toHaveBeenCalledWith(
          expect.anything(),
          wsId,
          actorId,
          notifId
        );
        expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
      });

      it('markAllNotificationsAsReadAction marks all notifications as read', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'member' }, error: null });
        vi.mocked(notificationService.markAllNotificationsAsRead).mockResolvedValueOnce(4);

        const res = await markAllNotificationsAsReadAction(wsId);
        expect(res).toEqual({ success: true, data: { updatedCount: 4 } });
        expect(notificationService.markAllNotificationsAsRead).toHaveBeenCalledWith(
          expect.anything(),
          wsId,
          actorId
        );
        expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
      });

      it('dismissNotificationAction dismisses notification by updating status to dismissed', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'member' }, error: null });
        const mockNotification = { id: notifId, status: 'dismissed' as const } as any;
        vi.mocked(notificationService.dismissNotification).mockResolvedValueOnce(mockNotification);

        const res = await dismissNotificationAction(wsId, notifId);
        expect(res).toEqual({ success: true, data: mockNotification });
        expect(res.data?.status).toBe('dismissed');
        expect(notificationService.dismissNotification).toHaveBeenCalledWith(
          expect.anything(),
          wsId,
          actorId,
          notifId
        );
        expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
      });
    });

    describe('Preferences Actions', () => {
      it('getNotificationPreferencesAction retrieves user preferences', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'member' }, error: null });
        const mockPrefs = {
          id: 'pref-1',
          workspace_id: wsId,
          user_id: actorId,
          notify_upcoming_tasks: true,
          notify_overdue_tasks: true,
          notify_upcoming_content: true,
          notify_status_changes: true,
          reminder_lead_minutes: 15,
          email_notifications_enabled: false,
          in_app_notifications_enabled: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        vi.mocked(notificationService.getNotificationPreferences).mockResolvedValueOnce(mockPrefs);

        const res = await getNotificationPreferencesAction(wsId);
        expect(res).toEqual({ success: true, data: mockPrefs });
        expect(notificationService.getNotificationPreferences).toHaveBeenCalledWith(
          expect.anything(),
          wsId,
          actorId
        );
      });

      it('updateNotificationPreferencesAction validates input and saves preferences', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'member' }, error: null });
        const savedPrefs = { id: 'pref-1' } as any;
        vi.mocked(notificationService.saveNotificationPreferences).mockResolvedValueOnce(savedPrefs);

        const res = await updateNotificationPreferencesAction(wsId, {
          reminder_lead_minutes: 60,
          in_app_notifications_enabled: false,
        });

        expect(res).toEqual({ success: true, data: savedPrefs });
        expect(notificationService.saveNotificationPreferences).toHaveBeenCalledWith(
          expect.anything(),
          wsId,
          actorId,
          { reminder_lead_minutes: 60, in_app_notifications_enabled: false }
        );
      });

      it('updateNotificationPreferencesAction rejects invalid reminder_lead_minutes', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'member' }, error: null });

        const res = await updateNotificationPreferencesAction(wsId, {
          reminder_lead_minutes: -10, // negative values rejected by schema
        });

        expect(res.error).toBeDefined();
        expect(notificationService.saveNotificationPreferences).not.toHaveBeenCalled();
      });
    });
  });

  describe('Part C: Domain Event Integrations', () => {
    describe('Task State Transitions & Notifications', () => {
      it('completeTaskAction notifies creator when completed by a distinct actor', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        const completedTask = {
          id: taskId,
          title: 'Publish report',
          created_by: creatorId, // distinct from actorId
          completed_at: '2026-10-29T12:00:00.000Z',
          status: 'done' as const,
        };
        vi.mocked(taskService.completeTask).mockResolvedValueOnce({
          completedTask: completedTask as any,
          nextOccurrence: null,
        });

        const res = await completeTaskAction(wsId, taskId);

        expect(res.success).toBe(true);
        expect(notificationService.notifyDomainEvent).toHaveBeenCalledWith(
          mockAdminSupabase,
          expect.objectContaining({
            workspaceId: wsId,
            recipientId: creatorId,
            actorId,
            title: 'Task Completed: Publish report',
            entityType: 'task',
            entityId: taskId,
            idempotencyKey: `task_completed:${taskId}:2026-10-29T12:00:00.000Z`,
            preferenceCategory: 'notify_status_changes',
          })
        );
      });

      it('completeTaskAction suppresses notification when actor is the creator', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        const completedTask = {
          id: taskId,
          title: 'My own task',
          created_by: actorId, // SAME as actorId
          completed_at: '2026-10-29T12:00:00.000Z',
          status: 'done' as const,
        };
        vi.mocked(taskService.completeTask).mockResolvedValueOnce({
          completedTask: completedTask as any,
          nextOccurrence: null,
        });

        const res = await completeTaskAction(wsId, taskId);

        expect(res.success).toBe(true);
        expect(notificationService.notifyDomainEvent).not.toHaveBeenCalled();
      });

      it('completeTaskAction succeeds even if notification dispatch throws or admin client fails', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        const completedTask = {
          id: taskId,
          title: 'Important task',
          created_by: creatorId,
          completed_at: '2026-10-29T12:00:00.000Z',
          status: 'done' as const,
        };
        vi.mocked(taskService.completeTask).mockResolvedValueOnce({
          completedTask: completedTask as any,
          nextOccurrence: null,
        });
        mockCreateAdminClient.mockImplementationOnce(() => {
          throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
        });

        // Action must not throw and must return success
        const res = await completeTaskAction(wsId, taskId);
        expect(res.success).toBe(true);
      });

      it('cancelTaskAction notifies creator when cancelled by a distinct actor', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        const cancelledTask = {
          id: taskId,
          title: 'Legacy task',
          created_by: creatorId,
          status: 'cancelled' as const,
          updated_at: '2026-10-29T14:00:00.000Z',
        };
        vi.mocked(taskService.cancelTask).mockResolvedValueOnce(cancelledTask as any);

        const res = await cancelTaskAction(wsId, taskId);

        expect(res.success).toBe(true);
        expect(notificationService.notifyDomainEvent).toHaveBeenCalledWith(
          mockAdminSupabase,
          expect.objectContaining({
            workspaceId: wsId,
            recipientId: creatorId,
            actorId,
            title: 'Task Cancelled: Legacy task',
            idempotencyKey: `task_cancelled:${taskId}:2026-10-29T14:00:00.000Z`,
            preferenceCategory: 'notify_status_changes',
          })
        );
      });

      it('cancelTaskAction suppresses notification when actor is the creator', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        const cancelledTask = {
          id: taskId,
          title: 'My legacy task',
          created_by: actorId,
          status: 'cancelled' as const,
        };
        vi.mocked(taskService.cancelTask).mockResolvedValueOnce(cancelledTask as any);

        const res = await cancelTaskAction(wsId, taskId);

        expect(res.success).toBe(true);
        expect(notificationService.notifyDomainEvent).not.toHaveBeenCalled();
      });

      it('updateTaskAction notifies creator when task status is set to blocked', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        const blockedTask = {
          id: taskId,
          title: 'API Integration',
          created_by: creatorId,
          updated_at: '2026-10-29T15:00:00.000Z',
          status: 'blocked' as const,
        };
        vi.mocked(taskService.updateTask).mockResolvedValueOnce(blockedTask as any);

        const formData = new FormData();
        formData.append('workspace_id', wsId);
        formData.append('task_id', taskId);
        formData.append('status', 'blocked');

        const res = await updateTaskAction(null, formData);

        expect(res.success).toBe(true);
        expect(notificationService.notifyDomainEvent).toHaveBeenCalledWith(
          mockAdminSupabase,
          expect.objectContaining({
            workspaceId: wsId,
            recipientId: creatorId,
            actorId,
            title: 'Task Blocked: API Integration',
            entityType: 'task',
            entityId: taskId,
            idempotencyKey: `task_blocked:${taskId}:2026-10-29T15:00:00.000Z`,
            preferenceCategory: 'notify_status_changes',
          })
        );
      });

      it('allows repeated legitimate transitions when a task is reopened and re-cancelled with distinct timestamps', async () => {
        // Occurrence 1: First cancellation at 10:00
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        const firstCancellation = {
          id: taskId,
          title: 'Lifecycle task',
          created_by: creatorId,
          status: 'cancelled' as const,
          updated_at: '2026-10-29T10:00:00.000Z',
        };
        vi.mocked(taskService.cancelTask).mockResolvedValueOnce(firstCancellation as any);

        await cancelTaskAction(wsId, taskId);

        expect(notificationService.notifyDomainEvent).toHaveBeenCalledWith(
          mockAdminSupabase,
          expect.objectContaining({
            idempotencyKey: `task_cancelled:${taskId}:2026-10-29T10:00:00.000Z`,
          })
        );

        // Occurrence 2: Task was reopened, then cancelled again at 14:00 (new transition timestamp)
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        const secondCancellation = {
          id: taskId,
          title: 'Lifecycle task',
          created_by: creatorId,
          status: 'cancelled' as const,
          updated_at: '2026-10-29T14:00:00.000Z',
        };
        vi.mocked(taskService.cancelTask).mockResolvedValueOnce(secondCancellation as any);

        await cancelTaskAction(wsId, taskId);

        expect(notificationService.notifyDomainEvent).toHaveBeenCalledWith(
          mockAdminSupabase,
          expect.objectContaining({
            idempotencyKey: `task_cancelled:${taskId}:2026-10-29T14:00:00.000Z`,
          })
        );
      });
    });

    describe('Content State Transitions & Notifications', () => {
      it('updateContentItemAction notifies author when content is scheduled by a collaborator', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'editor' }, error: null });

        const updatedContent = {
          id: contentId,
          platform: 'linkedin' as const,
          created_by: creatorId,
          status: 'scheduled' as const,
          scheduled_at: '2026-11-01T10:00:00.000Z',
        };
        vi.mocked(contentService.updateContentItem).mockResolvedValueOnce(updatedContent as any);

        const res = await updateContentItemAction({
          workspace_id: wsId,
          content_id: contentId,
          status: 'scheduled',
          scheduled_at: '2026-11-01T10:00:00.000Z',
        });

        expect(res.success).toBe(true);
        expect(notificationService.notifyDomainEvent).toHaveBeenCalledWith(
          mockAdminSupabase,
          expect.objectContaining({
            workspaceId: wsId,
            recipientId: creatorId,
            actorId,
            title: 'Content Scheduled: linkedin',
            entityType: 'content_item',
            entityId: contentId,
            idempotencyKey: `content_scheduled:${contentId}:2026-11-01T10:00:00.000Z`,
            preferenceCategory: 'notify_upcoming_content',
          })
        );
      });

      it('updateContentItemAction notifies author when content is archived by collaborator', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'editor' }, error: null });

        const updatedContent = {
          id: contentId,
          platform: 'x' as const,
          created_by: creatorId,
          status: 'archived' as const,
          updated_at: '2026-10-29T16:00:00.000Z',
        };
        vi.mocked(contentService.updateContentItem).mockResolvedValueOnce(updatedContent as any);

        const res = await updateContentItemAction({
          workspace_id: wsId,
          content_id: contentId,
          status: 'archived',
        });

        expect(res.success).toBe(true);
        expect(notificationService.notifyDomainEvent).toHaveBeenCalledWith(
          mockAdminSupabase,
          expect.objectContaining({
            workspaceId: wsId,
            recipientId: creatorId,
            actorId,
            title: 'Content Archived: x',
            entityType: 'content_item',
            entityId: contentId,
            idempotencyKey: `content_archived:${contentId}:2026-10-29T16:00:00.000Z`,
            preferenceCategory: 'notify_status_changes',
          })
        );
      });

      it('updateContentItemAction suppresses notification when author modifies own content', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'editor' }, error: null });

        const updatedContent = {
          id: contentId,
          platform: 'reddit' as const,
          created_by: actorId, // SAME as actorId
          status: 'scheduled' as const,
          scheduled_at: '2026-11-02T12:00:00.000Z',
        };
        vi.mocked(contentService.updateContentItem).mockResolvedValueOnce(updatedContent as any);

        const res = await updateContentItemAction({
          workspace_id: wsId,
          content_id: contentId,
          status: 'scheduled',
          scheduled_at: '2026-11-02T12:00:00.000Z',
        });

        expect(res.success).toBe(true);
        expect(notificationService.notifyDomainEvent).not.toHaveBeenCalled();
      });

      it('updateContentItemAction succeeds even if notification dispatch fails', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'editor' }, error: null });

        const updatedContent = {
          id: contentId,
          platform: 'threads' as const,
          created_by: creatorId,
          status: 'scheduled' as const,
        };
        vi.mocked(contentService.updateContentItem).mockResolvedValueOnce(updatedContent as any);
        vi.mocked(notificationService.notifyDomainEvent).mockRejectedValueOnce(
          new Error('Simulated network failure')
        );

        const res = await updateContentItemAction({
          workspace_id: wsId,
          content_id: contentId,
          status: 'scheduled',
        });

        expect(res.success).toBe(true);
        expect(res.data).toEqual(updatedContent);
      });

      it('never creates fake publishing alerts on scheduling or editing', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: actorId } } });
        mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'editor' }, error: null });

        const updatedContent = {
          id: contentId,
          platform: 'linkedin' as const,
          created_by: creatorId,
          status: 'draft' as const,
        };
        vi.mocked(contentService.updateContentItem).mockResolvedValueOnce(updatedContent as any);

        const res = await updateContentItemAction({
          workspace_id: wsId,
          content_id: contentId,
          title: 'Revised post title',
        });

        expect(res.success).toBe(true);
        expect(notificationService.notifyDomainEvent).not.toHaveBeenCalled();
      });
    });

    describe('notifyDomainEvent Safety Invariants (Actor Suppression & Preferences)', () => {
      // Unmock notifyDomainEvent for this suite to test the actual implementation logic
      const actualNotifyDomainEvent = (
        vi.importActual('../src/lib/services/notification-service') as any
      );

      it('suppresses event immediately if actorId equals recipientId', async () => {
        const { notifyDomainEvent: realNotify } = await actualNotifyDomainEvent;
        const result = await realNotify(mockAdminSupabase, {
          workspaceId: wsId,
          recipientId: actorId,
          actorId,
          title: 'Self action',
          message: 'Ignored',
        });

        expect(result).toBeNull();
      });

      it('suppresses event if recipient has disabled in-app notifications', async () => {
        const { notifyDomainEvent: realNotify } = await actualNotifyDomainEvent;
        const disabledAdminSupabase = {
          from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                workspace_id: wsId,
                user_id: creatorId,
                in_app_notifications_enabled: false,
                notify_status_changes: true,
              },
              error: null,
            }),
          })),
        } as unknown as SupabaseClient<Database>;

        const result = await realNotify(disabledAdminSupabase, {
          workspaceId: wsId,
          recipientId: creatorId,
          actorId,
          title: 'Task status changed',
          message: 'Ignored due to pref',
          preferenceCategory: 'notify_status_changes',
        });

        expect(result).toBeNull();
      });

      it('suppresses event if recipient has disabled the specific category toggle', async () => {
        const { notifyDomainEvent: realNotify } = await actualNotifyDomainEvent;
        const categoryDisabledAdmin = {
          from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                workspace_id: wsId,
                user_id: creatorId,
                in_app_notifications_enabled: true,
                notify_upcoming_content: false, // Category disabled
              },
              error: null,
            }),
          })),
        } as unknown as SupabaseClient<Database>;

        const result = await realNotify(categoryDisabledAdmin, {
          workspaceId: wsId,
          recipientId: creatorId,
          actorId,
          title: 'Content Scheduled',
          message: 'Ignored due to category pref',
          preferenceCategory: 'notify_upcoming_content',
        });

        expect(result).toBeNull();
      });

      it('creates and returns notification when preferences allow and recipient is valid', async () => {
        const { notifyDomainEvent: realNotify } = await actualNotifyDomainEvent;
        const activeAdmin = {
          from: vi.fn((table: string) => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            insert: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockImplementation(async () => {
              if (table === 'workspace_members') return { data: { role: 'member' }, error: null };
              if (table === 'notifications') return { data: null, error: null };
              return {
                data: {
                  workspace_id: wsId,
                  user_id: creatorId,
                  in_app_notifications_enabled: true,
                  notify_status_changes: true,
                },
                error: null,
              };
            }),
            single: vi.fn().mockResolvedValue({
              data: {
                id: notifId,
                title: 'Task Completed: Report',
                status: 'delivered',
              },
              error: null,
            }),
          })),
        } as unknown as SupabaseClient<Database>;

        const result = await realNotify(activeAdmin, {
          workspaceId: wsId,
          recipientId: creatorId,
          actorId,
          title: 'Task Completed: Report',
          message: 'Report is completed',
          preferenceCategory: 'notify_status_changes',
        });

        expect(result).not.toBeNull();
        expect(result.notification.id).toBe(notifId);
      });
    });
  });
});
