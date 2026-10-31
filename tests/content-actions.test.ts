import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createContentItemAction,
  updateContentItemAction,
  deleteContentItemAction,
  getContentItemByIdAction,
  getContentItemsAction,
  getIdeaInboxItemsAction,
  getSocialAccountsAction,
  createSocialAccountAction,
  getCalendarEventsAction,
  resolveAuthorizedWorkspace,
} from '../src/lib/actions/content-actions';
import * as contentService from '../src/lib/services/content-service';
import * as taskService from '../src/lib/services/task-service';
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
    throw new Error(`Unexpected table queried in action mock: ${table}`);
  }),
} as unknown as SupabaseClient<Database>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
}));

vi.mock('@/lib/services/task-service', () => ({
  getTasks: vi.fn(),
}));

vi.mock('@/lib/services/content-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/services/content-service')>();
  return {
    ...actual,
    createContentItem: vi.fn(),
    updateContentItem: vi.fn(),
    deleteContentItem: vi.fn(),
    getContentItems: vi.fn(),
    getIdeaInboxItems: vi.fn(),
    getContentItemById: vi.fn(),
    getSocialAccounts: vi.fn(),
    createSocialAccount: vi.fn(),
  };
});

describe('Content Server Actions (Authentication, Authorization & Revalidation)', () => {
  const wsId = '550e8400-e29b-41d4-a716-446655440000';
  const otherWsId = '99999999-9999-4999-a999-999999999999';
  const contentId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const userId = 'usr-test-1111';

  const sampleCreatedContent: contentService.ContentItemWithMeta = {
    id: contentId,
    workspace_id: wsId,
    social_account_id: null,
    platform: 'x',
    action_type: 'post',
    status: 'idea',
    title: 'New Idea Hook',
    body: 'Exploring server actions in Next.js',
    scheduled_at: null,
    duration_minutes: null,
    media_urls: [],
    external_links: [],
    target_reference: null,
    tags: ['nextjs', 'actions'],
    notes: null,
    project_id: null,
    milestone_id: null,
    recurrence_rule_id: null,
    created_by: userId,
    created_at: '2026-10-29T12:00:00Z',
    updated_at: '2026-10-29T12:00:00Z',
    project: null,
    social_account: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveAuthorizedWorkspace helper', () => {
    it('verifies explicit workspace membership for the authenticated user', async () => {
      mockWorkspaceMembersSelect.mockResolvedValueOnce({
        data: { role: 'owner' },
        error: null,
      });

      const res = await resolveAuthorizedWorkspace(mockSupabase, userId, wsId);
      expect(res.workspaceId).toBe(wsId);
      expect(res.error).toBeUndefined();
    });

    it('rejects access when user is not a member of the requested workspace', async () => {
      mockWorkspaceMembersSelect.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const res = await resolveAuthorizedWorkspace(mockSupabase, userId, otherWsId);
      expect(res.workspaceId).toBeUndefined();
      expect(res.error).toMatch(/Unauthorized: You do not have access to this workspace/);
    });

    it('falls back to default workspace when no workspaceId is supplied', async () => {
      mockWorkspaceMembersSelect.mockResolvedValueOnce({
        data: { workspace_id: wsId },
        error: null,
      });

      const res = await resolveAuthorizedWorkspace(mockSupabase, userId, null);
      expect(res.workspaceId).toBe(wsId);
      expect(res.error).toBeUndefined();
    });

    it('returns error when user has no workspace memberships at all', async () => {
      mockWorkspaceMembersSelect.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const res = await resolveAuthorizedWorkspace(mockSupabase, userId, null);
      expect(res.workspaceId).toBeUndefined();
      expect(res.error).toMatch(/No active workspace membership found/);
    });
  });

  describe('createContentItemAction', () => {
    it('rejects unauthenticated invocation attempts', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });

      const res = await createContentItemAction({
        workspace_id: wsId,
        platform: 'x',
        title: 'Unauthorized Idea',
      });

      expect(res.error).toBe('Authentication required');
      expect(res.success).toBeUndefined();
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it('rejects unauthorized cross-workspace creation attempts', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: null, error: null });

      const res = await createContentItemAction({
        workspace_id: otherWsId,
        platform: 'x',
        title: 'Unauthorized Cross-Workspace',
      });

      expect(res.error).toMatch(/Unauthorized/);
      expect(contentService.createContentItem).not.toHaveBeenCalled();
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it('validates input and rejects invalid payloads before calling service', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'member' }, error: null });

      // Invalid: missing both title and body
      const res = await createContentItemAction({
        workspace_id: wsId,
        platform: 'x',
      });

      expect(res.error).toMatch(/must include either a title or a body/);
      expect(contentService.createContentItem).not.toHaveBeenCalled();
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it('successfully creates content item via JSON payload and revalidates paths', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'owner' }, error: null });
      vi.mocked(contentService.createContentItem).mockResolvedValueOnce(sampleCreatedContent);

      const res = await createContentItemAction({
        workspace_id: wsId,
        platform: 'x',
        title: 'Valid Idea',
        tags: ['strategy'],
      });

      expect(res.success).toBe(true);
      expect(res.data).toEqual(sampleCreatedContent);
      expect(contentService.createContentItem).toHaveBeenCalledWith(
        mockSupabase,
        wsId,
        expect.objectContaining({ platform: 'x', title: 'Valid Idea' }),
        userId
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith('/content');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
    });

    it('successfully handles FormData from React useActionState form submissions', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'owner' }, error: null });
      vi.mocked(contentService.createContentItem).mockResolvedValueOnce(sampleCreatedContent);

      const formData = new FormData();
      formData.set('workspace_id', wsId);
      formData.set('platform', 'linkedin');
      formData.set('title', 'FormData Post');
      formData.set('body', 'Post body text');

      const res = await createContentItemAction(null, formData);

      expect(res.success).toBe(true);
      expect(contentService.createContentItem).toHaveBeenCalledWith(
        mockSupabase,
        wsId,
        expect.objectContaining({
          platform: 'linkedin',
          title: 'FormData Post',
          body: 'Post body text',
        }),
        userId
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith('/content');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
    });

    it('does NOT revalidate paths when underlying service throws an error', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'owner' }, error: null });
      vi.mocked(contentService.createContentItem).mockRejectedValueOnce(
        new Error('Database foreign key violation')
      );

      const res = await createContentItemAction({
        workspace_id: wsId,
        platform: 'reddit',
        title: 'Failed Post',
      });

      expect(res.error).toBe('Database foreign key violation');
      expect(res.success).toBeUndefined();
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });
  });

  describe('updateContentItemAction', () => {
    it('rejects unauthenticated update attempts', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });

      const res = await updateContentItemAction({
        workspace_id: wsId,
        content_id: contentId,
        status: 'draft',
      });

      expect(res.error).toBe('Authentication required');
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it('rejects updates missing content_id', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });

      const res = await updateContentItemAction({
        workspace_id: wsId,
        content_id: '',
        status: 'draft',
      });

      expect(res.error).toBe('Content ID is required');
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it('successfully updates content item via JSON payload and revalidates paths', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'owner' }, error: null });
      const updatedContent = { ...sampleCreatedContent, status: 'scheduled' as const };
      vi.mocked(contentService.updateContentItem).mockResolvedValueOnce(updatedContent);

      const res = await updateContentItemAction({
        workspace_id: wsId,
        content_id: contentId,
        status: 'scheduled',
        scheduled_at: '2026-11-25T15:00:00Z',
      });

      expect(res.success).toBe(true);
      expect(res.data?.status).toBe('scheduled');
      expect(contentService.updateContentItem).toHaveBeenCalledWith(
        mockSupabase,
        wsId,
        contentId,
        expect.objectContaining({ status: 'scheduled' })
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith('/content');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
    });

    it('handles FormData update and parses null scheduled_at correctly', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'owner' }, error: null });
      vi.mocked(contentService.updateContentItem).mockResolvedValueOnce(sampleCreatedContent);

      const formData = new FormData();
      formData.set('workspace_id', wsId);
      formData.set('content_id', contentId);
      formData.set('status', 'idea');

      const res = await updateContentItemAction(null, formData);

      expect(res.success).toBe(true);
      expect(mockRevalidatePath).toHaveBeenCalledWith('/content');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
    });

    it('does NOT revalidate paths when update service throws an error', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'owner' }, error: null });
      vi.mocked(contentService.updateContentItem).mockRejectedValueOnce(
        new Error('Row not found')
      );

      const res = await updateContentItemAction({
        workspace_id: wsId,
        content_id: contentId,
        title: 'New Title',
      });

      expect(res.error).toBe('Row not found');
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });
  });

  describe('deleteContentItemAction', () => {
    it('rejects unauthenticated deletion attempts', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });

      const res = await deleteContentItemAction(wsId, contentId);

      expect(res.error).toBe('Authentication required');
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it('rejects missing parameters', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });

      const res = await deleteContentItemAction('', contentId);
      expect(res.error).toBe('Workspace ID and Content ID are required');
    });

    it('successfully deletes content item and revalidates paths', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'owner' }, error: null });
      vi.mocked(contentService.deleteContentItem).mockResolvedValueOnce();

      const res = await deleteContentItemAction(wsId, contentId);

      expect(res.success).toBe(true);
      expect(contentService.deleteContentItem).toHaveBeenCalledWith(mockSupabase, wsId, contentId);
      expect(mockRevalidatePath).toHaveBeenCalledWith('/content');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
    });

    it('does NOT revalidate paths on delete failure', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'owner' }, error: null });
      vi.mocked(contentService.deleteContentItem).mockRejectedValueOnce(
        new Error('Delete restricted by policy')
      );

      const res = await deleteContentItemAction(wsId, contentId);

      expect(res.error).toBe('Delete restricted by policy');
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });
  });

  describe('getContentItemByIdAction', () => {
    it('retrieves content item detail with authorized workspace check', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'owner' }, error: null });
      vi.mocked(contentService.getContentItemById).mockResolvedValueOnce(sampleCreatedContent);

      const res = await getContentItemByIdAction(wsId, contentId);

      expect(res.success).toBe(true);
      expect(res.data?.id).toBe(contentId);
      expect(contentService.getContentItemById).toHaveBeenCalledWith(mockSupabase, wsId, contentId);
    });

    it('returns not found error when item does not exist', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'owner' }, error: null });
      vi.mocked(contentService.getContentItemById).mockResolvedValueOnce(null);

      const res = await getContentItemByIdAction(wsId, 'non-existent-id');

      expect(res.error).toBe('Content item not found');
    });
  });

  describe('getContentItemsAction & getIdeaInboxItemsAction', () => {
    it('retrieves filtered content items for workspace', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'owner' }, error: null });
      vi.mocked(contentService.getContentItems).mockResolvedValueOnce([sampleCreatedContent]);

      const res = await getContentItemsAction(wsId, { platform: 'x' });

      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(1);
      expect(contentService.getContentItems).toHaveBeenCalledWith(mockSupabase, wsId, { platform: 'x' });
    });

    it('retrieves Idea Inbox items for workspace', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'owner' }, error: null });
      vi.mocked(contentService.getIdeaInboxItems).mockResolvedValueOnce([sampleCreatedContent]);

      const res = await getIdeaInboxItemsAction(wsId);

      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(1);
      expect(contentService.getIdeaInboxItems).toHaveBeenCalledWith(mockSupabase, wsId);
    });
  });

  describe('Social Account Actions', () => {
    const sampleAccount: contentService.SocialAccountRow = {
      id: 'acc-1',
      workspace_id: wsId,
      platform: 'x',
      account_handle: '@milerdev',
      account_name: 'Miler Dev',
      avatar_url: null,
      status: 'draft',
      created_at: '2026-10-29T10:00:00Z',
      updated_at: '2026-10-29T10:00:00Z',
    };

    it('getSocialAccountsAction retrieves accounts for authorized workspace', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'owner' }, error: null });
      vi.mocked(contentService.getSocialAccounts).mockResolvedValueOnce([sampleAccount]);

      const res = await getSocialAccountsAction(wsId);

      expect(res.success).toBe(true);
      expect(res.data).toEqual([sampleAccount]);
      expect(contentService.getSocialAccounts).toHaveBeenCalledWith(mockSupabase, wsId);
    });

    it('createSocialAccountAction validates and creates account, revalidating /content', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'owner' }, error: null });
      vi.mocked(contentService.createSocialAccount).mockResolvedValueOnce(sampleAccount);

      const res = await createSocialAccountAction(wsId, {
        platform: 'x',
        account_handle: '@milerdev',
        account_name: 'Miler Dev',
      });

      expect(res.success).toBe(true);
      expect(res.data).toEqual(sampleAccount);
      expect(contentService.createSocialAccount).toHaveBeenCalledWith(
        mockSupabase,
        wsId,
        expect.objectContaining({ account_handle: '@milerdev' })
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith('/content');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar');
    });
  });

  describe('Unified getCalendarEventsAction', () => {
    it('fetches content items and tasks concurrently in a single authenticated operation', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: { role: 'member' }, error: null });

      const mockContent = [
        {
          id: 'c-1',
          workspace_id: wsId,
          platform: 'x',
          scheduled_at: '2026-10-29T10:00:00Z',
        },
      ];
      const mockTasks = [
        {
          id: 't-1',
          workspace_id: wsId,
          title: 'Review schedule',
          scheduled_start: '2026-10-29T11:00:00Z',
        },
      ];

      vi.mocked(contentService.getContentItems).mockResolvedValueOnce(mockContent as any);
      vi.mocked(taskService.getTasks).mockResolvedValueOnce(mockTasks as any);

      const filter = {
        scheduled_from: '2026-10-29T00:00:00.000Z',
        scheduled_to: '2026-10-29T23:59:59.999Z',
      };

      const res = await getCalendarEventsAction(wsId, filter);

      expect(res.success).toBe(true);
      expect(res.data).toBeDefined();
      expect(res.data?.content).toEqual(mockContent);
      expect(res.data?.tasks).toEqual(mockTasks);

      // Verify single auth query and parallel service execution
      expect(contentService.getContentItems).toHaveBeenCalledWith(mockSupabase, wsId, filter);
      expect(taskService.getTasks).toHaveBeenCalledWith(mockSupabase, wsId, {
        scheduled_from: filter.scheduled_from,
        scheduled_to: filter.scheduled_to,
        parent_task_id: null,
      });
    });

    it('returns error when user is not authorized for workspace', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
      mockWorkspaceMembersSelect.mockResolvedValueOnce({ data: null, error: null });

      const res = await getCalendarEventsAction(wsId, {
        scheduled_from: '2026-10-29T00:00:00.000Z',
        scheduled_to: '2026-10-29T23:59:59.999Z',
      });

      expect(res.error).toBe('Unauthorized: You do not have access to this workspace');
      expect(res.data).toBeUndefined();
    });
  });
});
