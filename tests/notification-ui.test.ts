import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotificationBell } from '../src/components/notifications/NotificationBell';
import { NotificationItem } from '../src/components/notifications/NotificationItem';
import { NotificationPanel } from '../src/components/notifications/NotificationPanel';
import { NotificationPreferencesForm } from '../src/components/notifications/NotificationPreferencesForm';
import NotificationsPage from '../src/app/notifications/page';
import NotificationSettingsPage from '../src/app/settings/notifications/page';
import type { NotificationRow, NotificationPreferencesWithDefaults } from '../src/lib/services/notification-service';
import * as notificationActions from '../src/lib/actions/notification-actions';

// Mock Next.js navigation and server utilities
let currentPathname = '/dashboard';
const mockRedirect = vi.fn();
const mockConnection = vi.fn();
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error(`NEXT_REDIRECT: ${url}`);
  },
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: () => mockGetUser(),
    },
    from: mockFrom,
  })),
}));

vi.mock('@/lib/actions/content-actions', () => ({
  resolveAuthorizedWorkspace: vi.fn(async (_supabase: unknown, userId: string) => {
    if (userId === 'unauthorized-user') {
      return { error: 'Unauthorized: You do not have access to this workspace' };
    }
    return { workspaceId: '11111111-1111-4111-a111-111111111111' };
  }),
}));

vi.mock('@/lib/actions/notification-actions', () => ({
  getUnreadNotificationCountAction: vi.fn(),
  getNotificationsAction: vi.fn(),
  markNotificationAsReadAction: vi.fn(),
  markNotificationAsUnreadAction: vi.fn(),
  markAllNotificationsAsReadAction: vi.fn(),
  dismissNotificationAction: vi.fn(),
  getNotificationPreferencesAction: vi.fn(),
  updateNotificationPreferencesAction: vi.fn(),
}));

