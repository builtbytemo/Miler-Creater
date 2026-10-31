import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getContentItems,
  getIdeaInboxItems,
  getUnscheduledContentItems,
  getContentItemById,
  createContentItem,
  updateContentItem,
  deleteContentItem,
  getSocialAccounts,
  createSocialAccount,
  type ContentItemWithMeta,
} from '../src/lib/services/content-service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';

describe('Content Service Layer (Workspace Scoped Database Operations)', () => {
  const wsId = '550e8400-e29b-41d4-a716-446655440000';
  const otherWsId = '99999999-9999-4999-a999-999999999999';
  const contentId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const userId = 'usr-12345';
  const projectId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
  const socialAccountId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';

  interface MockSupabaseOptions {
    selectData?: unknown[];
    singleData?: unknown;
    maybeSingleData?: unknown;
    selectError?: { message: string } | null;
    insertError?: { message: string } | null;
    updateError?: { message: string } | null;
    deleteError?: { message: string } | null;
  }

  function createMockSupabase(options: MockSupabaseOptions = {}) {
    const calls = {
      from: [] as string[],
      eq: [] as [string, unknown][],
      in: [] as [string, unknown[]][],
      is: [] as [string, unknown][],
      not: [] as [string, string, unknown][],
      gte: [] as [string, unknown][],
      lte: [] as [string, unknown][],
      or: [] as string[],
      contains: [] as [string, unknown][],
      order: [] as [string, unknown][],
      insertPayload: null as unknown,
      updatePayload: null as unknown,
    };

    const mockQueryBuilder: Record<string, unknown> = {};

    mockQueryBuilder.select = vi.fn().mockImplementation(() => mockQueryBuilder);
    mockQueryBuilder.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
      calls.eq.push([col, val]);
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
    mockQueryBuilder.not = vi.fn().mockImplementation((col: string, op: string, val: unknown) => {
      calls.not.push([col, op, val]);
      return mockQueryBuilder;
    });
    mockQueryBuilder.gte = vi.fn().mockImplementation((col: string, val: unknown) => {
      calls.gte.push([col, val]);
      return mockQueryBuilder;
    });
    mockQueryBuilder.lte = vi.fn().mockImplementation((col: string, val: unknown) => {
      calls.lte.push([col, val]);
      return mockQueryBuilder;
    });
    mockQueryBuilder.or = vi.fn().mockImplementation((expr: string) => {
      calls.or.push(expr);
      return mockQueryBuilder;
    });
    mockQueryBuilder.contains = vi.fn().mockImplementation((col: string, val: unknown) => {
      calls.contains.push([col, val]);
      return mockQueryBuilder;
    });
    mockQueryBuilder.order = vi.fn().mockImplementation((col: string, opts: unknown) => {
      calls.order.push([col, opts]);
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

    mockQueryBuilder.delete = vi.fn().mockImplementation(() => mockQueryBuilder);

    mockQueryBuilder.single = vi.fn().mockImplementation(async () => {
      if (options.insertError) return { data: null, error: options.insertError };
      if (options.updateError) return { data: null, error: options.updateError };
      return { data: options.singleData || null, error: null };
    });

    mockQueryBuilder.maybeSingle = vi.fn().mockImplementation(async () => {
      if (options.selectError) return { data: null, error: options.selectError };
      return { data: options.maybeSingleData !== undefined ? options.maybeSingleData : null, error: null };
    });

    // Make the query builder thenable (awaitable) for normal multi-row SELECT queries
    (mockQueryBuilder as Record<string, unknown>).then = (
      resolve: (val: { data: unknown; error: unknown }) => void
    ) => {
      if (options.selectError) {
        resolve({ data: null, error: options.selectError });
      } else if (options.deleteError) {
        resolve({ data: null, error: options.deleteError });
      } else {
        resolve({ data: options.selectData || [], error: null });
      }
    };

    const fromMock = vi.fn().mockImplementation((table: string) => {
      calls.from.push(table);
      return mockQueryBuilder;
    });

    const client = {
      from: fromMock,
      calls,
    } as unknown as SupabaseClient<Database> & { calls: typeof calls };

    return client;
  }

  const sampleRawContent = {
    id: contentId,
    workspace_id: wsId,
    social_account_id: socialAccountId,
    platform: 'x',
    action_type: 'post',
    status: 'scheduled',
    title: 'Announcing Next-Gen AI Integration',
    body: 'We are thrilled to announce our scoped agentic tools.',
    scheduled_at: '2026-11-20T14:00:00Z',
    duration_minutes: 30,
    media_urls: ['https://cdn.example.com/asset.png'],
    external_links: ['https://example.com/article'],
    target_reference: null,
    tags: ['ai', 'release'],
    notes: 'Editorial review completed.',
    project_id: projectId,
    milestone_id: null,
    recurrence_rule_id: null,
    created_by: userId,
    created_at: '2026-10-29T12:00:00Z',
    updated_at: '2026-10-29T12:00:00Z',
    projects: { id: projectId, name: 'AI Launch', color: '#2563eb' },
    social_accounts: {
      id: socialAccountId,
      platform: 'x',
      account_handle: '@milerdev',
      account_name: 'Miler Dev',
      avatar_url: null,
    },
  };

  describe('getContentItems', () => {
    it('restricts queries strictly to the supplied workspaceId', async () => {
      const mockClient = createMockSupabase({ selectData: [sampleRawContent] });
      const items = await getContentItems(mockClient, wsId);

      expect(mockClient.calls.from).toContain('content_items');
      expect(mockClient.calls.eq).toContainEqual(['workspace_id', wsId]);
      expect(items.length).toBe(1);
      expect(items[0]?.workspace_id).toBe(wsId);
      expect(items[0]?.project?.name).toBe('AI Launch');
      expect(items[0]?.social_account?.account_handle).toBe('@milerdev');
    });

    it('filters by single platform and multiple platforms', async () => {
      // Single platform
      const client1 = createMockSupabase({ selectData: [] });
      await getContentItems(client1, wsId, { platform: 'linkedin' });
      expect(client1.calls.eq).toContainEqual(['platform', 'linkedin']);

      // Multiple platforms
      const client2 = createMockSupabase({ selectData: [] });
      await getContentItems(client2, wsId, { platform: ['x', 'threads'] });
      expect(client2.calls.in).toContainEqual(['platform', ['x', 'threads']]);
    });

    it('filters by single status and multiple statuses', async () => {
      const client1 = createMockSupabase({ selectData: [] });
      await getContentItems(client1, wsId, { status: 'draft' });
      expect(client1.calls.eq).toContainEqual(['status', 'draft']);

      const client2 = createMockSupabase({ selectData: [] });
      await getContentItems(client2, wsId, { status: ['draft', 'scheduled'] });
      expect(client2.calls.in).toContainEqual(['status', ['draft', 'scheduled']]);
    });

    it('filters by single action_type and multiple action_types', async () => {
      const client1 = createMockSupabase({ selectData: [] });
      await getContentItems(client1, wsId, { action_type: 'comment' });
      expect(client1.calls.eq).toContainEqual(['action_type', 'comment']);

      const client2 = createMockSupabase({ selectData: [] });
      await getContentItems(client2, wsId, { action_type: ['comment', 'reply'] });
      expect(client2.calls.in).toContainEqual(['action_type', ['comment', 'reply']]);
    });

    it('filters by project_id and social_account_id', async () => {
      const client = createMockSupabase({ selectData: [] });
      await getContentItems(client, wsId, {
        project_id: projectId,
        social_account_id: socialAccountId,
      });

      expect(client.calls.eq).toContainEqual(['project_id', projectId]);
      expect(client.calls.eq).toContainEqual(['social_account_id', socialAccountId]);
    });

    it('filters by scheduled date range (scheduled_from and scheduled_to)', async () => {
      const client = createMockSupabase({ selectData: [] });
      await getContentItems(client, wsId, {
        scheduled_from: '2026-11-01T00:00:00Z',
        scheduled_to: '2026-11-30T23:59:59Z',
      });

      expect(client.calls.gte).toContainEqual(['scheduled_at', '2026-11-01T00:00:00Z']);
      expect(client.calls.lte).toContainEqual(['scheduled_at', '2026-11-30T23:59:59Z']);
    });

    it('filters by search term in title or body', async () => {
      const client = createMockSupabase({ selectData: [] });
      await getContentItems(client, wsId, { search: 'architecture' });

      expect(client.calls.or).toContain('title.ilike.%architecture%,body.ilike.%architecture%');
    });

    it('filters by tags', async () => {
      const client = createMockSupabase({ selectData: [] });
      await getContentItems(client, wsId, { tags: ['ai', 'infra'] });

      expect(client.calls.contains).toContainEqual(['tags', ['ai', 'infra']]);
    });

    it('applies is_idea = true filter strictly for status = idea and scheduled_at IS NULL', async () => {
      const client = createMockSupabase({ selectData: [] });
      await getContentItems(client, wsId, { is_idea: true });

      expect(client.calls.eq).toContainEqual(['status', 'idea']);
      expect(client.calls.is).toContainEqual(['scheduled_at', null]);
    });

    it('applies is_idea = false filter using status != idea OR scheduled_at IS NOT NULL', async () => {
      const client = createMockSupabase({ selectData: [] });
      await getContentItems(client, wsId, { is_idea: false });

      expect(client.calls.or).toContain('status.neq.idea,scheduled_at.not.is.null');
    });

    it('applies is_scheduled filter correctly for true and false', async () => {
      const clientScheduled = createMockSupabase({ selectData: [] });
      await getContentItems(clientScheduled, wsId, { is_scheduled: true });
      expect(clientScheduled.calls.not).toContainEqual(['scheduled_at', 'is', null]);

      const clientUnscheduled = createMockSupabase({ selectData: [] });
      await getContentItems(clientUnscheduled, wsId, { is_scheduled: false });
      expect(clientUnscheduled.calls.is).toContainEqual(['scheduled_at', null]);
    });

    it('partitions content items between is_idea = true and is_idea = false across all 4 lifecycle states', () => {
      // 1. Unscheduled idea
      const unscheduledIdea = { id: 'item-1', status: 'idea', scheduled_at: null };
      // 2. Unscheduled draft
      const unscheduledDraft = { id: 'item-2', status: 'draft', scheduled_at: null };
      // 3. Scheduled idea
      const scheduledIdea = { id: 'item-3', status: 'idea', scheduled_at: '2026-11-20T10:00:00Z' };
      // 4. Scheduled draft
      const scheduledDraft = { id: 'item-4', status: 'draft', scheduled_at: '2026-11-20T10:00:00Z' };

      const allItems = [unscheduledIdea, unscheduledDraft, scheduledIdea, scheduledDraft];

      // Idea Inbox definition: status === 'idea' AND scheduled_at === null
      const isIdeaTrueMatches = allItems.filter(
        (item) => item.status === 'idea' && item.scheduled_at === null
      );

      // Negation (is_idea === false): status !== 'idea' OR scheduled_at !== null
      const isIdeaFalseMatches = allItems.filter(
        (item) => item.status !== 'idea' || item.scheduled_at !== null
      );

      // Verify is_idea: true matches only the unscheduled idea
      expect(isIdeaTrueMatches.map((i) => i.id)).toEqual(['item-1']);

      // Verify is_idea: false matches unscheduled drafts, scheduled ideas, and scheduled drafts
      expect(isIdeaFalseMatches.map((i) => i.id)).toEqual(['item-2', 'item-3', 'item-4']);

      // Verify partition property 1: Disjoint sets (zero overlap)
      const overlap = isIdeaTrueMatches.filter((item) => isIdeaFalseMatches.includes(item));
      expect(overlap).toHaveLength(0);

      // Verify partition property 2: Exhaustive union (every record belongs to exactly one set)
      expect(isIdeaTrueMatches.length + isIdeaFalseMatches.length).toBe(allItems.length);
    });

    it('throws informative error when database query fails', async () => {
      const client = createMockSupabase({ selectError: { message: 'Database connection timeout' } });
      await expect(getContentItems(client, wsId)).rejects.toThrow(
        /Failed to fetch content items: Database connection timeout/
      );
    });
  });

  describe('getIdeaInboxItems', () => {
    it('queries only unscheduled ideas for the workspace', async () => {
      const sampleIdea = {
        ...sampleRawContent,
        id: 'idea-1',
        status: 'idea',
        scheduled_at: null,
      };

      const client = createMockSupabase({ selectData: [sampleIdea] });
      const ideas = await getIdeaInboxItems(client, wsId);

      expect(client.calls.from).toContain('content_items');
      expect(client.calls.eq).toContainEqual(['workspace_id', wsId]);
      expect(client.calls.eq).toContainEqual(['status', 'idea']);
      expect(client.calls.is).toContainEqual(['scheduled_at', null]);
      expect(ideas.length).toBe(1);
      expect(ideas[0]?.status).toBe('idea');
      expect(ideas[0]?.scheduled_at).toBeNull();
    });
  });

  describe('getUnscheduledContentItems', () => {
    it('queries all items with scheduled_at IS NULL (both ideas and unscheduled drafts)', async () => {
      const sampleUnscheduledDraft = {
        ...sampleRawContent,
        id: 'draft-unscheduled',
        status: 'draft',
        scheduled_at: null,
      };

      const client = createMockSupabase({ selectData: [sampleUnscheduledDraft] });
      const items = await getUnscheduledContentItems(client, wsId);

      expect(client.calls.from).toContain('content_items');
      expect(client.calls.eq).toContainEqual(['workspace_id', wsId]);
      expect(client.calls.is).toContainEqual(['scheduled_at', null]);
      expect(items.length).toBe(1);
      expect(items[0]?.scheduled_at).toBeNull();
    });
  });

  describe('getContentItemById', () => {
    it('restricts lookup by both workspaceId and contentId', async () => {
      const client = createMockSupabase({ maybeSingleData: sampleRawContent });
      const item = await getContentItemById(client, wsId, contentId);

      expect(client.calls.eq).toContainEqual(['workspace_id', wsId]);
      expect(client.calls.eq).toContainEqual(['id', contentId]);
      expect(item).not.toBeNull();
      expect(item?.id).toBe(contentId);
      expect(item?.title).toBe(sampleRawContent.title);
    });

    it('returns null when content item is missing or belongs to another workspace', async () => {
      const client = createMockSupabase({ maybeSingleData: null });
      const item = await getContentItemById(client, wsId, 'non-existent-id');

      expect(item).toBeNull();
    });

    it('returns null on database query error', async () => {
      const client = createMockSupabase({ selectError: { message: 'Row not found' } });
      const item = await getContentItemById(client, wsId, contentId);

      expect(item).toBeNull();
    });
  });

  describe('createContentItem', () => {
    it('validates input and assigns trusted workspace and creator ownership', async () => {
      const client = createMockSupabase({ singleData: sampleRawContent });

      const item = await createContentItem(
        client,
        wsId,
        {
          platform: 'x',
          title: 'New Idea',
          body: 'Idea body',
        },
        userId
      );

      expect(client.calls.from).toContain('content_items');
      const insertPayload = client.calls.insertPayload as Record<string, unknown>;
      expect(insertPayload.workspace_id).toBe(wsId);
      expect(insertPayload.created_by).toBe(userId);
      expect(insertPayload.platform).toBe('x');
      expect(insertPayload.title).toBe('New Idea');
      expect(item.id).toBe(contentId);
    });

    it('supports creating an unscheduled idea with scheduled_at = null', async () => {
      const client = createMockSupabase({
        singleData: { ...sampleRawContent, status: 'idea', scheduled_at: null },
      });

      await createContentItem(
        client,
        wsId,
        {
          platform: 'reddit',
          title: 'Unscheduled Community Post',
          scheduled_at: null,
        },
        userId
      );

      const insertPayload = client.calls.insertPayload as Record<string, unknown>;
      expect(insertPayload.scheduled_at).toBeNull();
      expect(insertPayload.status).toBe('idea');
    });

    it('provisions recurrence_rules when embedded recurrence specification is provided', async () => {
      const client = createMockSupabase({
        singleData: sampleRawContent,
      });

      await createContentItem(
        client,
        wsId,
        {
          platform: 'linkedin',
          title: 'Weekly Cadence Post',
          body: 'Tips on modern full-stack development',
          scheduled_at: '2026-11-02T10:00:00Z',
          recurrence: {
            frequency: 'weekly',
            interval: 1,
            by_weekday: [1],
            timezone: 'Asia/Cairo',
          },
        },
        userId
      );

      expect(client.calls.from).toContain('recurrence_rules');
      expect(client.calls.from).toContain('content_items');
    });

    it('rejects invalid content creation inputs before querying database', async () => {
      const client = createMockSupabase();

      // Missing both title and body
      await expect(
        createContentItem(
          client,
          wsId,
          {
            platform: 'x',
          } as unknown as { platform: 'x'; title: string }
        )
      ).rejects.toThrow();

      // Database should not have been called
      expect(client.calls.from.length).toBe(0);
    });

    it('throws informative error on database insert failure', async () => {
      const client = createMockSupabase({
        insertError: { message: 'Workspace constraint violation' },
      });

      await expect(
        createContentItem(
          client,
          wsId,
          {
            platform: 'threads',
            body: 'Threads post body',
          },
          userId
        )
      ).rejects.toThrow(/Failed to create content item: Workspace constraint violation/);
    });

    it('cleans up newly created recurrence rule if content insertion fails', async () => {
      const mockRuleId = 'rule-cleanup-123';
      const deletedRuleCalls: string[] = [];

      const fromMock = vi.fn((table: string) => {
        if (table === 'recurrence_rules') {
          const ruleBuilder: Record<string, unknown> = {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: mockRuleId }, error: null }),
            delete: vi.fn().mockImplementation(() => {
              deletedRuleCalls.push('delete');
              return ruleBuilder;
            }),
            eq: vi.fn().mockImplementation((col: string, val: unknown) => {
              deletedRuleCalls.push(`${col}=${val}`);
              return ruleBuilder;
            }),
          };
          return ruleBuilder;
        }
        if (table === 'content_items') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database disk full or constraint violation' },
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const client = { from: fromMock } as unknown as SupabaseClient<Database>;

      await expect(
        createContentItem(
          client,
          wsId,
          {
            platform: 'linkedin',
            title: 'Cadence Post',
            body: 'Tips',
            recurrence: {
              frequency: 'daily',
              interval: 1,
              timezone: 'Asia/Cairo',
            },
          },
          userId
        )
      ).rejects.toThrow(/Failed to create content item/);

      // Verify compensating delete was triggered on recurrence_rules for this specific rule
      expect(fromMock).toHaveBeenCalledWith('recurrence_rules');
      expect(deletedRuleCalls).toContain('delete');
      expect(deletedRuleCalls).toContain(`workspace_id=${wsId}`);
      expect(deletedRuleCalls).toContain(`id=${mockRuleId}`);
    });
  });

  describe('updateContentItem', () => {
    it('restricts updates strictly by workspaceId and contentId', async () => {
      const client = createMockSupabase({
        singleData: { ...sampleRawContent, status: 'draft' },
      });

      const updated = await updateContentItem(client, wsId, contentId, {
        status: 'draft',
      });

      expect(client.calls.eq).toContainEqual(['workspace_id', wsId]);
      expect(client.calls.eq).toContainEqual(['id', contentId]);
      expect(updated.status).toBe('draft');
    });

    it('preserves omitted fields in partial updates', async () => {
      const client = createMockSupabase({
        singleData: sampleRawContent,
      });

      await updateContentItem(client, wsId, contentId, {
        status: 'scheduled',
      });

      const updatePayload = client.calls.updatePayload as Record<string, unknown>;
      expect(updatePayload.status).toBe('scheduled');
      expect(updatePayload).not.toHaveProperty('title');
      expect(updatePayload).not.toHaveProperty('body');
      expect(updatePayload).not.toHaveProperty('scheduled_at');
    });

    it('preserves explicit null for nullable fields like scheduled_at to unschedule content', async () => {
      const client = createMockSupabase({
        singleData: { ...sampleRawContent, scheduled_at: null, status: 'idea' },
      });

      await updateContentItem(client, wsId, contentId, {
        scheduled_at: null,
        status: 'idea',
      });

      const updatePayload = client.calls.updatePayload as Record<string, unknown>;
      expect(updatePayload.scheduled_at).toBeNull();
      expect(updatePayload.status).toBe('idea');
    });

    it('never allows overwriting immutable fields through update payload', async () => {
      const client = createMockSupabase({
        singleData: sampleRawContent,
      });

      // Pass attempted overwrite of immutable fields
      await updateContentItem(
        client,
        wsId,
        contentId,
        {
          title: 'Updated Title',
          id: 'hacked-id',
          workspace_id: otherWsId,
          created_at: '2020-01-01T00:00:00Z',
        } as unknown as { title: string }
      );

      const updatePayload = client.calls.updatePayload as Record<string, unknown>;
      expect(updatePayload.title).toBe('Updated Title');
      expect(updatePayload).not.toHaveProperty('id');
      expect(updatePayload).not.toHaveProperty('workspace_id');
      expect(updatePayload).not.toHaveProperty('created_at');
    });

    it('throws informative error on database update failure', async () => {
      const client = createMockSupabase({
        updateError: { message: 'Row locked by concurrent transaction' },
      });

      await expect(
        updateContentItem(client, wsId, contentId, {
          title: 'New Title',
        })
      ).rejects.toThrow(/Failed to update content item: Row locked by concurrent transaction/);
    });
  });

  describe('deleteContentItem', () => {
    it('restricts deletion strictly by workspaceId and contentId', async () => {
      const client = createMockSupabase();

      await deleteContentItem(client, wsId, contentId);

      expect(client.calls.from).toContain('content_items');
      expect(client.calls.eq).toContainEqual(['workspace_id', wsId]);
      expect(client.calls.eq).toContainEqual(['id', contentId]);
    });

    it('throws informative error on database delete failure', async () => {
      const client = createMockSupabase({
        deleteError: { message: 'Foreign key constraint prevents deletion' },
      });

      await expect(deleteContentItem(client, wsId, contentId)).rejects.toThrow(
        /Failed to delete content item: Foreign key constraint prevents deletion/
      );
    });
  });

  describe('Social Accounts Management (getSocialAccounts & createSocialAccount)', () => {
    const sampleAccount = {
      id: socialAccountId,
      workspace_id: wsId,
      platform: 'x',
      account_handle: '@milerdev',
      account_name: 'Miler Developer',
      avatar_url: null,
      status: 'draft',
      created_at: '2026-10-29T10:00:00Z',
      updated_at: '2026-10-29T10:00:00Z',
    };

    it('getSocialAccounts retrieves accounts strictly scoped to workspaceId', async () => {
      const client = createMockSupabase({ selectData: [sampleAccount] });

      const accounts = await getSocialAccounts(client, wsId);

      expect(client.calls.from).toContain('social_accounts');
      expect(client.calls.eq).toContainEqual(['workspace_id', wsId]);
      expect(accounts.length).toBe(1);
      expect(accounts[0]?.account_handle).toBe('@milerdev');
    });

    it('createSocialAccount validates input and assigns trusted workspaceId', async () => {
      const client = createMockSupabase({ singleData: sampleAccount });

      const created = await createSocialAccount(client, wsId, {
        platform: 'x',
        account_handle: '@milerdev',
        account_name: 'Miler Developer',
      });

      expect(client.calls.from).toContain('social_accounts');
      const insertPayload = client.calls.insertPayload as Record<string, unknown>;
      expect(insertPayload.workspace_id).toBe(wsId);
      expect(insertPayload.platform).toBe('x');
      expect(insertPayload.account_handle).toBe('@milerdev');
      expect(created.id).toBe(socialAccountId);
    });

    it('createSocialAccount rejects invalid account handle before calling database', async () => {
      const client = createMockSupabase();

      await expect(
        createSocialAccount(client, wsId, {
          platform: 'x',
          account_handle: '   ',
        })
      ).rejects.toThrow();

      expect(client.calls.from.length).toBe(0);
    });
  });
});
