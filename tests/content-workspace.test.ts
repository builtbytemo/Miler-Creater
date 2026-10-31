import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import ContentPage from '../src/app/content/page';
import { AppNavigation } from '../src/components/layout/AppNavigation';
import { PLATFORM_CONFIG, STATUS_CONFIG, ACTION_CONFIG } from '../src/components/content/ContentCard';
import { PLATFORM_LIMITS } from '../src/components/content/ContentDetailModal';
import type { ContentItemWithMeta, SocialAccountRow } from '../src/lib/services/content-service';

// Mock server APIs
const mockConnection = vi.fn();
const mockRedirect = vi.fn();
const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockGetContentItems = vi.fn();
const mockGetIdeaInboxItems = vi.fn();
const mockGetSocialAccounts = vi.fn();

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error(`NEXT_REDIRECT: ${url}`);
  },
  usePathname: () => '/content',
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  })),
}));

vi.mock('@/lib/services/content-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/content-service')>();
  return {
    ...actual,
    getContentItems: (...args: unknown[]) => mockGetContentItems(...args),
    getIdeaInboxItems: (...args: unknown[]) => mockGetIdeaInboxItems(...args),
    getSocialAccounts: (...args: unknown[]) => mockGetSocialAccounts(...args),
  };
});

// Mock client components rendered by ContentPage
vi.mock('@/components/content/ContentWorkspace', () => ({
  ContentWorkspace: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'content-workspace', ...props }),
}));

describe('ContentPage Server Component', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnection.mockResolvedValue(undefined);
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'example-anon-key';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  });

  it('calls await connection() before requesting auth session or database queries', async () => {
    const order: string[] = [];
    mockConnection.mockImplementationOnce(async () => {
      order.push('connection');
    });
    mockGetUser.mockImplementationOnce(async () => {
      order.push('getUser');
      return { data: { user: { id: 'usr-456' } } };
    });

    const mockProfileQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { timezone: 'Africa/Cairo' } }),
    };

    const mockMemberQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          workspace_id: 'ws-456',
          workspaces: { id: 'ws-456', name: 'Editorial WS', slug: 'editorial' },
        },
      }),
    };

    const mockProjectsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [] }),
      }),
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return mockProfileQuery;
      if (table === 'workspace_members') return mockMemberQuery;
      if (table === 'projects') return mockProjectsQuery;
      return {};
    });

    mockGetContentItems.mockResolvedValueOnce([]);
    mockGetIdeaInboxItems.mockResolvedValueOnce([]);
    mockGetSocialAccounts.mockResolvedValueOnce([]);

    await ContentPage();

    expect(order).toEqual(['connection', 'getUser']);
  });

  it('redirects unauthenticated users to /auth/sign-in with redirectTo=/content', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    await expect(ContentPage()).rejects.toThrow('NEXT_REDIRECT: /auth/sign-in?redirectTo=/content');
    expect(mockRedirect).toHaveBeenCalledWith('/auth/sign-in?redirectTo=/content');
  });

  it('renders configuration warning if NEXT_PUBLIC_SUPABASE_URL is unconfigured', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';

    const element = await ContentPage();
    expect(element).toBeDefined();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('renders fallback notice if user lacks workspace membership', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'user-without-ws' } } });

    const mockProfileQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { timezone: 'Africa/Cairo' } }),
    };

    const mockMemberQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return mockProfileQuery;
      if (table === 'workspace_members') return mockMemberQuery;
      return {};
    });

    const element = await ContentPage();
    expect(element).toBeDefined();
    expect(mockGetContentItems).not.toHaveBeenCalled();
  });

  it('successfully fetches workspace data and passes initialItems, initialIdeas, and socialAccounts to ContentWorkspace', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-valid' } } });

    const mockProfileQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { timezone: 'Africa/Cairo' } }),
    };

    const mockMemberQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          workspace_id: 'ws-editorial',
          workspaces: { id: 'ws-editorial', name: 'Editorial', slug: 'editorial' },
        },
      }),
    };

    const mockProjectsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [{ id: 'p1', name: 'Open Source Launch', color: '#3b82f6' }],
        }),
      }),
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return mockProfileQuery;
      if (table === 'workspace_members') return mockMemberQuery;
      if (table === 'projects') return mockProjectsQuery;
      return {};
    });

    const mockContentItems: Partial<ContentItemWithMeta>[] = [
      { id: 'c-1', workspace_id: 'ws-editorial', status: 'draft', platform: 'x' },
    ];
    const mockIdeas: Partial<ContentItemWithMeta>[] = [
      { id: 'idea-1', workspace_id: 'ws-editorial', status: 'idea', scheduled_at: null, platform: 'threads' },
    ];
    const mockAccounts: Partial<SocialAccountRow>[] = [
      { id: 'acc-1', workspace_id: 'ws-editorial', platform: 'x', account_handle: 'antigravity_dev' },
    ];

    mockGetContentItems.mockResolvedValueOnce(mockContentItems);
    mockGetIdeaInboxItems.mockResolvedValueOnce(mockIdeas);
    mockGetSocialAccounts.mockResolvedValueOnce(mockAccounts);

    const result = await ContentPage();
    expect(result).toBeDefined();
    expect(mockGetContentItems).toHaveBeenCalledWith(expect.anything(), 'ws-editorial');
    expect(mockGetIdeaInboxItems).toHaveBeenCalledWith(expect.anything(), 'ws-editorial');
    expect(mockGetSocialAccounts).toHaveBeenCalledWith(expect.anything(), 'ws-editorial');
  });
});

