import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';
import {
  createAiTokenAction,
  listWorkspaceTokensAction,
  revokeAiTokenAction,
} from '../src/lib/actions/ai-token-actions';
import {
  createAiTokenSchema,
  revokeAiTokenSchema,
  getTokenLifecycleStatus,
  SUPPORTED_AI_TOKEN_SCOPES,
  AI_TOKEN_SCOPE_DETAILS,
  AI_TOKEN_EXPIRATION_PRESETS,
} from '../src/lib/validation/ai-token';
import {
  AiTokensManager,
  AiTokenRow,
  OneTimeTokenRevealBanner,
} from '../src/components/settings/AiTokensManager';
import AiTokensSettingsPage from '../src/app/settings/tokens/page';
import { AppNavigation } from '../src/components/layout/AppNavigation';
import type { SafeTokenMetadata } from '../src/lib/mcp/token-service';
import { hashAiToken } from '../src/lib/ai/tokens';

// ==============================================================================
// MOCKS FOR NEXT.JS & SUPABASE SERVER ENVIRONMENT
// ==============================================================================

let currentPathname = '/settings/tokens';
const mockRevalidatePath = vi.fn();
const mockRedirect = vi.fn();
const mockConnection = vi.fn();
const mockGetUser = vi.fn();

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => mockRevalidatePath(path),
}));

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

const wsId = '123e4567-e89b-12d3-a456-426614174000';
const otherWsId = '999e4567-e89b-12d3-a456-426614174999';
const ownerId = '123e4567-e89b-12d3-a456-426614174001';
const memberId = '123e4567-e89b-12d3-a456-426614174002';
const otherMemberId = '123e4567-e89b-12d3-a456-426614174003';
const viewerId = '123e4567-e89b-12d3-a456-426614174004';
const outsiderId = '123e4567-e89b-12d3-a456-426614174099';
const generatedTokenId = '123e4567-e89b-12d3-a456-426614174050';

