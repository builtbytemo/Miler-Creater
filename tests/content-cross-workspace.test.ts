import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { createContentItem, updateContentItem } from '@/lib/services/content-service';

describe('Content Service Privileged Authorization & Cross-Workspace Integrity (Phase 7.4.1)', () => {
  const ws1 = '123e4567-e89b-12d3-a456-426614174001';
  const ws2 = '123e4567-e89b-12d3-a456-426614174002';
  const userId = '123e4567-e89b-12d3-a456-426614174010';

  // Workspace 1 resources
  const ws1ProjId = '123e4567-e89b-12d3-a456-426614174011';
  const ws1MileId = '123e4567-e89b-12d3-a456-426614174012';
  const ws1SocialId = '123e4567-e89b-12d3-a456-426614174013';
  const ws1RuleId = '123e4567-e89b-12d3-a456-426614174014';
  const ws1ContentId = '123e4567-e89b-12d3-a456-426614174015';

  // Workspace 2 resources (Foreign Workspace)
  const ws2ProjId = '123e4567-e89b-12d3-a456-426614174021';
  const ws2MileId = '123e4567-e89b-12d3-a456-426614174022';
  const ws2SocialId = '123e4567-e89b-12d3-a456-426614174023';
  const ws2RuleId = '123e4567-e89b-12d3-a456-426614174024';

  interface MockDbState {
    projects: Map<string, { id: string; workspace_id: string; name: string }>;
    milestones: Map<string, { id: string; workspace_id: string; project_id: string }>;
    socialAccounts: Map<string, { id: string; workspace_id: string; platform: string }>;
    recurrenceRules: Map<string, { id: string; workspace_id: string }>;
    contentItems: Map<string, any>;
  }

  let db: MockDbState;

  function createMockSupabase(): SupabaseClient<Database> {
    return {
      from: vi.fn((table: string) => {
        if (table === 'projects') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((f1: string, v1: string) => ({
                eq: vi.fn((f2: string, v2: string) => ({
                  maybeSingle: vi.fn(async () => {
                    const id = f1 === 'id' ? v1 : v2;
                    const ws = f1 === 'workspace_id' ? v1 : v2;
                    const p = db.projects.get(id);
                    if (p && p.workspace_id === ws) return { data: p, error: null };
                    return { data: null, error: null };
                  }),
                })),
              })),
            })),
          };
        }

        if (table === 'milestones') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((f1: string, v1: string) => ({
                eq: vi.fn((f2: string, v2: string) => ({
                  maybeSingle: vi.fn(async () => {
                    const id = f1 === 'id' ? v1 : v2;
                    const ws = f1 === 'workspace_id' ? v1 : v2;
                    const m = db.milestones.get(id);
                    if (m && m.workspace_id === ws) return { data: m, error: null };
                    return { data: null, error: null };
                  }),
                })),
              })),
            })),
          };
        }

        if (table === 'social_accounts') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((f1: string, v1: string) => ({
                eq: vi.fn((f2: string, v2: string) => ({
                  maybeSingle: vi.fn(async () => {
                    const id = f1 === 'id' ? v1 : v2;
                    const ws = f1 === 'workspace_id' ? v1 : v2;
                    const sa = db.socialAccounts.get(id);
                    if (sa && sa.workspace_id === ws) return { data: sa, error: null };
                    return { data: null, error: null };
                  }),
                })),
              })),
            })),
          };
        }

        if (table === 'recurrence_rules') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((f1: string, v1: string) => ({
                eq: vi.fn((f2: string, v2: string) => ({
                  maybeSingle: vi.fn(async () => {
                    const id = f1 === 'id' ? v1 : v2;
                    const ws = f1 === 'workspace_id' ? v1 : v2;
                    const r = db.recurrenceRules.get(id);
                    if (r && r.workspace_id === ws) return { data: r, error: null };
                    return { data: null, error: null };
                  }),
                })),
              })),
            })),
          };
        }

        if (table === 'content_items') {
          return {
            insert: vi.fn((payload: any) => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  const created = {
                    id: '123e4567-e89b-12d3-a456-426614174099',
                    ...payload,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  };
                  db.contentItems.set(created.id, created);
                  return { data: created, error: null };
                }),
              })),
            })),
            update: vi.fn((updates: any) => ({
              eq: vi.fn((f1: string, v1: string) => ({
                eq: vi.fn((f2: string, v2: string) => ({
                  select: vi.fn(() => ({
                    single: vi.fn(async () => {
                      const id = f1 === 'id' ? v1 : v2;
                      const ws = f1 === 'workspace_id' ? v1 : v2;
                      const existing = db.contentItems.get(id);
                      if (!existing || existing.workspace_id !== ws) {
                        return { data: null, error: { message: 'Content item not found in workspace' } };
                      }
                      const updated = { ...existing, ...updates };
                      db.contentItems.set(id, updated);
                      return { data: updated, error: null };
                    }),
                  })),
                })),
              })),
            })),
          };
        }

        return {} as any;
      }),
    } as unknown as SupabaseClient<Database>;
  }

  beforeEach(() => {
    db = {
      projects: new Map([
        [ws1ProjId, { id: ws1ProjId, workspace_id: ws1, name: 'WS1 Project' }],
        [ws2ProjId, { id: ws2ProjId, workspace_id: ws2, name: 'WS2 Project' }],
      ]),
      milestones: new Map([
        [ws1MileId, { id: ws1MileId, workspace_id: ws1, project_id: ws1ProjId }],
        [ws2MileId, { id: ws2MileId, workspace_id: ws2, project_id: ws2ProjId }],
      ]),
      socialAccounts: new Map([
        [ws1SocialId, { id: ws1SocialId, workspace_id: ws1, platform: 'linkedin' }],
        [ws2SocialId, { id: ws2SocialId, workspace_id: ws2, platform: 'linkedin' }],
      ]),
      recurrenceRules: new Map([
        [ws1RuleId, { id: ws1RuleId, workspace_id: ws1 }],
        [ws2RuleId, { id: ws2RuleId, workspace_id: ws2 }],
      ]),
      contentItems: new Map([
        [
          ws1ContentId,
          {
            id: ws1ContentId,
            workspace_id: ws1,
            platform: 'linkedin',
            body: 'Initial Post',
            status: 'draft',
            action_type: 'post',
          },
        ],
      ]),
    };
  });

  describe('createContentItem foreign key workspace enforcement', () => {
    it('rejects cross-workspace project_id', async () => {
      const client = createMockSupabase();

      await expect(
        createContentItem(
          client,
          ws1,
          {
            platform: 'linkedin',
            action_type: 'post',
            status: 'draft',
            body: 'Draft body',
            project_id: ws2ProjId, // Foreign workspace project!
          },
          userId
        )
      ).rejects.toThrow(/Cross-workspace reference rejected: project/i);
    });

    it('rejects cross-workspace milestone_id', async () => {
      const client = createMockSupabase();

      await expect(
        createContentItem(
          client,
          ws1,
          {
            platform: 'linkedin',
            action_type: 'post',
            status: 'draft',
            body: 'Draft body',
            milestone_id: ws2MileId, // Foreign workspace milestone!
          },
          userId
        )
      ).rejects.toThrow(/Cross-workspace reference rejected: milestone/i);
    });

    it('rejects cross-workspace social_account_id', async () => {
      const client = createMockSupabase();

      await expect(
        createContentItem(
          client,
          ws1,
          {
            platform: 'linkedin',
            action_type: 'post',
            status: 'draft',
            body: 'Draft body',
            social_account_id: ws2SocialId, // Foreign workspace social account!
          },
          userId
        )
      ).rejects.toThrow(/Cross-workspace reference rejected: social account/i);
    });

    it('rejects cross-workspace recurrence_rule_id', async () => {
      const client = createMockSupabase();

      await expect(
        createContentItem(
          client,
          ws1,
          {
            platform: 'linkedin',
            action_type: 'post',
            status: 'draft',
            body: 'Draft body',
            recurrence_rule_id: ws2RuleId, // Foreign workspace recurrence rule!
          },
          userId
        )
      ).rejects.toThrow(/Cross-workspace reference rejected: recurrence rule/i);
    });

    it('allows valid same-workspace foreign keys', async () => {
      const client = createMockSupabase();

      const created = await createContentItem(
        client,
        ws1,
        {
          platform: 'linkedin',
          action_type: 'post',
          status: 'draft',
          body: 'Valid post body',
          project_id: ws1ProjId,
          milestone_id: ws1MileId,
          social_account_id: ws1SocialId,
          recurrence_rule_id: ws1RuleId,
        },
        userId
      );

      expect(created.body).toBe('Valid post body');
      expect(created.project_id).toBe(ws1ProjId);
      expect(created.milestone_id).toBe(ws1MileId);
      expect(created.social_account_id).toBe(ws1SocialId);
      expect(created.recurrence_rule_id).toBe(ws1RuleId);
    });
  });

  describe('updateContentItem foreign key workspace enforcement', () => {
    it('rejects updating with cross-workspace project_id', async () => {
      const client = createMockSupabase();

      await expect(
        updateContentItem(client, ws1, ws1ContentId, {
          project_id: ws2ProjId,
        })
      ).rejects.toThrow(/Cross-workspace reference rejected: project/i);
    });

    it('rejects updating with cross-workspace social_account_id', async () => {
      const client = createMockSupabase();

      await expect(
        updateContentItem(client, ws1, ws1ContentId, {
          social_account_id: ws2SocialId,
        })
      ).rejects.toThrow(/Cross-workspace reference rejected: social account/i);
    });

    it('allows updating with valid same-workspace social_account_id', async () => {
      const client = createMockSupabase();

      const updated = await updateContentItem(client, ws1, ws1ContentId, {
        social_account_id: ws1SocialId,
      });

      expect(updated.id).toBe(ws1ContentId);
      expect(updated.social_account_id).toBe(ws1SocialId);
    });
  });
});