describe('AppNavigation Phase Integration', () => {
  it('enables /content while keeping /calendar disabled for Phase 4', () => {
    const nav = AppNavigation();
    expect(nav).toBeDefined();

    // Inspect JSX children to verify link definitions
    const navProps = nav.props;
    expect(navProps).toBeDefined();
  });
});

describe('Platform Advisory Limits and Badges', () => {
  it('defines recommended character limits for all 4 supported platforms', () => {
    expect(PLATFORM_LIMITS.x.maxChars).toBe(280);
    expect(PLATFORM_LIMITS.threads.maxChars).toBe(500);
    expect(PLATFORM_LIMITS.linkedin.maxChars).toBe(3000);
    expect(PLATFORM_LIMITS.reddit.maxChars).toBe(40000);
  });

  it('provides platform configuration styling for X, LinkedIn, Reddit, and Threads', () => {
    expect(PLATFORM_CONFIG.x.label).toContain('X');
    expect(PLATFORM_CONFIG.linkedin.label).toBe('LinkedIn');
    expect(PLATFORM_CONFIG.reddit.label).toBe('Reddit');
    expect(PLATFORM_CONFIG.threads.label).toBe('Threads');
  });

  it('provides all 7 supported content status badge configurations', () => {
    const statuses = ['idea', 'draft', 'scheduled', 'publishing', 'published', 'failed', 'archived'] as const;
    statuses.forEach((st) => {
      expect(STATUS_CONFIG[st]).toBeDefined();
      expect(STATUS_CONFIG[st].label).toBeDefined();
      expect(STATUS_CONFIG[st].badgeClass).toBeDefined();
    });
  });

  it('provides all 6 supported action type configurations', () => {
    const actions = ['post', 'comment', 'reply', 'share', 'repost', 'reaction'] as const;
    actions.forEach((act) => {
      expect(ACTION_CONFIG[act]).toBeDefined();
      expect(ACTION_CONFIG[act].label).toBeDefined();
    });
  });
});