interface MockTokenRecord {
  id: string;
  workspace_id: string;
  client_name: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  scopes: string[];
  is_revoked: boolean;
  revoked_at: string | null;
  created_by: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface MockDbState {
  members: Map<string, { role: string; workspace_id: string }>;
  tokens: Map<string, MockTokenRecord>;
  workspaces: Map<string, { id: string; name: string }>;
  profiles: Map<string, { id: string; timezone: string }>;
  auditEvents: Array<Record<string, unknown>>;
}

let db: MockDbState;

function stripTokenHash(record: MockTokenRecord): Omit<MockTokenRecord, 'token_hash'> {
  const copy: Record<string, unknown> = { ...record };
  delete copy.token_hash;
  return copy as Omit<MockTokenRecord, 'token_hash'>;
}

function buildMockSupabase(): SupabaseClient<Database> {
  return {
    auth: {
      getUser: () => mockGetUser(),
    },
    from: vi.fn((table: string) => {
      if (table === 'workspace_members') {
        const filters: Record<string, string> = {};
        const builder: Record<string, unknown> = {
          select: vi.fn(() => builder),
          eq: vi.fn((col: string, val: string) => {
            filters[col] = val;
            return builder;
          }),
          limit: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => {
            if (filters.workspace_id && filters.user_id) {
              const key = `${filters.workspace_id}:${filters.user_id}`;
              return { data: db.members.get(key) || null, error: null };
            }
            if (filters.user_id) {
              for (const [key, val] of db.members.entries()) {
                if (key.endsWith(`:${filters.user_id}`)) {
                  return { data: val, error: null };
                }
              }
            }
            return { data: null, error: null };
          }),
        };
        return builder;
      }

      if (table === 'workspaces') {
        const filters: Record<string, string> = {};
        const builder: Record<string, unknown> = {
          select: vi.fn(() => builder),
          eq: vi.fn((col: string, val: string) => {
            filters[col] = val;
            return builder;
          }),
          maybeSingle: vi.fn(async () => {
            return { data: db.workspaces.get(filters.id) || null, error: null };
          }),
        };
        return builder;
      }

      if (table === 'profiles') {
        const filters: Record<string, string> = {};
        const builder: Record<string, unknown> = {
          select: vi.fn(() => builder),
          eq: vi.fn((col: string, val: string) => {
            filters[col] = val;
            return builder;
          }),
          maybeSingle: vi.fn(async () => {
            return { data: db.profiles.get(filters.id) || null, error: null };
          }),
        };
        return builder;
      }

      if (table === 'ai_api_tokens') {
        return {
          insert: vi.fn((payload: Omit<MockTokenRecord, 'id' | 'created_at' | 'last_used_at' | 'revoked_at'>) => ({
            select: vi.fn((selectedColumns?: string) => ({
              single: vi.fn(async () => {
                // Verify token_hash is never selected back to caller
                if (selectedColumns?.includes('token_hash')) {
                  throw new Error('SECURITY VIOLATION: token_hash selected in insert return');
                }
                const record: MockTokenRecord = {
                  id: generatedTokenId,
                  ...payload,
                  created_at: '2026-10-31T18:00:00.000Z',
                  last_used_at: null,
                  revoked_at: null,
                };
                db.tokens.set(record.id, record);
                return { data: stripTokenHash(record), error: null };
              }),
            })),
          })),
          select: vi.fn((selectedColumns?: string) => {
            if (selectedColumns?.includes('token_hash')) {
              throw new Error('SECURITY VIOLATION: token_hash selected in token query');
            }
            let filtered = Array.from(db.tokens.values());
            const builder: Record<string, unknown> = {
              eq: vi.fn((col: keyof MockTokenRecord, val: string) => {
                filtered = filtered.filter((t) => t[col] === val);
                return builder;
              }),
              order: vi.fn(() => builder),
              maybeSingle: vi.fn(async () => {
                const item = filtered[0] || null;
                if (!item) return { data: null, error: null };
                return { data: stripTokenHash(item), error: null };
              }),
              then: (resolve: (value: { data: Array<Omit<MockTokenRecord, 'token_hash'>>; error: null }) => void) => {
                const safeList = filtered.map((item) => stripTokenHash(item));
                resolve({ data: safeList, error: null });
              },
            };
            return builder;
          }),
          update: vi.fn((updates: Partial<MockTokenRecord>) => {
            const filters: Record<string, string> = {};
            const builder: Record<string, unknown> = {
              eq: vi.fn((col: string, val: string) => {
                filters[col] = val;
                if (filters.id && filters.workspace_id) {
                  const existing = db.tokens.get(filters.id);
                  if (existing && existing.workspace_id === filters.workspace_id) {
                    db.tokens.set(filters.id, { ...existing, ...updates });
                  }
                  return Promise.resolve({ error: null });
                }
                return builder;
              }),
            };
            return builder;
          }),
        };
      }

      if (table === 'audit_events') {
        return {
          insert: vi.fn(async (payload: Record<string, unknown>) => {
            db.auditEvents.push(payload);
            return { error: null };
          }),
        };
      }

      throw new Error(`Unexpected table queried: ${table}`);
    }),
  } as unknown as SupabaseClient<Database>;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => buildMockSupabase()),
}));

