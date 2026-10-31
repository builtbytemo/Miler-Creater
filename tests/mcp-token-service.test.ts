import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import {
  createAiToken,
  listWorkspaceTokens,
  getTokenMetadata,
  revokeAiToken,
  type CreateTokenInput,
} from '@/lib/mcp/token-service';
import { hashAiToken } from '@/lib/ai/tokens';

describe('AI API Token Management Service (Phase 7.4: token-service.ts)', () => {
  const wsId = '123e4567-e89b-12d3-a456-426614174000';
  const ownerId = '123e4567-e89b-12d3-a456-426614174001';
  const memberId = '123e4567-e89b-12d3-a456-426614174002';
  const otherMemberId = '123e4567-e89b-12d3-a456-426614174003';
  const viewerId = '123e4567-e89b-12d3-a456-426614174004';
  const tokenId = '123e4567-e89b-12d3-a456-426614174099';

  interface MockDbState {
    members: Map<string, { role: string }>;
    tokens: Map<string, any>;
    auditEvents: any[];
  }

  let db: MockDbState;

  function createMockSupabase(): SupabaseClient<Database> {
    return {
      from: vi.fn((table: string) => {
        if (table === 'workspace_members') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((field1: string, val1: string) => ({
                eq: vi.fn((field2: string, val2: string) => ({
                  maybeSingle: vi.fn(async () => {
                    const ws = field1 === 'workspace_id' ? val1 : val2;
                    const u = field1 === 'user_id' ? val1 : val2;
                    const key = `${ws}:${u}`;
                    const mem = db.members.get(key);
                    return { data: mem || null, error: null };
                  }),
                })),
              })),
            })),
          };
        }

        if (table === 'ai_api_tokens') {
          return {
            insert: vi.fn((payload: any) => ({
              select: vi.fn((_columns?: string) => ({
                single: vi.fn(async () => {
                  const record = {
                    id: tokenId,
                    ...payload,
                    created_at: new Date().toISOString(),
                    last_used_at: null,
                    revoked_at: null,
                  };
                  db.tokens.set(record.id, record);
                  return { data: record, error: null };
                }),
              })),
            })),
            select: vi.fn((selectedColumns?: string) => {
              // Ensure caller never requests token_hash in client-facing listing
              const isListingSafe = !selectedColumns?.includes('token_hash');

              return {
                eq: vi.fn((field1: string, val1: string) => {
                  let filtered = Array.from(db.tokens.values()).filter(
                    (t) => t[field1] === val1
                  );

                  const builder: any = {
                    eq: vi.fn((field2: string, val2: string) => {
                      filtered = filtered.filter((t) => t[field2] === val2);
                      return builder;
                    }),
                    order: vi.fn(() => builder),
                    maybeSingle: vi.fn(async () => {
                      const item = filtered[0] || null;
                      if (item && !isListingSafe) {
                        return { data: item, error: null };
                      }
                      if (item) {
                        const { token_hash, ...safe } = item;
                        return { data: safe, error: null };
                      }
                      return { data: null, error: null };
                    }),
                    then: (resolve: any) => {
                      const safeList = filtered.map((item) => {
                        const { token_hash, ...safe } = item;
                        return safe;
                      });
                      resolve({ data: safeList, error: null });
                    },
                  };

                  return builder;
                }),
              };
            }),
            update: vi.fn((updates: any) => ({
              eq: vi.fn((field1: string, val1: string) => ({
                eq: vi.fn((field2: string, val2: string) => {
                  for (const [id, t] of db.tokens.entries()) {
                    if (t[field1] === val1 && t[field2] === val2) {
                      db.tokens.set(id, { ...t, ...updates });
                    }
                  }
                  return Promise.resolve({ error: null });
                }),
              })),
            })),
          };
        }

        if (table === 'audit_events') {
          return {
            insert: vi.fn(async (payload: any) => {
              db.auditEvents.push(payload);
              return { error: null };
            }),
          };
        }

        return {} as any;
      }),
    } as unknown as SupabaseClient<Database>;
  }

  beforeEach(() => {
    db = {
      members: new Map([
        [`${wsId}:${ownerId}`, { role: 'owner' }],
        [`${wsId}:${memberId}`, { role: 'member' }],
        [`${wsId}:${otherMemberId}`, { role: 'member' }],
        [`${wsId}:${viewerId}`, { role: 'viewer' }],
      ]),
      tokens: new Map(),
      auditEvents: [],
    };
  });

  describe('createAiToken', () => {
    it('generates high-entropy token conforming to ctc_live_<64-hex> format', async () => {
      const mockSupabase = createMockSupabase();
      const input: CreateTokenInput = {
        workspaceId: wsId,
        userId: memberId,
        name: 'Claude Desktop Agent',
        scopes: ['task:read', 'task:write'],
      };

      const result = await createAiToken(mockSupabase, input);

      // Verify token format
      expect(result.token).toMatch(/^ctc_live_[0-9a-f]{64}$/);
      expect(result.token.length).toBe(73); // "ctc_live_" (9) + 64 hex chars

      // Verify safe metadata
      expect(result.tokenMetadata.id).toBe(tokenId);
      expect(result.tokenMetadata.workspaceId).toBe(wsId);
      expect(result.tokenMetadata.name).toBe('Claude Desktop Agent');
      expect(result.tokenMetadata.tokenPrefix).toMatch(/^ctc_live_[0-9a-f]{8}$/);
      expect(result.tokenMetadata.scopes).toEqual(['task:read', 'task:write']);
      expect(result.tokenMetadata.isRevoked).toBe(false);
      expect(result.tokenMetadata.createdBy).toBe(memberId);

      // Security invariant: token_hash is NOT in tokenMetadata
      expect((result.tokenMetadata as any).token_hash).toBeUndefined();
      expect((result.tokenMetadata as any).tokenHash).toBeUndefined();
    });

    it('persists only SHA-256 hash in database, never the plaintext token', async () => {
      const mockSupabase = createMockSupabase();
      const input: CreateTokenInput = {
        workspaceId: wsId,
        userId: memberId,
        name: 'Automated Worker',
        scopes: ['content:read'],
      };

      const result = await createAiToken(mockSupabase, input);
      const stored = db.tokens.get(tokenId);

      expect(stored).toBeDefined();
      // Plaintext token must NEVER be stored in the database
      expect(stored.token).toBeUndefined();
      expect(stored.rawToken).toBeUndefined();
      // Hash must match SHA-256 of the returned plaintext token
      expect(stored.token_hash).toBe(hashAiToken(result.token));
      expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('calculates expiration date properly when expiresInDays is provided', async () => {
      const mockSupabase = createMockSupabase();
      const input: CreateTokenInput = {
        workspaceId: wsId,
        userId: memberId,
        name: 'Temporary Token',
        scopes: ['task:read'],
        expiresInDays: 30,
      };

      const result = await createAiToken(mockSupabase, input);
      expect(result.tokenMetadata.expiresAt).toBeDefined();

      const expTime = new Date(result.tokenMetadata.expiresAt!).getTime();
      const expectedTime = Date.now() + 30 * 86400000;
      expect(Math.abs(expTime - expectedTime)).toBeLessThan(5000);
    });

    it('logs token.created audit event without leaking token or hash', async () => {
      const mockSupabase = createMockSupabase();
      const input: CreateTokenInput = {
        workspaceId: wsId,
        userId: memberId,
        name: 'Audit Check Token',
        scopes: ['task:read', 'content:read'],
      };

      await createAiToken(mockSupabase, input);

      expect(db.auditEvents.length).toBe(1);
      const audit = db.auditEvents[0];
      expect(audit.event_type).toBe('token.created');
      expect(audit.workspace_id).toBe(wsId);
      expect(audit.actor_id).toBe(memberId);
      expect(audit.actor_type).toBe('user');
      expect(audit.details.name).toBe('Audit Check Token');
      // No plaintext token or hash in audit details
      expect(audit.details.token).toBeUndefined();
      expect(audit.details.token_hash).toBeUndefined();
      expect(audit.details.raw_token).toBeUndefined();
    });

    it('strictly conforms to M7 column-level INSERT grants and omits revoked_at from insert payload', async () => {
      const mockSupabase = createMockSupabase();

      const input: CreateTokenInput = {
        workspaceId: wsId,
        userId: memberId,
        name: 'Privilege Compliance Token',
        scopes: ['task:read'],
      };

      const result = await createAiToken(mockSupabase, input);

      // Inspect mock calls on the ai_api_tokens table query builder
      const fromMock = mockSupabase.from as ReturnType<typeof vi.fn>;
      const tokenCallIndex = fromMock.mock.calls.findIndex((call) => call[0] === 'ai_api_tokens');
      expect(tokenCallIndex).toBeGreaterThanOrEqual(0);

      const queryBuilder = fromMock.mock.results[tokenCallIndex].value;
      const capturedPayload = queryBuilder.insert.mock.calls[0][0];

      expect(capturedPayload).toBeDefined();
      // Must NOT contain revoked_at (omitted so PostgreSQL does not reject with column permission error)
      expect(capturedPayload.revoked_at).toBeUndefined();
      expect('revoked_at' in capturedPayload).toBe(false);

      // All keys in capturedPayload must strictly be within M7's column INSERT grants:
      // GRANT INSERT (workspace_id, client_name, name, token_hash, token_prefix, scopes, is_revoked, created_by, expires_at)
      const M7_INSERT_COLUMNS = new Set([
        'workspace_id',
        'client_name',
        'name',
        'token_hash',
        'token_prefix',
        'scopes',
        'is_revoked',
        'created_by',
        'expires_at',
      ]);
      for (const col of Object.keys(capturedPayload)) {
        expect(M7_INSERT_COLUMNS.has(col)).toBe(true);
      }

      // Safe metadata still provides revokedAt as null
      expect(result.tokenMetadata.revokedAt).toBeNull();
    });

    it('rejects viewer role from creating AI tokens', async () => {
      const mockSupabase = createMockSupabase();
      const input: CreateTokenInput = {
        workspaceId: wsId,
        userId: viewerId,
        name: 'Viewer Token',
        scopes: ['task:read'],
      };

      await expect(createAiToken(mockSupabase, input)).rejects.toThrow(
        /Viewers are not permitted to create AI API tokens/i
      );
    });

    it('rejects users with invalid or nonexistent workspace membership', async () => {
      const mockSupabase = createMockSupabase();
      const input: CreateTokenInput = {
        workspaceId: wsId,
        userId: '123e4567-e89b-12d3-a456-426614174999', // Unknown user
        name: 'Intruder Token',
        scopes: ['task:read'],
      };

      await expect(createAiToken(mockSupabase, input)).rejects.toThrow(
        /You do not have access to this workspace/i
      );
    });

    it('validates token name and scopes strictly', async () => {
      const mockSupabase = createMockSupabase();

      // Empty name
      await expect(
        createAiToken(mockSupabase, {
          workspaceId: wsId,
          userId: memberId,
          name: '',
          scopes: ['task:read'],
        })
      ).rejects.toThrow(/Token name must be between 1 and 100 characters/i);

      // Empty scopes
      await expect(
        createAiToken(mockSupabase, {
          workspaceId: wsId,
          userId: memberId,
          name: 'Valid Name',
          scopes: [],
        })
      ).rejects.toThrow(/At least one valid scope is required/i);

      // Invalid scope
      await expect(
        createAiToken(mockSupabase, {
          workspaceId: wsId,
          userId: memberId,
          name: 'Valid Name',
          scopes: ['unauthorized:superadmin' as any],
        })
      ).rejects.toThrow(/Invalid tool scope/i);
    });
  });

  describe('listWorkspaceTokens', () => {
    beforeEach(() => {
      // Seed two tokens created by memberId, and one by otherMemberId
      db.tokens.set('tok-1', {
        id: '123e4567-e89b-12d3-a456-426614174011',
        workspace_id: wsId,
        client_name: 'Member Token 1',
        name: 'Member Token 1',
        token_hash: 'hash1',
        token_prefix: 'ctc_live_11111111',
        scopes: ['task:read'],
        is_revoked: false,
        revoked_at: null,
        created_by: memberId,
        last_used_at: null,
        expires_at: null,
        created_at: new Date(Date.now() - 1000).toISOString(),
      });
      db.tokens.set('tok-2', {
        id: '123e4567-e89b-12d3-a456-426614174012',
        workspace_id: wsId,
        client_name: 'Member Token 2',
        name: 'Member Token 2',
        token_hash: 'hash2',
        token_prefix: 'ctc_live_22222222',
        scopes: ['task:write'],
        is_revoked: false,
        revoked_at: null,
        created_by: memberId,
        last_used_at: null,
        expires_at: null,
        created_at: new Date(Date.now() - 2000).toISOString(),
      });
      db.tokens.set('tok-3', {
        id: '123e4567-e89b-12d3-a456-426614174013',
        workspace_id: wsId,
        client_name: 'Other Member Token',
        name: 'Other Member Token',
        token_hash: 'hash3',
        token_prefix: 'ctc_live_33333333',
        scopes: ['content:read'],
        is_revoked: false,
        revoked_at: null,
        created_by: otherMemberId,
        last_used_at: null,
        expires_at: null,
        created_at: new Date(Date.now() - 3000).toISOString(),
      });
    });

    it('regular members see only their own tokens', async () => {
      const mockSupabase = createMockSupabase();
      const list = await listWorkspaceTokens(mockSupabase, wsId, memberId);

      expect(list.length).toBe(2);
      expect(list.every((t) => t.createdBy === memberId)).toBe(true);
      // Guarantee token_hash is not present in safe output
      expect(list.every((t) => (t as any).token_hash === undefined)).toBe(true);
    });

    it('admins and owners see all workspace tokens', async () => {
      const mockSupabase = createMockSupabase();
      const list = await listWorkspaceTokens(mockSupabase, wsId, ownerId);

      expect(list.length).toBe(3);
      expect(list.some((t) => t.createdBy === memberId)).toBe(true);
      expect(list.some((t) => t.createdBy === otherMemberId)).toBe(true);
    });

    it('rejects viewer role from listing tokens', async () => {
      const mockSupabase = createMockSupabase();
      await expect(listWorkspaceTokens(mockSupabase, wsId, viewerId)).rejects.toThrow(
        /Viewers cannot manage or list AI API tokens/i
      );
    });
  });

  describe('revokeAiToken', () => {
    const targetTokenId = '123e4567-e89b-12d3-a456-426614174020';

    beforeEach(() => {
      db.tokens.set(targetTokenId, {
        id: targetTokenId,
        workspace_id: wsId,
        client_name: 'Target Token',
        name: 'Target Token',
        token_hash: 'hash_target',
        token_prefix: 'ctc_live_target12',
        scopes: ['task:read'],
        is_revoked: false,
        revoked_at: null,
        created_by: memberId,
        last_used_at: null,
        expires_at: null,
        created_at: new Date().toISOString(),
      });
    });

    it('allows token creator to revoke their own token', async () => {
      const mockSupabase = createMockSupabase();
      const res = await revokeAiToken(mockSupabase, wsId, targetTokenId, memberId);

      expect(res.success).toBe(true);
      const stored = db.tokens.get(targetTokenId);
      expect(stored.is_revoked).toBe(true);
      expect(stored.revoked_at).toBeDefined();

      // Verify audit log
      expect(db.auditEvents.length).toBe(1);
      expect(db.auditEvents[0].event_type).toBe('token.revoked');
    });

    it('allows workspace owner/admin to revoke any token in workspace', async () => {
      const mockSupabase = createMockSupabase();
      const res = await revokeAiToken(mockSupabase, wsId, targetTokenId, ownerId);

      expect(res.success).toBe(true);
      const stored = db.tokens.get(targetTokenId);
      expect(stored.is_revoked).toBe(true);
    });

    it('prevents non-admin member from revoking another user token', async () => {
      const mockSupabase = createMockSupabase();
      await expect(
        revokeAiToken(mockSupabase, wsId, targetTokenId, otherMemberId)
      ).rejects.toThrow(/You do not have permission to revoke another user's token/i);

      const stored = db.tokens.get(targetTokenId);
      expect(stored.is_revoked).toBe(false);
    });
  });

  describe('getTokenMetadata', () => {
    const metaTokenId = '123e4567-e89b-12d3-a456-426614174030';

    beforeEach(() => {
      db.tokens.set(metaTokenId, {
        id: metaTokenId,
        workspace_id: wsId,
        client_name: 'Meta Token',
        name: 'Meta Token',
        token_hash: 'hash_meta',
        token_prefix: 'ctc_live_meta1234',
        scopes: ['content:write'],
        is_revoked: false,
        revoked_at: null,
        created_by: memberId,
        last_used_at: null,
        expires_at: null,
        created_at: new Date().toISOString(),
      });
    });

    it('returns safe metadata without exposing token_hash', async () => {
      const mockSupabase = createMockSupabase();
      const meta = await getTokenMetadata(mockSupabase, wsId, metaTokenId, memberId);

      expect(meta).not.toBeNull();
      expect(meta!.id).toBe(metaTokenId);
      expect(meta!.tokenPrefix).toBe('ctc_live_meta1234');
      expect((meta as any).token_hash).toBeUndefined();
    });

    it('blocks another non-admin member from inspecting the token', async () => {
      const mockSupabase = createMockSupabase();
      await expect(
        getTokenMetadata(mockSupabase, wsId, metaTokenId, otherMemberId)
      ).rejects.toThrow(/You do not have permission to inspect this token/i);
    });
  });
});