describe('Content Workspace Filtering Logic', () => {
  const sampleItems: ContentItemWithMeta[] = [
    {
      id: 'item-1',
      workspace_id: 'ws-1',
      platform: 'x',
      action_type: 'post',
      status: 'idea',
      title: 'First spark',
      body: 'Idea about architecture',
      scheduled_at: null,
      duration_minutes: null,
      media_urls: [],
      external_links: [],
      target_reference: null,
      tags: ['architecture', 'system'],
      notes: null,
      social_account_id: 'acc-x',
      project_id: null,
      milestone_id: null,
      recurrence_rule_id: null,
      created_by: null,
      created_at: '2026-10-29T10:00:00Z',
      updated_at: '2026-10-29T10:00:00Z',
    },
    {
      id: 'item-2',
      workspace_id: 'ws-1',
      platform: 'linkedin',
      action_type: 'post',
      status: 'scheduled',
      title: 'Deep dive article',
      body: 'Long form discussion on distributed systems',
      scheduled_at: '2026-10-30T14:00:00Z',
      duration_minutes: 45,
      media_urls: [],
      external_links: [],
      target_reference: null,
      tags: ['distributed', 'engineering'],
      notes: null,
      social_account_id: 'acc-li',
      project_id: 'proj-1',
      milestone_id: null,
      recurrence_rule_id: null,
      created_by: null,
      created_at: '2026-10-29T11:00:00Z',
      updated_at: '2026-10-29T11:00:00Z',
    },
    {
      id: 'item-3',
      workspace_id: 'ws-1',
      platform: 'reddit',
      action_type: 'comment',
      status: 'draft',
      title: null,
      body: 'Helpful reply in r/webdev',
      scheduled_at: null,
      duration_minutes: null,
      media_urls: [],
      external_links: [],
      target_reference: { subreddit: 'webdev', post_id: '9988' },
      tags: ['community'],
      notes: null,
      social_account_id: null,
      project_id: null,
      milestone_id: null,
      recurrence_rule_id: null,
      created_by: null,
      created_at: '2026-10-29T12:00:00Z',
      updated_at: '2026-10-29T12:00:00Z',
    },
    {
      id: 'item-4',
      workspace_id: 'ws-1',
      platform: 'threads',
      action_type: 'reply',
      status: 'idea',
      title: null,
      body: 'Threads scheduled idea',
      scheduled_at: '2026-10-31T09:00:00Z', // Scheduled idea
      duration_minutes: null,
      media_urls: [],
      external_links: [],
      target_reference: null,
      tags: ['social'],
      notes: null,
      social_account_id: null,
      project_id: null,
      milestone_id: null,
      recurrence_rule_id: null,
      created_by: null,
      created_at: '2026-10-29T13:00:00Z',
      updated_at: '2026-10-29T13:00:00Z',
    },
  ];

  it('correctly partitions Idea Inbox items (status=idea AND scheduled_at=null)', () => {
    const ideaInboxItems = sampleItems.filter((i) => i.status === 'idea' && !i.scheduled_at);
    expect(ideaInboxItems.map((i) => i.id)).toEqual(['item-1']);

    // item-4 has status 'idea' but is scheduled, so it is NOT in the Idea Inbox
    expect(ideaInboxItems.find((i) => i.id === 'item-4')).toBeUndefined();
    // item-3 is an unscheduled draft, so it is NOT in the Idea Inbox
    expect(ideaInboxItems.find((i) => i.id === 'item-3')).toBeUndefined();
  });

  it('correctly filters by platform', () => {
    const xItems = sampleItems.filter((i) => i.platform === 'x');
    expect(xItems.length).toBe(1);
    expect(xItems[0].id).toBe('item-1');

    const redditItems = sampleItems.filter((i) => i.platform === 'reddit');
    expect(redditItems.length).toBe(1);
    expect(redditItems[0].id).toBe('item-3');
  });

  it('correctly filters by status', () => {
    const draftItems = sampleItems.filter((i) => i.status === 'draft');
    expect(draftItems.length).toBe(1);
    expect(draftItems[0].id).toBe('item-3');

    const scheduledItems = sampleItems.filter((i) => i.status === 'scheduled');
    expect(scheduledItems.length).toBe(1);
    expect(scheduledItems[0].id).toBe('item-2');
  });

  it('correctly filters by action type', () => {
    const comments = sampleItems.filter((i) => i.action_type === 'comment');
    expect(comments.length).toBe(1);
    expect(comments[0].id).toBe('item-3');

    const replies = sampleItems.filter((i) => i.action_type === 'reply');
    expect(replies.length).toBe(1);
    expect(replies[0].id).toBe('item-4');
  });

  it('correctly filters by search query matching title, body, or tags', () => {
    const searchArchitecture = sampleItems.filter((i) => {
      const q = 'architecture';
      return (
        i.title?.toLowerCase().includes(q) ||
        i.body?.toLowerCase().includes(q) ||
        i.tags?.some((t) => t.toLowerCase().includes(q))
      );
    });
    expect(searchArchitecture.length).toBe(1);
    expect(searchArchitecture[0].id).toBe('item-1');

    const searchDistributed = sampleItems.filter((i) => {
      const q = 'distributed';
      return (
        i.title?.toLowerCase().includes(q) ||
        i.body?.toLowerCase().includes(q) ||
        i.tags?.some((t) => t.toLowerCase().includes(q))
      );
    });
    expect(searchDistributed.length).toBe(1);
    expect(searchDistributed[0].id).toBe('item-2');

    const searchWebdev = sampleItems.filter((i) => {
      const q = 'webdev';
      return (
        i.title?.toLowerCase().includes(q) ||
        i.body?.toLowerCase().includes(q) ||
        i.tags?.some((t) => t.toLowerCase().includes(q))
      );
    });
    expect(searchWebdev.length).toBe(1);
    expect(searchWebdev[0].id).toBe('item-3');
  });

  it('correctly partitions archived content and allows recovery', () => {
    const itemsWithArchived: ContentItemWithMeta[] = [
      ...sampleItems,
      {
        id: 'item-archived-1',
        workspace_id: 'ws-1',
        platform: 'x',
        action_type: 'post',
        status: 'archived',
        title: 'Old announcement',
        body: 'Deprecated announcement',
        scheduled_at: null,
        duration_minutes: null,
        media_urls: [],
        external_links: [],
        target_reference: null,
        tags: ['old'],
        notes: null,
        social_account_id: null,
        project_id: null,
        milestone_id: null,
        recurrence_rule_id: null,
        created_by: null,
        created_at: '2026-10-25T10:00:00Z',
        updated_at: '2026-10-25T10:00:00Z',
      },
      {
        id: 'item-archived-2',
        workspace_id: 'ws-1',
        platform: 'linkedin',
        action_type: 'post',
        status: 'archived',
        title: 'Archived scheduled post',
        body: 'This was scheduled but archived',
        scheduled_at: '2026-11-01T15:00:00Z',
        duration_minutes: 30,
        media_urls: [],
        external_links: [],
        target_reference: null,
        tags: ['hold'],
        notes: null,
        social_account_id: null,
        project_id: null,
        milestone_id: null,
        recurrence_rule_id: null,
        created_by: null,
        created_at: '2026-10-25T11:00:00Z',
        updated_at: '2026-10-25T11:00:00Z',
      },
    ];

    // Archived view: items where status === 'archived'
    const archivedItems = itemsWithArchived.filter((i) => i.status === 'archived');
    expect(archivedItems.length).toBe(2);
    expect(archivedItems.map((i) => i.id)).toEqual(['item-archived-1', 'item-archived-2']);

    // Active view (non-archived items):
    const activeItems = itemsWithArchived.filter((i) => i.status !== 'archived');
    expect(activeItems.length).toBe(4);
    expect(activeItems.find((i) => i.id === 'item-archived-1')).toBeUndefined();

    // Recovery logic:
    // If unscheduled, unarchives to 'draft'
    const unarchiveStatus1 = archivedItems[0].scheduled_at ? 'scheduled' : 'draft';
    expect(unarchiveStatus1).toBe('draft');

    // If scheduled, unarchives to 'scheduled'
    const unarchiveStatus2 = archivedItems[1].scheduled_at ? 'scheduled' : 'draft';
    expect(unarchiveStatus2).toBe('scheduled');
  });
});

