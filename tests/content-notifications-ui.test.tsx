import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

const {
  mockRedirect,
  mockConnection,
  mockGetUser,
  mockFrom,
  mockGetContentItems,
  mockGetIdeaInboxItems,
  mockGetSocialAccounts,
} = vi.hoisted(() => ({
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT: ${url}`);
  }),
  mockConnection: vi.fn().mockResolvedValue(undefined),
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockGetContentItems: vi.fn().mockResolvedValue([]),
  mockGetIdeaInboxItems: vi.fn().mockResolvedValue([]),
  mockGetSocialAccounts: vi.fn().mockResolvedValue([]),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/content',
}));

vi.mock('next/server', () => ({
  connection: mockConnection,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));

vi.mock('@/lib/services/content-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/services/content-service')>();
  return {
    ...actual,
    getContentItems: mockGetContentItems,
    getIdeaInboxItems: mockGetIdeaInboxItems,
    getSocialAccounts: mockGetSocialAccounts,
  };
});

vi.mock('@/lib/actions/content-actions', () => ({
  resolveAuthorizedWorkspace: vi.fn().mockResolvedValue({ workspaceId: 'ws-zahi', error: null }),
  createContentItemAction: vi.fn(),
  updateContentItemAction: vi.fn(),
  deleteContentItemAction: vi.fn(),
  createSocialAccountAction: vi.fn(),
  archiveContentItemAction: vi.fn(),
  unarchiveContentItemAction: vi.fn(),
}));

vi.mock('@/lib/actions/notification-actions', () => ({
  getUnreadNotificationCountAction: vi.fn().mockResolvedValue({ success: true, data: 0 }),
  getNotificationsAction: vi.fn().mockResolvedValue({ success: true, data: [] }),
  markNotificationAsReadAction: vi.fn(),
  markNotificationAsUnreadAction: vi.fn(),
  markAllNotificationsAsReadAction: vi.fn(),
  dismissNotificationAction: vi.fn(),
}));

import ContentPage from '../src/app/content/page';
import NotificationsPage from '../src/app/notifications/page';
import { ContentWorkspace } from '../src/components/content/ContentWorkspace';
import { ContentDetailModal } from '../src/components/content/ContentDetailModal';
import { CreateContentModal } from '../src/components/content/CreateContentModal';
import { CreateSocialAccountModal } from '../src/components/content/CreateSocialAccountModal';
import { NotificationCenter } from '../src/components/notifications/NotificationCenter';
import type { ContentItemWithMeta, SocialAccountRow } from '../src/lib/services/content-service';

const sampleAccount: SocialAccountRow = {
  id: 'acc-x',
  workspace_id: 'ws-zahi',
  platform: 'x',
  account_handle: 'zahistudio',
  account_name: 'Zahi Studio',
  avatar_url: null,
  status: 'connected',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

const sampleContentItem: ContentItemWithMeta = {
  id: 'cnt-1',
  workspace_id: 'ws-zahi',
  platform: 'x',
  action_type: 'post',
  status: 'scheduled',
  title: 'Launch thread for Zahi v1',
  body: 'Introducing restrained workspace geometry across tasks, content, and calendar.',
  scheduled_at: '2026-11-15T12:00:00Z',
  duration_minutes: 30,
  media_urls: [],
  external_links: ['https://example.com/spec'],
  target_reference: null,
  tags: ['launch', 'design'],
  notes: 'Coordinate with release changelog.',
  social_account_id: 'acc-x',
  project_id: null,
  milestone_id: null,
  recurrence_rule_id: null,
  created_by: null,
  created_at: '2026-11-01T08:00:00Z',
  updated_at: '2026-11-01T08:00:00Z',
  social_account: sampleAccount,
};

describe('Stage D: Content & Notifications UI Transformation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://zahi.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    mockConnection.mockResolvedValue(undefined);
  });

  it('normalizes user timezone in ContentPage and forwards safe fallback when invalid', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u-1', email: 'amira@zahi.local', user_metadata: { full_name: 'Amira' } } },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { timezone: 'Invalid/Zone_Test' } }),
        };
      }
      if (table === 'workspace_members') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              workspace_id: 'ws-zahi',
              workspaces: { id: 'ws-zahi', name: 'Zahi Studio', slug: 'zahi-studio' },
            },
          }),
        };
      }
      if (table === 'projects') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [] }),
          }),
        };
      }
      return {};
    });

    const el = (await ContentPage()) as React.ReactElement;
    const html = renderToStaticMarkup(el);
    expect(html).toContain('Africa/Cairo');
    expect(html).not.toContain('Invalid/Zone_Test');
  });

  it('renders ContentWorkspace Zahi masthead, interactive metric buttons, @container grids, and EmptyState', () => {
    const emptyHtml = renderToStaticMarkup(
      React.createElement(ContentWorkspace, {
        workspaceId: 'ws-zahi',
        initialItems: [],
        initialIdeas: [],
        socialAccounts: [sampleAccount],
        projects: [],
        userTimeZone: 'Africa/Cairo',
      })
    );

    expect(emptyHtml).toContain('Editorial Pipeline');
    expect(emptyHtml).toContain('Africa/Cairo');
    expect(emptyHtml).toContain('Idea Inbox');
    expect(emptyHtml).toContain('Scheduled');
    expect(emptyHtml).toContain('Drafts');
    expect(emptyHtml).toContain('Archived');
    expect(emptyHtml).toContain('@md:grid-cols-2');
    expect(emptyHtml).toContain('@4xl:grid-cols-5');
    expect(emptyHtml).toContain('zahi-mascot');

    const populatedHtml = renderToStaticMarkup(
      React.createElement(ContentWorkspace, {
        workspaceId: 'ws-zahi',
        initialItems: [sampleContentItem],
        initialIdeas: [],
        socialAccounts: [sampleAccount],
        projects: [],
        userTimeZone: 'Africa/Cairo',
        initialContentId: sampleContentItem.id,
      })
    );

    expect(populatedHtml).toContain('Launch thread for Zahi v1');
    expect(populatedHtml).toContain('@3xl:grid-cols-2');
    expect(populatedHtml).toContain('surface-card-interactive');
  });

  it('uses Zahi dialog tokens and ConfirmDialog in Content modals without native confirm()', () => {
    const detailHtml = renderToStaticMarkup(
      React.createElement(ContentDetailModal, {
        isOpen: true,
        onClose: vi.fn(),
        workspaceId: 'ws-zahi',
        item: sampleContentItem,
        socialAccounts: [sampleAccount],
        projects: [],
        userTimeZone: 'Africa/Cairo',
        onContentUpdated: vi.fn(),
        onContentDeleted: vi.fn(),
      })
    );
    expect(detailHtml).toContain('role="dialog"');
    expect(detailHtml).toContain('aria-modal="true"');
    expect(detailHtml).toContain('surface-elevated');
    expect(detailHtml).toContain('Launch thread for Zahi v1');

    const createContentHtml = renderToStaticMarkup(
      React.createElement(CreateContentModal, {
        isOpen: true,
        onClose: vi.fn(),
        workspaceId: 'ws-zahi',
        socialAccounts: [sampleAccount],
        projects: [],
        userTimeZone: 'Africa/Cairo',
        onContentCreated: vi.fn(),
      })
    );
    expect(createContentHtml).toContain('role="dialog"');
    expect(createContentHtml).toContain('surface-elevated');

    const createAccountHtml = renderToStaticMarkup(
      React.createElement(CreateSocialAccountModal, {
        isOpen: true,
        onClose: vi.fn(),
        workspaceId: 'ws-zahi',
        onAccountCreated: vi.fn(),
      })
    );
    expect(createAccountHtml).toContain('role="dialog"');
    expect(createAccountHtml).toContain('surface-elevated');
    expect(createAccountHtml).toContain('input-control');

    const detailSrc = readFileSync(
      join(process.cwd(), 'src/components/content/ContentDetailModal.tsx'),
      'utf8'
    );
    expect(detailSrc).toContain('ConfirmDialog');
    expect(detailSrc).not.toMatch(/\bconfirm\s*\(/);

    const createContentSrc = readFileSync(
      join(process.cwd(), 'src/components/content/CreateContentModal.tsx'),
      'utf8'
    );
    expect(createContentSrc).not.toContain('--status-warn-text');
  });

  it('normalizes timezone in NotificationsPage and renders Zahi NotificationCenter controls', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u-1', email: 'amira@zahi.local', user_metadata: { full_name: 'Amira' } } },
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { timezone: 'Mars/Phobos' } }),
        };
      }
      if (table === 'workspaces') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'Zahi Studio' } }),
        };
      }
      return {};
    });

    const pageEl = (await NotificationsPage()) as React.ReactElement;
    expect(JSON.stringify(pageEl.props)).toContain('Africa/Cairo');
    expect(JSON.stringify(pageEl.props)).not.toContain('Mars/Phobos');
    const pageHtml = renderToStaticMarkup(pageEl);
    expect(pageHtml).toContain('Notifications Center');

    const centerHtml = renderToStaticMarkup(
      React.createElement(NotificationCenter, {
        workspaceId: 'ws-zahi',
        workspaceName: 'Zahi Studio',
        userTimeZone: 'Africa/Cairo',
      })
    );
    expect(centerHtml).toContain('Notifications Center');
    expect(centerHtml).toContain('/dashboard');
    expect(centerHtml).toContain('/settings/notifications');
    expect(centerHtml).toContain('w-auto');
    expect(centerHtml).toContain('All');
    expect(centerHtml).toContain('Unread');
  });
});