describe('AI API Token Management — Server Actions, Validation & Settings UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentPathname = '/settings/tokens';
    mockConnection.mockResolvedValue(undefined);

    db = {
      members: new Map([
        [`${wsId}:${ownerId}`, { role: 'owner', workspace_id: wsId }],
        [`${wsId}:${memberId}`, { role: 'member', workspace_id: wsId }],
        [`${wsId}:${otherMemberId}`, { role: 'member', workspace_id: wsId }],
        [`${wsId}:${viewerId}`, { role: 'viewer', workspace_id: wsId }],
      ]),
      tokens: new Map(),
      workspaces: new Map([[wsId, { id: wsId, name: 'Miler Command Workspace' }]]),
      profiles: new Map([
        [ownerId, { id: ownerId, timezone: 'Africa/Cairo' }],
        [memberId, { id: memberId, timezone: 'Africa/Cairo' }],
      ]),
      auditEvents: [],
    };
  });

  // ============================================================================
  // 1. VALIDATION SCHEMAS & LIFECYCLE STATUS HELPERS
  // ============================================================================
  describe('Validation Schemas & Token Lifecycle Helpers', () => {
    it('supports only the 4 authoritative backend tool scopes', () => {
      expect(SUPPORTED_AI_TOKEN_SCOPES).toEqual([
        'task:read',
        'task:write',
        'content:read',
        'content:write',
      ]);
      expect(AI_TOKEN_SCOPE_DETAILS.map((d) => d.scope)).toEqual([
        'task:read',
        'task:write',
        'content:read',
        'content:write',
      ]);
      expect(AI_TOKEN_EXPIRATION_PRESETS.length).toBeGreaterThanOrEqual(5);
    });

    it('deduplicates repeated scopes and trims token name in createAiTokenSchema', () => {
      const parsed = createAiTokenSchema.parse({
        name: '  Claude Desktop  ',
        scopes: ['task:read', 'task:read', 'content:read'],
        expiresInDays: 30,
      });

      expect(parsed.name).toBe('Claude Desktop');
      expect(parsed.scopes).toEqual(['task:read', 'content:read']);
      expect(parsed.expiresInDays).toBe(30);
    });

    it('rejects empty name, overly long name, empty scopes, invalid scopes, and invalid expiration', () => {
      expect(() =>
        createAiTokenSchema.parse({ name: '   ', scopes: ['task:read'] })
      ).toThrow(/Token name is required/i);

      expect(() =>
        createAiTokenSchema.parse({ name: 'x'.repeat(101), scopes: ['task:read'] })
      ).toThrow(/cannot exceed 100 characters/i);

      expect(() =>
        createAiTokenSchema.parse({ name: 'Valid', scopes: [] })
      ).toThrow(/At least one permission scope/i);

      expect(() =>
        createAiTokenSchema.parse({ name: 'Valid', scopes: ['admin:all' as unknown as 'task:read'] })
      ).toThrow();

      expect(() =>
        createAiTokenSchema.parse({ name: 'Valid', scopes: ['task:read'], expiresInDays: 0 })
      ).toThrow(/at least 1 day/i);

      expect(() =>
        createAiTokenSchema.parse({ name: 'Valid', scopes: ['task:read'], expiresInDays: -15 })
      ).toThrow(/at least 1 day/i);

      expect(() =>
        revokeAiTokenSchema.parse({ tokenId: 'not-a-uuid' })
      ).toThrow(/Invalid token ID/i);
    });

    it('accurately classifies active, revoked, and expired tokens via getTokenLifecycleStatus', () => {
      const refTime = new Date('2026-10-31T12:00:00.000Z');

      expect(
        getTokenLifecycleStatus({ isRevoked: false, expiresAt: null }, refTime)
      ).toBe('active');

      expect(
        getTokenLifecycleStatus(
          { isRevoked: false, expiresAt: '2026-11-30T12:00:00.000Z' },
          refTime
        )
      ).toBe('active');

      expect(
        getTokenLifecycleStatus(
          { isRevoked: true, expiresAt: '2026-11-30T12:00:00.000Z' },
          refTime
        )
      ).toBe('revoked');

      expect(
        getTokenLifecycleStatus(
          { isRevoked: false, expiresAt: '2026-10-30T12:00:00.000Z' },
          refTime
        )
      ).toBe('expired');
    });
  });

  // ============================================================================
  // 2. UNAUTHENTICATED & UNAUTHORIZED WORKSPACE ACCESS
  // ============================================================================
  describe('Server Actions: Authentication & Workspace Authorization Boundaries', () => {
    it('rejects unauthenticated requests across create, list, and revoke actions', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const createRes = await createAiTokenAction(wsId, {
        name: 'Claude Token',
        scopes: ['task:read'],
      });
      expect(createRes).toEqual({ error: 'Authentication required' });

      const listRes = await listWorkspaceTokensAction(wsId);
      expect(listRes).toEqual({ error: 'Authentication required' });

      const revokeRes = await revokeAiTokenAction(wsId, generatedTokenId);
      expect(revokeRes).toEqual({ error: 'Authentication required' });
    });

    it('rejects access to an unauthorized or foreign workspace across all actions', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: outsiderId } } });

      const createRes = await createAiTokenAction(wsId, {
        name: 'Intruder Token',
        scopes: ['task:read'],
      });
      expect(createRes.error).toMatch(/Unauthorized: You do not have access to this workspace/i);

      const listRes = await listWorkspaceTokensAction(wsId);
      expect(listRes.error).toMatch(/Unauthorized: You do not have access to this workspace/i);

      const revokeRes = await revokeAiTokenAction(wsId, generatedTokenId);
      expect(revokeRes.error).toMatch(/Unauthorized: You do not have access to this workspace/i);

      // Member of wsId attempting to access otherWsId
      mockGetUser.mockResolvedValue({ data: { user: { id: memberId } } });
      const crossWsRes = await listWorkspaceTokensAction(otherWsId);
      expect(crossWsRes.error).toMatch(/Unauthorized: You do not have access to this workspace/i);
    });
  });

  // ============================================================================
  // 3. ROLE PERMISSIONS & INSUFFICIENT WORKSPACE ROLES
  // ============================================================================
  describe('Server Actions: Workspace Role Enforcement', () => {
    it('rejects viewer role from creating, listing, or revoking AI API tokens', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: viewerId } } });

      const createRes = await createAiTokenAction(wsId, {
        name: 'Viewer Token',
        scopes: ['task:read'],
      });
      expect(createRes.error).toMatch(/Forbidden: Viewers are not permitted to create AI API tokens/i);

      const listRes = await listWorkspaceTokensAction(wsId);
      expect(listRes.error).toMatch(/Forbidden: Viewers cannot manage or list AI API tokens/i);

      const revokeRes = await revokeAiTokenAction(wsId, generatedTokenId);
      expect(revokeRes.error).toMatch(/Forbidden: Viewers are not permitted to revoke AI API tokens/i);
    });

    it('prevents a non-admin member from revoking another user token', async () => {
      // Seed token owned by ownerId
      db.tokens.set(generatedTokenId, {
        id: generatedTokenId,
        workspace_id: wsId,
        client_name: 'Owner Token',
        name: 'Owner Token',
        token_hash: 'secret_hash_value',
        token_prefix: 'ctc_live_12345678',
        scopes: ['task:read'],
        is_revoked: false,
        revoked_at: null,
        created_by: ownerId,
        last_used_at: null,
        expires_at: null,
        created_at: '2026-10-31T10:00:00.000Z',
      });

      mockGetUser.mockResolvedValue({ data: { user: { id: memberId } } });
      const res = await revokeAiTokenAction(wsId, generatedTokenId);

      expect(res.error).toMatch(/Forbidden: You do not have permission to revoke another user's token/i);
      expect(db.tokens.get(generatedTokenId)?.is_revoked).toBe(false);
    });
  });

  // ============================================================================
  // 4. TOKEN CREATION, LISTING & REVOCATION LIFECYCLE
  // ============================================================================
  describe('Server Actions: Creation, Listing & Revocation Lifecycle', () => {
    it('creates a token, returns plaintext token once, stores only SHA-256 hash, and revalidates /settings/tokens', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: ownerId } } });

      const res = await createAiTokenAction(wsId, {
        name: 'Claude Production MCP',
        scopes: ['task:read', 'task:write', 'content:read'],
        expiresInDays: 30,
      });

      expect(res.success).toBe(true);
      expect(res.data).toBeDefined();

      // Plaintext token returned in creation result
      const rawToken = res.data!.token;
      expect(rawToken).toMatch(/^ctc_live_[0-9a-f]{64}$/);

      // Safe metadata returned without token_hash
      const meta = res.data!.tokenMetadata;
      expect(meta.id).toBe(generatedTokenId);
      expect(meta.name).toBe('Claude Production MCP');
      expect(meta.tokenPrefix).toBe(rawToken.slice(0, 17));
      expect(meta.scopes).toEqual(['task:read', 'task:write', 'content:read']);
      expect(meta.isRevoked).toBe(false);
      expect(meta.expiresAt).not.toBeNull();
      const metaRecord = meta as unknown as Record<string, unknown>;
      expect(metaRecord.token_hash).toBeUndefined();
      expect(metaRecord.tokenHash).toBeUndefined();

      // Database stores SHA-256 hash, never the raw token
      const storedRecord = db.tokens.get(generatedTokenId)!;
      expect(storedRecord.token_hash).toBe(hashAiToken(rawToken));
      expect((storedRecord as unknown as Record<string, unknown>).token).toBeUndefined();

      expect(mockRevalidatePath).toHaveBeenCalledWith('/settings/tokens');
    });

    it('lists workspace tokens without ever exposing raw tokens or token hashes', async () => {
      // Create a token first
      mockGetUser.mockResolvedValue({ data: { user: { id: ownerId } } });
      const created = await createAiTokenAction(wsId, {
        name: 'Claude Desktop',
        scopes: ['task:read', 'content:read'],
        expiresInDays: null,
      });
      const rawSecret = created.data!.token;

      // Now list tokens
      const listRes = await listWorkspaceTokensAction(wsId);
      expect(listRes.success).toBe(true);
      expect(listRes.data).toHaveLength(1);

      const listed = listRes.data![0];
      expect(listed.name).toBe('Claude Desktop');
      expect(listed.tokenPrefix).toMatch(/^ctc_live_[0-9a-f]{8}$/);
      expect(listed.expiresAt).toBeNull();

      const serialized = JSON.stringify(listRes.data);
      expect(serialized).not.toContain(rawSecret);
      expect(serialized).not.toContain(hashAiToken(rawSecret));
      expect(serialized).not.toContain('token_hash');
    });

    it('revokes an active token and records revoked_at + audit event', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: memberId } } });
      await createAiTokenAction(wsId, {
        name: 'Member Laptop Token',
        scopes: ['task:read'],
      });

      const revokeRes = await revokeAiTokenAction(wsId, generatedTokenId);
      expect(revokeRes).toEqual({
        success: true,
        data: { revoked: true },
      });

      const stored = db.tokens.get(generatedTokenId)!;
      expect(stored.is_revoked).toBe(true);
      expect(stored.revoked_at).toBeTruthy();
      expect(mockRevalidatePath).toHaveBeenCalledWith('/settings/tokens');
    });

    it('rejects invalid input in createAiTokenAction and revokeAiTokenAction with safe errors', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: ownerId } } });

      const badCreate = await createAiTokenAction(wsId, {
        name: '',
        scopes: [],
      });
      expect(badCreate.error).toMatch(/Token name is required/i);

      const badRevoke = await revokeAiTokenAction(wsId, 'invalid-uuid');
      expect(badRevoke.error).toMatch(/Invalid token ID format/i);

      const emptyRevoke = await revokeAiTokenAction(wsId, '   ');
      expect(emptyRevoke.error).toMatch(/Token ID is required/i);
    });
  });

  // ============================================================================
  // 5. SETTINGS UI, ONE-TIME REVEAL, STATES & NAVIGATION
  // ============================================================================
  describe('Settings UI Components & Navigation (/settings/tokens)', () => {
    const sampleActiveToken: SafeTokenMetadata = {
      id: '123e4567-e89b-12d3-a456-426614174010',
      workspaceId: wsId,
      name: 'Claude Desktop — Studio Mac',
      clientName: 'Claude Desktop — Studio Mac',
      tokenPrefix: 'ctc_live_a1b2c3d4',
      scopes: ['task:read', 'task:write', 'content:read', 'content:write'],
      isRevoked: false,
      revokedAt: null,
      createdBy: ownerId,
      lastUsedAt: '2026-10-31T15:30:00.000Z',
      expiresAt: '2026-11-30T15:30:00.000Z',
      createdAt: '2026-10-31T10:00:00.000Z',
    };

    const sampleRevokedToken: SafeTokenMetadata = {
      id: '123e4567-e89b-12d3-a456-426614174011',
      workspaceId: wsId,
      name: 'Old Laptop Token',
      clientName: 'Old Laptop Token',
      tokenPrefix: 'ctc_live_deadbeef',
      scopes: ['task:read'],
      isRevoked: true,
      revokedAt: '2026-10-31T16:00:00.000Z',
      createdBy: ownerId,
      lastUsedAt: null,
      expiresAt: null,
      createdAt: '2026-10-20T10:00:00.000Z',
    };

    const sampleExpiredToken: SafeTokenMetadata = {
      id: '123e4567-e89b-12d3-a456-426614174012',
      workspaceId: wsId,
      name: 'Short-Lived Test Token',
      clientName: 'Short-Lived Test Token',
      tokenPrefix: 'ctc_live_cafebabe',
      scopes: ['content:read'],
      isRevoked: false,
      revokedAt: null,
      createdBy: ownerId,
      lastUsedAt: null,
      expiresAt: '2026-10-01T00:00:00.000Z',
      createdAt: '2026-09-24T00:00:00.000Z',
    };

    it('renders loading state when tokens are being fetched', () => {
      const html = renderToStaticMarkup(
        React.createElement(AiTokensManager, {
          workspaceId: wsId,
          workspaceName: 'Miler Command Workspace',
          initialLoading: true,
        })
      );

      expect(html).toContain('data-testid="ai-tokens-loading-state"');
      expect(html).toContain('Loading workspace API tokens...');
    });

    it('renders empty state when workspace has no tokens', () => {
      const html = renderToStaticMarkup(
        React.createElement(AiTokensManager, {
          workspaceId: wsId,
          workspaceName: 'Miler Command Workspace',
          initialTokens: [],
          initialLoading: false,
        })
      );

      expect(html).toContain('data-testid="ai-tokens-empty-state"');
      expect(html).toContain('No API tokens created yet');
    });

    it('renders error banner with retry option when an error occurs', () => {
      const html = renderToStaticMarkup(
        React.createElement(AiTokensManager, {
          workspaceId: wsId,
          initialTokens: [],
          initialLoading: false,
          initialError: 'Failed to load workspace tokens',
        })
      );

      expect(html).toContain('data-testid="ai-tokens-error-banner"');
      expect(html).toContain('Failed to load workspace tokens');
      expect(html).toContain('Retry');
    });

    it('renders one-time secret reveal banner with copy button and security warning', () => {
      const fakeRawToken = `ctc_live_${'a'.repeat(64)}`;
      const html = renderToStaticMarkup(
        React.createElement(OneTimeTokenRevealBanner, {
          revealed: {
            token: fakeRawToken,
            tokenName: 'Claude Desktop — Studio Mac',
            tokenId: sampleActiveToken.id,
            tokenPrefix: 'ctc_live_aaaaaaaa',
          },
          copied: false,
          onCopy: vi.fn(),
          onDismiss: vi.fn(),
        })
      );

      expect(html).toContain('data-testid="one-time-token-reveal"');
      expect(html).toContain('data-testid="revealed-raw-token"');
      expect(html).toContain(fakeRawToken);
      expect(html).toContain('Copy Token');
      expect(html).toContain('only once');
      expect(html).toContain('cannot be retrieved again');
    });

    it('clearly distinguishes Active, Revoked, and Expired tokens in the list without exposing full secrets', () => {
      const refTime = new Date('2026-10-31T18:00:00.000Z');

      const activeHtml = renderToStaticMarkup(
        React.createElement(AiTokenRow, {
          token: sampleActiveToken,
          userTimeZone: 'Africa/Cairo',
          isConfirmingRevoke: false,
          isRevoking: false,
          onRequestRevoke: vi.fn(),
          onCancelRevoke: vi.fn(),
          onConfirmRevoke: vi.fn(),
          referenceTime: refTime,
        })
      );
      expect(activeHtml).toContain('Claude Desktop — Studio Mac');
      expect(activeHtml).toContain('Active');
      expect(activeHtml).toContain('ctc_live_a1b2c3d4...');
      expect(activeHtml).toContain(`data-testid="revoke-token-btn-${sampleActiveToken.id}"`);

      const revokedHtml = renderToStaticMarkup(
        React.createElement(AiTokenRow, {
          token: sampleRevokedToken,
          userTimeZone: 'Africa/Cairo',
          isConfirmingRevoke: false,
          isRevoking: false,
          onRequestRevoke: vi.fn(),
          onCancelRevoke: vi.fn(),
          onConfirmRevoke: vi.fn(),
          referenceTime: refTime,
        })
      );
      expect(revokedHtml).toContain('Old Laptop Token');
      expect(revokedHtml).toContain('Revoked');
      expect(revokedHtml).not.toContain(`data-testid="revoke-token-btn-${sampleRevokedToken.id}"`);

      const expiredHtml = renderToStaticMarkup(
        React.createElement(AiTokenRow, {
          token: sampleExpiredToken,
          userTimeZone: 'Africa/Cairo',
          isConfirmingRevoke: false,
          isRevoking: false,
          onRequestRevoke: vi.fn(),
          onCancelRevoke: vi.fn(),
          onConfirmRevoke: vi.fn(),
          referenceTime: refTime,
        })
      );
      expect(expiredHtml).toContain('Short-Lived Test Token');
      expect(expiredHtml).toContain('Expired');
    });

    it('renders explicit confirmation controls before revoking a token', () => {
      const confirmHtml = renderToStaticMarkup(
        React.createElement(AiTokenRow, {
          token: sampleActiveToken,
          userTimeZone: 'Africa/Cairo',
          isConfirmingRevoke: true,
          isRevoking: false,
          onRequestRevoke: vi.fn(),
          onCancelRevoke: vi.fn(),
          onConfirmRevoke: vi.fn(),
        })
      );

      expect(confirmHtml).toContain(`data-testid="revoke-confirm-controls-${sampleActiveToken.id}"`);
      expect(confirmHtml).toContain('Revoke permanently?');
      expect(confirmHtml).toContain('Confirm Revoke');
      expect(confirmHtml).toContain('Cancel');
    });

    it('includes API Tokens link in AppNavigation for discoverability', () => {
      const navHtml = renderToStaticMarkup(React.createElement(AppNavigation));
      expect(navHtml).toContain('href="/settings/tokens"');
      expect(navHtml).toContain('API Tokens');
    });

    it('/settings/tokens redirects unauthenticated users to /auth/sign-in', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });

      await expect(AiTokensSettingsPage()).rejects.toThrow(
        'NEXT_REDIRECT: /auth/sign-in?redirectTo=/settings/tokens'
      );
      expect(mockRedirect).toHaveBeenCalledWith('/auth/sign-in?redirectTo=/settings/tokens');
    });

    it('/settings/tokens renders Workspace Required banner when user has no workspace', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: outsiderId } } });

      const page = await AiTokensSettingsPage();
      const html = renderToStaticMarkup(page);
      expect(html).toContain('Workspace Required');
    });

    it('/settings/tokens renders AiTokensManager when authenticated and authorized', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: ownerId } } });

      const page = await AiTokensSettingsPage();
      const html = renderToStaticMarkup(page);
      expect(html).toContain('AI &amp; MCP API Tokens');
      expect(html).toContain('Miler Command Workspace');
    });
  });
});