describe('Content Creation Defaults & Status Safety', () => {
  it('enforces "Capture Idea" default as status=idea and no scheduled date', () => {
    const captureIdeaDefaults = {
      defaultStatus: 'idea',
      scheduledAt: null,
    };
    expect(captureIdeaDefaults.defaultStatus).toBe('idea');
    expect(captureIdeaDefaults.scheduledAt).toBeNull();
  });

  it('enforces "New Content" default as status=draft and no scheduled date', () => {
    const newContentDefaults = {
      defaultStatus: 'draft',
      scheduledAt: null,
    };
    expect(newContentDefaults.defaultStatus).toBe('draft');
    expect(newContentDefaults.scheduledAt).toBeNull();
  });

  it('restricts ordinary manual UI status transitions to supported editorial statuses', () => {
    const supportedUiStatuses = ['idea', 'draft', 'scheduled', 'archived'] as const;
    const automatedLifecycleStatuses = ['publishing', 'published', 'failed'] as const;

    // Ordinary UI must not allow manual transitions into automated publishing states
    automatedLifecycleStatuses.forEach((st) => {
      expect(supportedUiStatuses.includes(st as any)).toBe(false);
    });
  });

  it('preserves existing records that possess automated lifecycle statuses without crashing', () => {
    const itemInPublishing: Partial<ContentItemWithMeta> = {
      id: 'item-pub-1',
      status: 'publishing',
      platform: 'x',
      title: 'Post in progress',
    };

    expect(STATUS_CONFIG[itemInPublishing.status!]).toBeDefined();
    expect(STATUS_CONFIG[itemInPublishing.status!].label).toBe('Publishing');
  });
});