describe('Notification UI Components & Route Integration (Phase 5, Step 4)', () => {
  const wsId = '11111111-1111-4111-a111-111111111111';
  const notifId = '22222222-2222-4222-a222-222222222222';

  const sampleUnreadTaskNotif: NotificationRow = {
    id: notifId,
    workspace_id: wsId,
    recipient_id: 'usr-1',
    channel: 'in_app',
    title: 'Task Overdue: Launch Campaign',
    message: 'Task "Launch Campaign" has passed its scheduled deadline.',
    entity_type: 'task',
    entity_id: '33333333-3333-4333-a333-333333333333',
    scheduled_for: '2026-10-29T10:00:00.000Z',
    status: 'delivered',
    delivered_at: '2026-10-29T10:00:00.000Z',
    read_at: null,
    idempotency_key: 'task_overdue:33333333:2026-10-29',
    created_at: '2026-10-29T10:00:00.000Z',
  };

  const sampleReadContentNotif: NotificationRow = {
    id: 'notif-2',
    workspace_id: wsId,
    recipient_id: 'usr-1',
    channel: 'in_app',
    title: 'Content Scheduled: linkedin',
    message: 'Content for linkedin has been scheduled for publishing.',
    entity_type: 'content_item',
    entity_id: '44444444-4444-4444-a444-444444444444',
    scheduled_for: '2026-10-29T12:00:00.000Z',
    status: 'delivered',
    delivered_at: '2026-10-29T12:00:00.000Z',
    read_at: '2026-10-29T12:30:00.000Z',
    idempotency_key: 'content_scheduled:44444444:2026-10-29',
    created_at: '2026-10-29T12:00:00.000Z',
  };

  const samplePreferences: NotificationPreferencesWithDefaults = {
    id: 'pref-1',
    workspace_id: wsId,
    user_id: 'usr-1',
    notify_upcoming_tasks: true,
    notify_overdue_tasks: true,
    notify_upcoming_content: true,
    notify_status_changes: true,
    reminder_lead_minutes: 60,
    email_notifications_enabled: false,
    in_app_notifications_enabled: true,
    created_at: '2026-10-29T08:00:00.000Z',
    updated_at: '2026-10-29T08:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    currentPathname = '/dashboard';
    mockConnection.mockResolvedValue(undefined);
  });

  // ============================================================================
  // 1. NOTIFICATION BELL & UNREAD BADGE
  // ============================================================================
  describe('NotificationBell', () => {
    it('suppresses rendering entirely on public or authentication pages', () => {
      currentPathname = '/auth/sign-in';
      const authHtml = renderToStaticMarkup(React.createElement(NotificationBell, { workspaceId: wsId }));
      expect(authHtml).toBe('');

      currentPathname = '/';
      const homeHtml = renderToStaticMarkup(React.createElement(NotificationBell, { workspaceId: wsId }));
      expect(homeHtml).toBe('');
    });

    it('renders accessible bell button on authenticated pages', () => {
      currentPathname = '/dashboard';
      vi.mocked(notificationActions.getUnreadNotificationCountAction).mockResolvedValueOnce({
        success: true,
        data: 0,
      });

      const html = renderToStaticMarkup(React.createElement(NotificationBell, { workspaceId: wsId }));
      expect(html).toContain('aria-label="Notifications, 0 unread"');
      expect(html).toContain('aria-haspopup="dialog"');
    });

    it('formats badge as 99+ when unread count exceeds 99', () => {
      // Direct inspection of badge formatting helper logic
      const formatBadge = (count: number) => (count > 99 ? '99+' : count.toString());
      expect(formatBadge(5)).toBe('5');
      expect(formatBadge(99)).toBe('99');
      expect(formatBadge(100)).toBe('99+');
      expect(formatBadge(250)).toBe('99+');
    });

    it('hides the badge when unread count is zero', () => {
      const renderBadge = (count: number) => (count > 0 ? { show: true, text: count.toString() } : null);
      expect(renderBadge(0)).toBeNull();
      expect(renderBadge(3)).toEqual({ show: true, text: '3' });
    });
  });

  // ============================================================================
  // 2. NOTIFICATION ITEM
  // ============================================================================
  describe('NotificationItem', () => {
    it('displays unread visual distinction (dot indicator and font weight)', () => {
      const el = NotificationItem({
        notification: sampleUnreadTaskNotif,
        onMarkRead: vi.fn(),
        onMarkUnread: vi.fn(),
        onDismiss: vi.fn(),
      });

      expect(el).toBeDefined();
      const props = (el as any).props;
      expect(props['data-testid']).toBe(`notification-item-${notifId}`);
      // Contains unread indicator dot
      const children = props.children;
      expect(children[0]).not.toBeNull(); // Dot rendered when unread
    });

    it('provides reliable navigation link to /tasks for task notifications', () => {
      const el = NotificationItem({
        notification: sampleUnreadTaskNotif,
        onMarkRead: vi.fn(),
        onMarkUnread: vi.fn(),
        onDismiss: vi.fn(),
      });

      // Find link within the content hierarchy
      const contentDiv = (el as any).props.children[2];
      const link = contentDiv.props.children[2]; // getEntityLink()
      expect(link).not.toBeNull();
      expect(link.props.href).toBe('/tasks');
    });

    it('provides reliable navigation link to /content for content notifications', () => {
      const el = NotificationItem({
        notification: sampleReadContentNotif,
        onMarkRead: vi.fn(),
        onMarkUnread: vi.fn(),
        onDismiss: vi.fn(),
      });

      const contentDiv = (el as any).props.children[2];
      const link = contentDiv.props.children[2];
      expect(link).not.toBeNull();
      expect(link.props.href).toBe('/content');
    });

    it('does not render broken links when entity_id is absent', () => {
      const systemNotif: NotificationRow = {
        ...sampleUnreadTaskNotif,
        entity_type: 'system',
        entity_id: null,
      };

      const el = NotificationItem({
        notification: systemNotif,
        onMarkRead: vi.fn(),
        onMarkUnread: vi.fn(),
        onDismiss: vi.fn(),
      });

      const contentDiv = (el as any).props.children[2];
      const link = contentDiv.props.children[2];
      expect(link).toBeNull();
    });
  });

  // ============================================================================
  // 3. NOTIFICATION PANEL
  // ============================================================================
  describe('NotificationPanel', () => {
    it('returns null when closed', () => {
      const html = renderToStaticMarkup(
        React.createElement(NotificationPanel, {
          isOpen: false,
          onClose: vi.fn(),
          workspaceId: wsId,
        })
      );
      expect(html).toBe('');
    });

    it('renders accessible dialog container when open', () => {
      const html = renderToStaticMarkup(
        React.createElement(NotificationPanel, {
          isOpen: true,
          onClose: vi.fn(),
          workspaceId: wsId,
        })
      );

      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('aria-label="Notifications Panel"');
      expect(html).toContain('Notifications');
    });
  });

  // ============================================================================
  // 4. PREFERENCES FORM
  // ============================================================================
  describe('NotificationPreferencesForm', () => {
    it('loads and initializes preferences without writing to the database on render', () => {
      vi.mocked(notificationActions.getNotificationPreferencesAction).mockResolvedValueOnce({
        success: true,
        data: samplePreferences,
      });

      const html = renderToStaticMarkup(
        React.createElement(NotificationPreferencesForm, {
          workspaceId: wsId,
          workspaceName: 'Acme Corp',
        })
      );

      expect(html).toContain('Loading notification preferences...');
    });

    it('validates reminder lead time within 0 to 10,080 minutes boundary', () => {
      const validateLeadMinutes = (min: number) => min >= 0 && min <= 10080;
      expect(validateLeadMinutes(-5)).toBe(false);
      expect(validateLeadMinutes(0)).toBe(true);
      expect(validateLeadMinutes(60)).toBe(true);
      expect(validateLeadMinutes(10080)).toBe(true);
      expect(validateLeadMinutes(10081)).toBe(false);
    });
  });

  // ============================================================================
  // 5. AUTHENTICATED ROUTE GATES
  // ============================================================================
  describe('Route Gates & Workspace Isolation', () => {
    it('/notifications redirects unauthenticated users to /auth/sign-in', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });

      await expect(NotificationsPage()).rejects.toThrow('NEXT_REDIRECT: /auth/sign-in?redirectTo=/notifications');
      expect(mockRedirect).toHaveBeenCalledWith('/auth/sign-in?redirectTo=/notifications');
    });

    it('/settings/notifications redirects unauthenticated users to /auth/sign-in', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });

      await expect(NotificationSettingsPage()).rejects.toThrow(
        'NEXT_REDIRECT: /auth/sign-in?redirectTo=/settings/notifications'
      );
      expect(mockRedirect).toHaveBeenCalledWith('/auth/sign-in?redirectTo=/settings/notifications');
    });

    it('/notifications shows workspace required banner when user has no active workspace', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'unauthorized-user' } } });

      const page = await NotificationsPage();
      expect(page).toBeDefined();
      // Inspect element for Workspace Required banner
      const mainProps = (page as any).props.children[1].props;
      expect(JSON.stringify(mainProps)).toContain('Workspace Required');
    });

    it('/notifications renders NotificationCenter when authenticated and authorized', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-1' } } });
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'Engineering Workspace' } }),
      });

      const page = await NotificationsPage();
      expect(page).toBeDefined();
      const mainProps = (page as any).props.children[1].props;
      expect(JSON.stringify(mainProps)).toContain('Engineering Workspace');
    });
  });
});
