import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { authenticateAiToken } from '@/lib/mcp/auth';
import { sanitizeAuditDetails } from '@/lib/mcp/audit';
import { hashAiToken } from '@/lib/ai/tokens';

describe('AI Gateway Authentication & Security Layer (Phase 7.4: auth.ts)', () => {
  const wsId = '123e4567-e89b-12d3-a456-426614174000';
  const userId = '123e4567-e89b-12d3-a456-426614174001';
  const tokenId = '123e4567-e89b-12d3-a456-426614174099';

  // Valid raw token: prefix (9) + 64 hex chars = 73 chars
  const validRawToken =
    'ctc_live_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const validTokenHash = hashAiToken(validRawToken);

  interface MockDbState {
    tokens: Map<string, any>;
    members: Map<string, { role: string }>;
    profiles: Map<string, { timezone: string }>;
    rateLimits: Map<string, { window_start: string; request_count: number }>;
    auditEvents: any[];
  }

  let db: MockDbState;

  function createMockAdminClient(): SupabaseClient<Database> {
    return {
      from: vi.fn((table: string) => {
        if (table === 'ai_api_tokens') {
          return {
            select: vi.fn((_cols?: string) => ({
              eq: vi.fn((field: string, val: string) => ({
                maybeSingle: vi.fn(async () => {
                  for (const token of db.tokens.values()) {
                    if (token[field] === val) {
                      return { data: { ...token }, error: null };
                    }
                  }
                  return { data: null, error: null };
                }),
              })),
            })),
            update: vi.fn((updates: any) => ({
              eq: vi.fn((field: string, val: string) => {
                for (const [id, t] of db.tokens.entries()) {
                  if (t[field] === val) {
                    db.tokens.set(id, { ...t, ...updates });
                  }
                }
                return Promise.resolve({ error: null });
              }),
            })),
          };
        }

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
                    return { data: mem ? { ...mem } : null, error: null };
                  }),
                })),
              })),
            })),
          };
        }

        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((_f: string, id: string) => ({
                maybeSingle: vi.fn(async () => {
                  const p = db.profiles.get(id);
                  return { data: p ? { ...p } : null, error: null };
                }),
              })),
            })),
          };
        }

        if (table === 'ai_token_rate_limits') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((_f: string, tId: string) => ({
                maybeSingle: vi.fn(async () => {
                  const rl = db.rateLimits.get(tId);
                  return { data: rl ? { token_id: tId, ...rl } : null, error: null };
                }),
              })),
            })),
            insert: vi.fn(async (payload: any) => {
              db.rateLimits.set(payload.token_id, {
                window_start: payload.window_start,
                request_count: payload.request_count,
              });
              return { error: null };
            }),
            update: vi.fn((updates: any) => ({
              eq: vi.fn((_f: string, tId: string) => {
                const current = db.rateLimits.get(tId) || {
                  window_start: new Date().toISOString(),
                  request_count: 0,
                };
                db.rateLimits.set(tId, { ...current, ...updates });
                return Promise.resolve({ error: null });
              }),
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
      tokens: new Map([
        [
          tokenId,
          {
            id: tokenId,
            workspace_id: wsId,
            client_name: 'Test Token',
            name: 'Test Token',
            token_hash: validTokenHash,
            token_prefix: 'ctc_live_01234567',
            scopes: ['task:read', 'task:write'],
            is_revoked: false,
            revoked_at: null,
            created_by: userId,
            last_used_at: null,
            expires_at: null,
            created_at: new Date().toISOString(),
          },
        ],
      ]),
      members: new Map([[`${wsId}:${userId}`, { role: 'member' }]]),
      profiles: new Map([[userId, { timezone: 'Europe/Paris' }]]),
      rateLimits: new Map(),
      auditEvents: [],
    };
  });

  describe('Format Validation & Fast Failure', () => {
    it('rejects malformed token formats without touching database', async () => {
      const mockAdmin = createMockAdminClient();
      const invalidTokens = [
        '',
        '   ',
        'invalid_prefix_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        'ctc_live_too_short',
        'ctc_live_' + 'a'.repeat(63), // 63 chars instead of 64
        'ctc_live_' + 'a'.repeat(65), // 65 chars instead of 64
        'ctc_live_' + 'Z'.repeat(64), // non-hex uppercase
        'Bearer ctc_live_' + 'a'.repeat(64), // includes scheme in token parameter
      ];

      for (const badToken of invalidTokens) {
        const res = await authenticateAiToken(badToken, { adminClient: mockAdmin });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.status).toBe(401);
          expect(res.error.code).toBe('UNAUTHORIZED');
          expect(res.error.message).toBe('Invalid or malformed API token');
        }
      }

      // Ensure no database queries were executed during fast format rejections
      expect(mockAdmin.from).not.toHaveBeenCalled();
    });
  });

  describe('Successful Authentication', () => {
    it('authenticates valid token and returns trusted AIExecutionContext', async () => {
      const mockAdmin = createMockAdminClient();
      const res = await authenticateAiToken(validRawToken, { adminClient: mockAdmin });

      expect(res.success).toBe(true);
      if (res.success) {
        // Verified trusted context
        expect(res.context.workspaceId).toBe(wsId);
        expect(res.context.userId).toBe(userId);
        expect(res.context.actorId).toBe(tokenId);
        expect(res.context.scopes).toEqual(['task:read', 'task:write']);
        expect(res.context.timeZone).toBe('Europe/Paris');
        expect(res.context.supabase).toBe(mockAdmin);
      }

      // Check that rate limit was registered
      expect(db.rateLimits.has(tokenId)).toBe(true);
      expect(db.rateLimits.get(tokenId)!.request_count).toBe(1);
    });

    it('falls back to UTC timezone if profile timezone is absent', async () => {
      db.profiles.delete(userId);
      const mockAdmin = createMockAdminClient();
      const res = await authenticateAiToken(validRawToken, { adminClient: mockAdmin });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.context.timeZone).toBe('UTC');
      }
    });
  });

  describe('Rejection of Invalid Token States', () => {
    it('rejects unknown token hashes with generic 401', async () => {
      const mockAdmin = createMockAdminClient();
      const unknownToken =
        'ctc_live_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

      const res = await authenticateAiToken(unknownToken, { adminClient: mockAdmin });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe(401);
        expect(res.error.code).toBe('UNAUTHORIZED');
        expect(res.error.message).toBe('Invalid or unauthenticated API token');
      }

      // Verify audit failure logged with workspace_id null and without leaking token or prefix
      const failureAudit = db.auditEvents.find((e) => e.event_type === 'token.auth_failed');
      expect(failureAudit).toBeDefined();
      expect(failureAudit.workspace_id).toBeNull();
      expect(failureAudit.details.tokenPrefix).toBeUndefined();
      expect(failureAudit.details.token).toBeUndefined();
      expect(failureAudit.details.raw_token).toBeUndefined();
    });

    it('rejects revoked tokens with generic 401 immediately', async () => {
      const mockAdmin = createMockAdminClient();
      // Revoke token
      db.tokens.get(tokenId).is_revoked = true;
      db.tokens.get(tokenId).revoked_at = new Date().toISOString();

      const res = await authenticateAiToken(validRawToken, { adminClient: mockAdmin });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe(401);
        expect(res.error.code).toBe('UNAUTHORIZED');
        expect(res.error.message).toBe('Invalid or unauthenticated API token');
      }
    });

    it('rejects expired tokens with generic 401', async () => {
      const mockAdmin = createMockAdminClient();
      // Expire token 1 hour ago
      db.tokens.get(tokenId).expires_at = new Date(Date.now() - 3600000).toISOString();

      const res = await authenticateAiToken(validRawToken, { adminClient: mockAdmin });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe(401);
        expect(res.error.code).toBe('UNAUTHORIZED');
      }
    });

    it('allows tokens with future expiration date', async () => {
      const mockAdmin = createMockAdminClient();
      // Future expiration in 2 days
      db.tokens.get(tokenId).expires_at = new Date(Date.now() + 2 * 86400000).toISOString();

      const res = await authenticateAiToken(validRawToken, { adminClient: mockAdmin });
      expect(res.success).toBe(true);
    });
  });

  describe('Active Workspace Membership Verification', () => {
    it('rejects tokens whose owner is no longer an active workspace member', async () => {
      const mockAdmin = createMockAdminClient();
      // Remove user membership from workspace
      db.members.delete(`${wsId}:${userId}`);

      const res = await authenticateAiToken(validRawToken, { adminClient: mockAdmin });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe(403);
        expect(res.error.code).toBe('FORBIDDEN');
        expect(res.error.message).toMatch(/token creator is no longer an active workspace member/i);
      }
    });
  });

  describe('Persistent Rate Limiting & Burst Protection', () => {
    it('tracks sequential requests and blocks bursts exceeding rate limit quota', async () => {
      const mockAdmin = createMockAdminClient();
      const maxRequests = 5;
      const windowSeconds = 60;
      const refTime = new Date('2026-10-30T12:00:00.000Z');

      // Make 5 requests within limit
      for (let i = 1; i <= maxRequests; i++) {
        const res = await authenticateAiToken(validRawToken, {
          adminClient: mockAdmin,
          maxRequests,
          windowSeconds,
          referenceTime: refTime,
        });
        expect(res.success).toBe(true);
      }

      // 6th burst request exceeds quota
      const burstRes = await authenticateAiToken(validRawToken, {
        adminClient: mockAdmin,
        maxRequests,
        windowSeconds,
        referenceTime: refTime,
      });

      expect(burstRes.success).toBe(false);
      if (!burstRes.success) {
        expect(burstRes.status).toBe(429);
        expect(burstRes.error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(burstRes.error.message).toMatch(/Rate limit exceeded/i);
        expect((burstRes.error.details as any).retryAfterSeconds).toBeGreaterThan(0);
      }

      // After window expiration (61 seconds later), requests are permitted again
      const futureTime = new Date(refTime.getTime() + 61000);
      const resetRes = await authenticateAiToken(validRawToken, {
        adminClient: mockAdmin,
        maxRequests,
        windowSeconds,
        referenceTime: futureTime,
      });

      expect(resetRes.success).toBe(true);
    });

    it('fails closed and returns 429 when rate limiter encounters a database error', async () => {
      const mockAdmin = createMockAdminClient();
      // Mock RPC throwing database network error
      (mockAdmin as any).rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database query timeout', code: '57014' },
      });

      const res = await authenticateAiToken(validRawToken, {
        adminClient: mockAdmin,
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe(429);
        expect(res.error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(res.error.message).toMatch(/Rate limit exceeded/i);
      }
    });
  });

  describe('Security and Information Leakage Prevention', () => {
    it('never includes secrets, token hashes, or raw tokens in error details', async () => {
      const mockAdmin = createMockAdminClient();
      const unknownToken =
        'ctc_live_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

      const res = await authenticateAiToken(unknownToken, { adminClient: mockAdmin });
      expect(res.success).toBe(false);
      if (!res.success) {
        const errorJson = JSON.stringify(res.error);
        expect(errorJson).not.toContain(unknownToken);
        expect(errorJson).not.toContain(hashAiToken(unknownToken));
      }
    });

    it('guarantees context workspaceId and userId cannot be influenced by caller input', async () => {
      const mockAdmin = createMockAdminClient();
      const res = await authenticateAiToken(validRawToken, { adminClient: mockAdmin });

      expect(res.success).toBe(true);
      if (res.success) {
        // Identifiers strictly mirror verified DB record
        expect(res.context.workspaceId).toBe(wsId);
        expect(res.context.userId).toBe(userId);
      }
    });

    it('sanitizes secrets, raw tokens, and bearer strings from nested audit payloads', () => {
      const rawPayload = {
        normalField: 'ok',
        sensitiveTokenKey: 'secret-val',
        userKey: 'my-key',
        nestedObj: {
          password: 'pass',
          nestedMessage: 'Header was Bearer ctc_live_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        },
        items: [
          'normal',
          'Token: ctc_live_111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000',
        ],
      };

      const sanitized = sanitizeAuditDetails(rawPayload);

      expect(sanitized.normalField).toBe('ok');
      expect(sanitized.sensitiveTokenKey).toBe('[REDACTED]');
      expect(sanitized.userKey).toBe('[REDACTED]');
      expect((sanitized.nestedObj as any).password).toBe('[REDACTED]');
      expect((sanitized.nestedObj as any).nestedMessage).toBe('Header was Bearer [REDACTED_TOKEN]');
      expect((sanitized.items as any)[0]).toBe('normal');
      expect((sanitized.items as any)[1]).toBe('Token: [REDACTED_TOKEN]');
    });
  });
});
