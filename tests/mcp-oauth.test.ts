import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OAuthErrorCode } from '@modelcontextprotocol/server';
import type {
  Database,
  WorkspaceRole,
} from '@/types/database';
import type { ToolScope } from '@/lib/mcp/types';
import {
  CANONICAL_MCP_RESOURCE,
  CANONICAL_PRODUCTION_ORIGIN,
  computePkceS256Challenge,
  DEFAULT_READ_ONLY_SCOPES,
  exchangeAuthorizationCode,
  issueOAuthAuthorizationCode,
  normalizeResourceIndicator,
  parseAndValidateOAuthScopes,
  registerOAuthClient,
  rotateOAuthRefreshToken,
  validateOAuthAuthorizeParams,
  validateRedirectUri,
  verifyPkceS256,
  type TokenExchangeResponse,
} from '@/lib/mcp/oauth';
import { authenticateAiToken } from '@/lib/mcp/auth';
import { createAiToken, revokeAiToken } from '@/lib/mcp/token-service';
import { GET as getProtectedResourceRoot } from '@/app/.well-known/oauth-protected-resource/route';
import { GET as getProtectedResourceMcp } from '@/app/.well-known/oauth-protected-resource/api/mcp/route';
import { GET as getAuthServerMetadata } from '@/app/.well-known/oauth-authorization-server/route';
import { handleOAuthRegisterRequest } from '@/app/api/oauth/register/route';
import { handleOAuthTokenRequest } from '@/app/api/oauth/token/route';
import { handleOAuthRevokeRequest } from '@/app/api/oauth/revoke/route';
import { handleMcpRequest, GET as getMcpRoute } from '@/app/api/mcp/route';
import { submitOAuthDecisionAction } from '@/lib/actions/oauth-actions';
import { createTask } from '@/lib/services/task-service';

// Mock task/content/dashboard services for full MCP gateway tool execution tests
vi.mock('@/lib/services/task-service', () => ({
  getTasks: vi.fn(async () => []),
  getTaskById: vi.fn(async () => null),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
}));

vi.mock('@/lib/services/content-service', () => ({
  getContentItems: vi.fn(async () => []),
  getContentItemById: vi.fn(async () => null),
  createContentItem: vi.fn(),
  updateContentItem: vi.fn(),
}));

vi.mock('@/lib/services/dashboard-service', () => ({
  getDashboardSummary: vi.fn(async () => ({
    overdueTasksCount: 0,
    dueTodayTasksCount: 0,
    pendingSubtasksCount: 0,
    blockedTasksCount: 0,
    draftContentCount: 0,
    upcomingScheduledCount: 0,
    unreadNotificationsCount: 0,
  })),
}));

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

type TokenRow = Database['public']['Tables']['ai_api_tokens']['Row'];
type ClientRow = Database['public']['Tables']['oauth_clients']['Row'];
type CodeRow = Database['public']['Tables']['oauth_authorization_codes']['Row'];
type RefreshRow = Database['public']['Tables']['oauth_refresh_tokens']['Row'];

interface InMemoryOAuthDb {
  tokens: Map<string, TokenRow>;
  clients: Map<string, ClientRow>;
  codes: Map<string, CodeRow>;
  refreshTokens: Map<string, RefreshRow>;
  members: Map<string, { role: WorkspaceRole }>;
  profiles: Map<string, { timezone: string }>;
  rateLimits: Map<string, { window_start: string; request_count: number }>;
  auditEvents: Array<Record<string, unknown>>;
  useRpc: boolean;
}

describe('Claude Web Remote MCP OAuth 2.1 Architecture & Security Suite', () => {
  const workspaceA = '11111111-1111-4111-8111-111111111111';
  const workspaceB = '99999999-9999-4999-8999-999999999999';
  const userId = '22222222-2222-4222-8222-222222222222';
  const adminUserId = '33333333-3333-4333-8333-333333333333';
  const memberUserId = '55555555-5555-4555-8555-555555555555';
  const viewerUserId = '44444444-4444-4444-8444-444444444444';

  const validVerifier =
    'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk-0123456789abcdefABCDEF';
  const validChallenge = computePkceS256Challenge(validVerifier);

  let db: InMemoryOAuthDb;
  let adminClient: SupabaseClient<Database>;

  function buildInMemoryAdminClient(state: InMemoryOAuthDb): SupabaseClient<Database> {
    const clientObj: Record<string, unknown> = {
      from: (table: string) => {
        if (table === 'oauth_clients') {
          return {
            select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
              const filters: Array<(row: ClientRow) => boolean> = [];
              const builder = {
                eq: (field: keyof ClientRow, val: string) => {
                  filters.push((r) => r[field] === val);
                  return builder;
                },
                gte: (field: keyof ClientRow, val: string) => {
                  filters.push((r) => String(r[field] ?? '') >= val);
                  return builder;
                },
                maybeSingle: async () => {
                  const match = Array.from(state.clients.values()).find((r) =>
                    filters.every((fn) => fn(r))
                  );
                  return { data: match ? { ...match } : null, error: null };
                },
                then: (
                  resolve: (res: {
                    data: ClientRow[] | null;
                    count?: number;
                    error: null;
                  }) => unknown
                ) => {
                  const matches = Array.from(state.clients.values()).filter((r) =>
                    filters.every((fn) => fn(r))
                  );
                  if (opts?.head) {
                    return Promise.resolve({
                      data: null,
                      count: matches.length,
                      error: null,
                    }).then(resolve);
                  }
                  return Promise.resolve({
                    data: matches,
                    count: matches.length,
                    error: null,
                  }).then(resolve);
                },
              };
              return builder;
            },
            insert: async (payload: Database['public']['Tables']['oauth_clients']['Insert']) => {
              const row: ClientRow = {
                id: payload.id || crypto.randomUUID(),
                client_id: payload.client_id,
                client_name: payload.client_name,
                redirect_uris: payload.redirect_uris,
                grant_types: payload.grant_types || ['authorization_code', 'refresh_token'],
                response_types: payload.response_types || ['code'],
                token_endpoint_auth_method: payload.token_endpoint_auth_method || 'none',
                created_by_ip: payload.created_by_ip ?? null,
                created_at: payload.created_at || new Date().toISOString(),
              };
              state.clients.set(row.client_id, row);
              return { data: row, error: null };
            },
          };
        }

        if (table === 'oauth_authorization_codes') {
          return {
            select: () => ({
              eq: (field: keyof CodeRow, val: string) => ({
                maybeSingle: async () => {
                  const match = Array.from(state.codes.values()).find(
                    (r) => r[field] === val
                  );
                  return { data: match ? { ...match } : null, error: null };
                },
              }),
            }),
            insert: async (
              payload: Database['public']['Tables']['oauth_authorization_codes']['Insert']
            ) => {
              const row: CodeRow = {
                id: payload.id || crypto.randomUUID(),
                code_hash: payload.code_hash,
                client_id: payload.client_id,
                user_id: payload.user_id,
                workspace_id: payload.workspace_id,
                redirect_uri: payload.redirect_uri,
                scopes: payload.scopes,
                code_challenge: payload.code_challenge,
                code_challenge_method: payload.code_challenge_method || 'S256',
                resource: payload.resource,
                consumed_at: payload.consumed_at ?? null,
                grant_id: payload.grant_id ?? null,
                expires_at: payload.expires_at,
                created_at: payload.created_at || new Date().toISOString(),
              };
              state.codes.set(row.id, row);
              return { data: row, error: null };
            },
            update: (
              updates: Database['public']['Tables']['oauth_authorization_codes']['Update']
            ) => ({
              eq: async (field: keyof CodeRow, val: string) => {
                for (const [id, row] of state.codes.entries()) {
                  if (row[field] === val) {
                    state.codes.set(id, { ...row, ...updates });
                  }
                }
                return { error: null };
              },
            }),
          };
        }

        if (table === 'oauth_refresh_tokens') {
          return {
            select: () => {
              const filters: Array<(r: RefreshRow) => boolean> = [];
              const builder = {
                eq: (field: keyof RefreshRow, val: string) => {
                  filters.push((r) => r[field] === val);
                  return builder;
                },
                maybeSingle: async () => {
                  const match = Array.from(state.refreshTokens.values()).find((r) =>
                    filters.every((fn) => fn(r))
                  );
                  return { data: match ? { ...match } : null, error: null };
                },
                then: (
                  resolve: (res: { data: RefreshRow[]; error: null }) => unknown
                ) => {
                  const matches = Array.from(state.refreshTokens.values()).filter((r) =>
                    filters.every((fn) => fn(r))
                  );
                  return Promise.resolve({ data: matches, error: null }).then(resolve);
                },
              };
              return builder;
            },
            insert: async (
              payload: Database['public']['Tables']['oauth_refresh_tokens']['Insert']
            ) => {
              const row: RefreshRow = {
                id: payload.id || crypto.randomUUID(),
                token_hash: payload.token_hash,
                grant_id: payload.grant_id || crypto.randomUUID(),
                access_token_id: payload.access_token_id,
                client_id: payload.client_id,
                user_id: payload.user_id,
                workspace_id: payload.workspace_id,
                scopes: payload.scopes,
                resource: payload.resource,
                consumed_at: payload.consumed_at ?? null,
                replaced_by_hash: payload.replaced_by_hash ?? null,
                is_revoked: payload.is_revoked ?? false,
                revoked_at: payload.revoked_at ?? null,
                expires_at: payload.expires_at,
                created_at: payload.created_at || new Date().toISOString(),
              };
              state.refreshTokens.set(row.id, row);
              return { data: row, error: null };
            },
            update: (
              updates: Database['public']['Tables']['oauth_refresh_tokens']['Update']
            ) => {
              const filters: Array<(r: RefreshRow) => boolean> = [];
              const builder = {
                eq: (field: keyof RefreshRow, val: string) => {
                  filters.push((r) => r[field] === val);
                  return builder;
                },
                then: (resolve: (res: { error: null }) => unknown) => {
                  for (const [id, row] of state.refreshTokens.entries()) {
                    if (filters.every((fn) => fn(row))) {
                      state.refreshTokens.set(id, { ...row, ...updates });
                    }
                  }
                  return Promise.resolve({ error: null }).then(resolve);
                },
              };
              return builder;
            },
          };
        }

        if (table === 'ai_api_tokens') {
          return {
            select: () => {
              const filters: Array<(r: TokenRow) => boolean> = [];
              const builder = {
                eq: (field: keyof TokenRow, val: string) => {
                  filters.push((r) => r[field] === val);
                  return builder;
                },
                maybeSingle: async () => {
                  const match = Array.from(state.tokens.values()).find((r) =>
                    filters.every((fn) => fn(r))
                  );
                  return { data: match ? { ...match } : null, error: null };
                },
              };
              return builder;
            },
            insert: (payload: Database['public']['Tables']['ai_api_tokens']['Insert']) => {
              const row: TokenRow = {
                id: payload.id || crypto.randomUUID(),
                workspace_id: payload.workspace_id,
                client_name: payload.client_name,
                name: payload.name ?? payload.client_name,
                token_hash: payload.token_hash,
                token_prefix: payload.token_prefix,
                scopes: payload.scopes,
                is_revoked: payload.is_revoked ?? false,
                revoked_at: payload.revoked_at ?? null,
                created_by: payload.created_by,
                last_used_at: payload.last_used_at ?? null,
                expires_at: payload.expires_at ?? null,
                resource: payload.resource ?? null,
                oauth_client_id: payload.oauth_client_id ?? null,
                created_at: payload.created_at || new Date().toISOString(),
              };
              state.tokens.set(row.id, row);
              return {
                select: () => ({
                  single: async () => ({ data: { ...row }, error: null }),
                }),
              };
            },
            update: (updates: Database['public']['Tables']['ai_api_tokens']['Update']) => {
              const filters: Array<(r: TokenRow) => boolean> = [];
              const builder = {
                eq: (field: keyof TokenRow, val: string) => {
                  filters.push((r) => r[field] === val);
                  return builder;
                },
                then: (resolve: (res: { error: null }) => unknown) => {
                  for (const [id, row] of state.tokens.entries()) {
                    if (filters.every((fn) => fn(row))) {
                      const updated = { ...row, ...updates };
                      state.tokens.set(id, updated);
                      // Simulate trg_cascade_revoke_oauth_refresh_tokens trigger
                      if (!row.is_revoked && updated.is_revoked) {
                        for (const [rtId, rt] of state.refreshTokens.entries()) {
                          if (rt.access_token_id === id && !rt.is_revoked) {
                            state.refreshTokens.set(rtId, {
                              ...rt,
                              is_revoked: true,
                              revoked_at: updated.revoked_at || new Date().toISOString(),
                            });
                          }
                        }
                      }
                    }
                  }
                  return Promise.resolve({ error: null }).then(resolve);
                },
              };
              return builder;
            },
          };
        }

        if (table === 'workspace_members') {
          return {
            select: () => ({
              eq: (field1: string, val1: string) => ({
                eq: (field2: string, val2: string) => ({
                  maybeSingle: async () => {
                    const ws = field1 === 'workspace_id' ? val1 : val2;
                    const u = field1 === 'user_id' ? val1 : val2;
                    const mem = state.members.get(`${ws}:${u}`);
                    return { data: mem ? { ...mem } : null, error: null };
                  },
                }),
              }),
            }),
          };
        }

        if (table === 'profiles') {
          return {
            select: () => ({
              eq: (_field: string, id: string) => ({
                maybeSingle: async () => {
                  const p = state.profiles.get(id);
                  return { data: p ? { ...p } : null, error: null };
                },
              }),
            }),
          };
        }

        if (table === 'ai_token_rate_limits') {
          return {
            select: () => ({
              eq: (_f: string, tId: string) => ({
                maybeSingle: async () => {
                  const rl = state.rateLimits.get(tId);
                  return { data: rl ? { token_id: tId, ...rl } : null, error: null };
                },
              }),
            }),
            insert: async (payload: {
              token_id: string;
              window_start: string;
              request_count: number;
            }) => {
              state.rateLimits.set(payload.token_id, {
                window_start: payload.window_start,
                request_count: payload.request_count,
              });
              return { error: null };
            },
            update: (updates: { window_start?: string; request_count?: number }) => ({
              eq: async (_f: string, tId: string) => {
                const current = state.rateLimits.get(tId) || {
                  window_start: new Date().toISOString(),
                  request_count: 0,
                };
                state.rateLimits.set(tId, { ...current, ...updates });
                return { error: null };
              },
            }),
          };
        }

        if (table === 'audit_events') {
          return {
            insert: async (payload: Record<string, unknown>) => {
              state.auditEvents.push(payload);
              return { error: null };
            },
          };
        }

        throw new Error(`Unexpected table in test mock: ${table}`);
      },
      rpc: async (fnName: string, args: Record<string, unknown>) => {
        if (!state.useRpc) {
          return {
            data: null,
            error: { code: 'PGRST202', message: `Could not find the function ${fnName}` },
          };
        }

        if (fnName === 'check_and_increment_ai_token_rate_limit') {
          return {
            data: null,
            error: { code: 'PGRST202', message: 'Fallback to table rate limit in test' },
          };
        }

        if (fnName === 'exchange_oauth_authorization_code') {
          const codeHash = String(args.p_code_hash);
          const codeRow = Array.from(state.codes.values()).find(
            (r) => r.code_hash === codeHash
          );
          if (!codeRow) {
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_grant',
                  error_reason: 'code_not_found',
                },
              ],
              error: null,
            };
          }
          if (codeRow.consumed_at) {
            if (codeRow.grant_id) {
              const nowIso = String(args.p_now || new Date().toISOString());
              for (const [rtId, rt] of state.refreshTokens.entries()) {
                if (rt.grant_id === codeRow.grant_id) {
                  state.refreshTokens.set(rtId, { ...rt, is_revoked: true, revoked_at: nowIso });
                  const tok = state.tokens.get(rt.access_token_id);
                  if (tok) {
                    state.tokens.set(tok.id, { ...tok, is_revoked: true, revoked_at: nowIso });
                  }
                }
              }
            }
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_grant',
                  error_reason: 'code_reused',
                  workspace_id: codeRow.workspace_id,
                  user_id: codeRow.user_id,
                },
              ],
              error: null,
            };
          }
          const pNowIso = String(args.p_now || new Date().toISOString());
          if (new Date(codeRow.expires_at).getTime() <= new Date(pNowIso).getTime()) {
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_grant',
                  error_reason: 'code_expired',
                  workspace_id: codeRow.workspace_id,
                  user_id: codeRow.user_id,
                },
              ],
              error: null,
            };
          }
          if (codeRow.client_id !== String(args.p_client_id)) {
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_grant',
                  error_reason: 'client_mismatch',
                  workspace_id: codeRow.workspace_id,
                  user_id: codeRow.user_id,
                },
              ],
              error: null,
            };
          }
          if (codeRow.redirect_uri !== String(args.p_redirect_uri)) {
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_grant',
                  error_reason: 'redirect_uri_mismatch',
                  workspace_id: codeRow.workspace_id,
                  user_id: codeRow.user_id,
                },
              ],
              error: null,
            };
          }
          if (
            codeRow.code_challenge_method !== 'S256' ||
            codeRow.code_challenge !== String(args.p_computed_code_challenge)
          ) {
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_grant',
                  error_reason: 'pkce_verification_failed',
                  workspace_id: codeRow.workspace_id,
                  user_id: codeRow.user_id,
                },
              ],
              error: null,
            };
          }
          if (codeRow.resource !== String(args.p_expected_resource)) {
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_target',
                  error_reason: 'resource_mismatch',
                  workspace_id: codeRow.workspace_id,
                  user_id: codeRow.user_id,
                },
              ],
              error: null,
            };
          }
          const pReqScopes = args.p_requested_scopes as string[] | undefined;
          let effectiveScopes = codeRow.scopes;
          if (pReqScopes && Array.isArray(pReqScopes) && pReqScopes.length > 0) {
            const consentedSet = new Set(codeRow.scopes);
            if (!pReqScopes.every((s) => consentedSet.has(s))) {
              return {
                data: [
                  {
                    allowed: false,
                    error_code: 'invalid_scope',
                    error_reason: 'scope_escalation',
                    workspace_id: codeRow.workspace_id,
                    user_id: codeRow.user_id,
                  },
                ],
                error: null,
              };
            }
            effectiveScopes = pReqScopes as ToolScope[];
          }
          const member = state.members.get(`${codeRow.workspace_id}:${codeRow.user_id}`);
          if (!member) {
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_grant',
                  error_reason: 'membership_revoked',
                  workspace_id: codeRow.workspace_id,
                  user_id: codeRow.user_id,
                },
              ],
              error: null,
            };
          }
          if (member.role === 'viewer') {
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_grant',
                  error_reason: 'viewer_role_forbidden',
                  workspace_id: codeRow.workspace_id,
                  user_id: codeRow.user_id,
                },
              ],
              error: null,
            };
          }
          const grantId = crypto.randomUUID();
          codeRow.consumed_at = pNowIso;
          codeRow.grant_id = grantId;
          const tokenId = crypto.randomUUID();
          const rtId = crypto.randomUUID();
          state.tokens.set(tokenId, {
            id: tokenId,
            workspace_id: codeRow.workspace_id,
            client_name: String(args.p_token_name),
            name: String(args.p_token_name),
            token_hash: String(args.p_new_access_token_hash),
            token_prefix: String(args.p_new_access_token_prefix),
            scopes: effectiveScopes,
            is_revoked: false,
            revoked_at: null,
            created_by: codeRow.user_id,
            last_used_at: null,
            expires_at: String(args.p_access_expires_at),
            resource: codeRow.resource,
            oauth_client_id: codeRow.client_id,
            created_at: pNowIso,
          });
          state.refreshTokens.set(rtId, {
            id: rtId,
            token_hash: String(args.p_new_refresh_token_hash),
            grant_id: grantId,
            access_token_id: tokenId,
            client_id: codeRow.client_id,
            user_id: codeRow.user_id,
            workspace_id: codeRow.workspace_id,
            scopes: effectiveScopes,
            resource: codeRow.resource,
            consumed_at: null,
            replaced_by_hash: null,
            is_revoked: false,
            revoked_at: null,
            expires_at: String(args.p_refresh_expires_at),
            created_at: pNowIso,
          });
          return {
            data: [
              {
                allowed: true,
                error_code: null,
                error_reason: null,
                access_token_id: tokenId,
                workspace_id: codeRow.workspace_id,
                user_id: codeRow.user_id,
                granted_scopes: effectiveScopes,
                resource: codeRow.resource,
              },
            ],
            error: null,
          };
        }

        if (fnName === 'rotate_oauth_refresh_token') {
          const oldHash = String(args.p_old_refresh_token_hash);
          const rtRow = Array.from(state.refreshTokens.values()).find(
            (r) => r.token_hash === oldHash
          );
          if (!rtRow || rtRow.client_id !== String(args.p_client_id)) {
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_grant',
                  error_reason: !rtRow ? 'refresh_token_not_found' : 'client_mismatch',
                },
              ],
              error: null,
            };
          }
          const nowIso = String(args.p_now || new Date().toISOString());
          if (rtRow.consumed_at) {
            for (const [id, rt] of state.refreshTokens.entries()) {
              if (rt.grant_id === rtRow.grant_id) {
                state.refreshTokens.set(id, {
                  ...rt,
                  is_revoked: true,
                  revoked_at: nowIso,
                });
                const tok = state.tokens.get(rt.access_token_id);
                if (tok) {
                  state.tokens.set(tok.id, {
                    ...tok,
                    is_revoked: true,
                    revoked_at: nowIso,
                  });
                }
              }
            }
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_grant',
                  error_reason: 'refresh_token_replayed_grant_revoked',
                  workspace_id: rtRow.workspace_id,
                  user_id: rtRow.user_id,
                },
              ],
              error: null,
            };
          }
          if (rtRow.is_revoked) {
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_grant',
                  error_reason: 'refresh_token_revoked',
                  workspace_id: rtRow.workspace_id,
                  user_id: rtRow.user_id,
                },
              ],
              error: null,
            };
          }
          if (new Date(rtRow.expires_at).getTime() <= new Date(nowIso).getTime()) {
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_grant',
                  error_reason: 'refresh_token_expired',
                  workspace_id: rtRow.workspace_id,
                  user_id: rtRow.user_id,
                },
              ],
              error: null,
            };
          }
          const linkedTok = state.tokens.get(rtRow.access_token_id);
          if (!linkedTok || linkedTok.is_revoked) {
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_grant',
                  error_reason: 'linked_access_token_revoked',
                  workspace_id: rtRow.workspace_id,
                  user_id: rtRow.user_id,
                },
              ],
              error: null,
            };
          }
          if (rtRow.resource !== String(args.p_expected_resource)) {
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_target',
                  error_reason: 'resource_mismatch',
                  workspace_id: rtRow.workspace_id,
                  user_id: rtRow.user_id,
                },
              ],
              error: null,
            };
          }
          const pReqScopes = args.p_requested_scopes as string[] | undefined;
          let effectiveScopes = rtRow.scopes;
          if (pReqScopes && Array.isArray(pReqScopes) && pReqScopes.length > 0) {
            const grantedSet = new Set(rtRow.scopes);
            if (!pReqScopes.every((s) => grantedSet.has(s))) {
              return {
                data: [
                  {
                    allowed: false,
                    error_code: 'invalid_scope',
                    error_reason: 'scope_escalation',
                    workspace_id: rtRow.workspace_id,
                    user_id: rtRow.user_id,
                  },
                ],
                error: null,
              };
            }
            effectiveScopes = pReqScopes as ToolScope[];
          }
          const member = state.members.get(`${rtRow.workspace_id}:${rtRow.user_id}`);
          if (!member) {
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_grant',
                  error_reason: 'membership_revoked',
                  workspace_id: rtRow.workspace_id,
                  user_id: rtRow.user_id,
                },
              ],
              error: null,
            };
          }
          if (member.role === 'viewer') {
            return {
              data: [
                {
                  allowed: false,
                  error_code: 'invalid_grant',
                  error_reason: 'viewer_role_forbidden',
                  workspace_id: rtRow.workspace_id,
                  user_id: rtRow.user_id,
                },
              ],
              error: null,
            };
          }
          rtRow.consumed_at = nowIso;
          rtRow.replaced_by_hash = String(args.p_new_refresh_token_hash);
          if (linkedTok) {
            state.tokens.set(linkedTok.id, {
              ...linkedTok,
              is_revoked: true,
              revoked_at: nowIso,
            });
          }
          const newTokenId = crypto.randomUUID();
          const newRtId = crypto.randomUUID();
          state.tokens.set(newTokenId, {
            id: newTokenId,
            workspace_id: rtRow.workspace_id,
            client_name: String(args.p_token_name),
            name: String(args.p_token_name),
            token_hash: String(args.p_new_access_token_hash),
            token_prefix: String(args.p_new_access_token_prefix),
            scopes: effectiveScopes,
            is_revoked: false,
            revoked_at: null,
            created_by: rtRow.user_id,
            last_used_at: null,
            expires_at: String(args.p_access_expires_at),
            resource: rtRow.resource,
            oauth_client_id: rtRow.client_id,
            created_at: nowIso,
          });
          state.refreshTokens.set(newRtId, {
            id: newRtId,
            token_hash: String(args.p_new_refresh_token_hash),
            grant_id: rtRow.grant_id,
            access_token_id: newTokenId,
            client_id: rtRow.client_id,
            user_id: rtRow.user_id,
            workspace_id: rtRow.workspace_id,
            scopes: effectiveScopes,
            resource: rtRow.resource,
            consumed_at: null,
            replaced_by_hash: null,
            is_revoked: false,
            revoked_at: null,
            expires_at: String(args.p_refresh_expires_at),
            created_at: nowIso,
          });
          return {
            data: [
              {
                allowed: true,
                error_code: null,
                error_reason: null,
                access_token_id: newTokenId,
                workspace_id: rtRow.workspace_id,
                user_id: rtRow.user_id,
                granted_scopes: effectiveScopes,
                resource: rtRow.resource,
              },
            ],
            error: null,
          };
        }

        return { data: null, error: { code: 'PGRST202', message: `Unknown RPC ${fnName}` } };
      },
    };

    return clientObj as unknown as SupabaseClient<Database>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db = {
      tokens: new Map(),
      clients: new Map(),
      codes: new Map(),
      refreshTokens: new Map(),
      members: new Map([
        [`${workspaceA}:${userId}`, { role: 'owner' }],
        [`${workspaceA}:${adminUserId}`, { role: 'admin' }],
        [`${workspaceA}:${memberUserId}`, { role: 'member' }],
        [`${workspaceA}:${viewerUserId}`, { role: 'viewer' }],
      ]),
      profiles: new Map([
        [userId, { timezone: 'UTC' }],
        [adminUserId, { timezone: 'UTC' }],
        [memberUserId, { timezone: 'UTC' }],
        [viewerUserId, { timezone: 'UTC' }],
      ]),
      rateLimits: new Map(),
      auditEvents: [],
      useRpc: true,
    };
    adminClient = buildInMemoryAdminClient(db);
    mockGetUser.mockResolvedValue({
      data: { user: { id: userId, email: 'creator@miler.app' } },
      error: null,
    });
  });

  // ===========================================================================
  // 1. PROTECTED RESOURCE METADATA & AUTHORIZATION SERVER METADATA
  // ===========================================================================
  describe('1. OAuth Discovery Metadata & WWW-Authenticate Challenge', () => {
    it('serves RFC 9728 Protected Resource Metadata at both /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp', async () => {
      const resRoot = await getProtectedResourceRoot();
      const resMcp = await getProtectedResourceMcp();

      expect(resRoot.status).toBe(200);
      expect(resMcp.status).toBe(200);

      const docRoot = await resRoot.json();
      const docMcp = await resMcp.json();

      expect(docRoot).toEqual(docMcp);
      expect(docRoot.resource).toBe(CANONICAL_MCP_RESOURCE);
      expect(docRoot.authorization_servers).toEqual([CANONICAL_PRODUCTION_ORIGIN]);
      expect(docRoot.scopes_supported).toEqual([
        'task:read',
        'task:write',
        'content:read',
        'content:write',
      ]);
      expect(docRoot.bearer_methods_supported).toEqual(['header']);
    });

    it('serves RFC 8414 Authorization Server Metadata advertising public client auth ("none") and PKCE S256 only', async () => {
      const res = await getAuthServerMetadata();
      expect(res.status).toBe(200);

      const meta = await res.json();
      expect(meta.issuer).toBe(CANONICAL_PRODUCTION_ORIGIN);
      expect(meta.authorization_endpoint).toBe(
        `${CANONICAL_PRODUCTION_ORIGIN}/oauth/authorize`
      );
      expect(meta.token_endpoint).toBe(`${CANONICAL_PRODUCTION_ORIGIN}/api/oauth/token`);
      expect(meta.registration_endpoint).toBe(
        `${CANONICAL_PRODUCTION_ORIGIN}/api/oauth/register`
      );
      expect(meta.revocation_endpoint).toBe(
        `${CANONICAL_PRODUCTION_ORIGIN}/api/oauth/revoke`
      );
      expect(meta.token_endpoint_auth_methods_supported).toEqual(['none']);
      expect(meta.code_challenge_methods_supported).toEqual(['S256']);
      expect(meta.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
      expect(meta.response_types_supported).toEqual(['code']);
    });

    it('returns HTTP 401 with WWW-Authenticate resource_metadata header on unauthenticated POST /api/mcp while keeping GET /api/mcp at 405', async () => {
      const getRes = await getMcpRoute();
      expect(getRes.status).toBe(405);

      const postReq = new Request('http://localhost:3000/api/mcp', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }),
      });

      const postRes = await handleMcpRequest(postReq, { adminClient });
      expect(postRes.status).toBe(401);

      const wwwAuth = postRes.headers.get('www-authenticate') || '';
      expect(wwwAuth).toContain('Bearer');
      expect(wwwAuth).toContain(
        `resource_metadata="${CANONICAL_PRODUCTION_ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`
      );
    });
  });

  // ===========================================================================
  // 2. DYNAMIC CLIENT REGISTRATION & CLAUDE CALLBACK ALLOWLISTING
  // ===========================================================================
  describe('2. Dynamic Client Registration & Redirect URI Security', () => {
    it('registers a public client with both official Claude callback URIs and never issues a client_secret', async () => {
      const req = new Request('http://localhost:3000/api/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Claude Web Connector',
          redirect_uris: [
            'https://claude.ai/api/mcp/auth_callback',
            'https://claude.com/api/mcp/auth_callback',
          ],
        }),
      });

      const res = await handleOAuthRegisterRequest(req, { adminClient });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.client_id).toMatch(/^ctc_client_[0-9a-f]{32}$/);
      expect(body.client_name).toBe('Claude Web Connector');
      expect(body.redirect_uris).toEqual([
        'https://claude.ai/api/mcp/auth_callback',
        'https://claude.com/api/mcp/auth_callback',
      ]);
      expect(body.token_endpoint_auth_method).toBe('none');
      expect(body.client_secret).toBeUndefined();
    });

    it('rejects arbitrary, HTTP, fragment, query, path-traversal, and credentialed redirect URIs', async () => {
      const maliciousUris = [
        'https://evil.example.com/api/mcp/auth_callback',
        'https://claude.ai.evil.com/api/mcp/auth_callback',
        'http://claude.ai/api/mcp/auth_callback',
        'https://claude.ai/api/mcp/auth_callback#fragment',
        'https://claude.ai/api/mcp/auth_callback? leak=1',
        'https://claude.ai/api/mcp/auth_callback?next=https://evil.com',
        'https://claude.ai/api/mcp/auth_callback/../../evil',
        'https://user:pass@claude.ai/api/mcp/auth_callback',
        'https://claude.ai\\@evil.com/api/mcp/auth_callback',
        'javascript:alert(1)',
      ];

      for (const badUri of maliciousUris) {
        expect(validateRedirectUri(badUri).valid).toBe(false);

        const req = new Request('http://localhost:3000/api/oauth/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            client_name: 'Attacker Client',
            redirect_uris: [badUri],
          }),
        });

        const res = await handleOAuthRegisterRequest(req, { adminClient });
        expect(res.status).toBe(400);
        const err = await res.json();
        expect(err.error).toBe('invalid_redirect_uri');
      }
    });

    it('rejects non-public client auth methods, oversized payloads, and registration floods', async () => {
      // 1. Reject client_secret_post
      const secretMethodRes = await handleOAuthRegisterRequest(
        new Request('http://localhost:3000/api/oauth/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
            token_endpoint_auth_method: 'client_secret_post',
          }),
        }),
        { adminClient }
      );
      expect(secretMethodRes.status).toBe(400);
      expect((await secretMethodRes.json()).error).toBe('invalid_client_metadata');

      // 2. Reject oversized payload (> 16 KiB)
      const largeRes = await handleOAuthRegisterRequest(
        new Request('http://localhost:3000/api/oauth/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            client_name: 'A'.repeat(20_000),
            redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
          }),
        }),
        { adminClient }
      );
      expect(largeRes.status).toBe(413);

      // 3. Enforce per-IP rate limit (20 registrations/minute)
      const refTime = new Date('2026-10-31T12:00:00.000Z');
      for (let i = 0; i < 20; i++) {
        await registerOAuthClient(
          { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] },
          { adminClient, ipAddress: '203.0.113.10', referenceTime: refTime }
        );
      }

      const floodRes = await handleOAuthRegisterRequest(
        new Request('http://localhost:3000/api/oauth/register', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': '203.0.113.10',
          },
          body: JSON.stringify({
            redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
          }),
        }),
        { adminClient, referenceTime: refTime }
      );
      expect(floodRes.status).toBe(429);
    });
  });

  // ===========================================================================
  // 3. LEAST-PRIVILEGE DEFAULT SCOPES, CONSENT, PKCE S256 & STATE VALIDATION
  // ===========================================================================
  describe('3. Authorization Endpoint Validation, Least-Privilege Scopes & PKCE S256', () => {
    let clientId: string;

    beforeEach(async () => {
      const client = await registerOAuthClient(
        {
          client_name: 'Claude',
          redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        },
        { adminClient }
      );
      clientId = client.client_id;
    });

    it('defaults to read-only scopes (task:read, content:read) when scope is omitted by Claude', async () => {
      const parsed = parseAndValidateOAuthScopes(undefined);
      expect(parsed.valid).toBe(true);
      if (parsed.valid) {
        expect(parsed.wasOmitted).toBe(true);
        expect(parsed.scopes).toEqual([...DEFAULT_READ_ONLY_SCOPES]);
        expect(parsed.scopes).not.toContain('task:write');
        expect(parsed.scopes).not.toContain('content:write');
      }

      const authCheck = await validateOAuthAuthorizeParams(
        {
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-xyz-123',
        },
        { adminClient }
      );

      expect(authCheck.valid).toBe(true);
      if (authCheck.valid) {
        expect(authCheck.data.initialScopes).toEqual(['task:read', 'content:read']);
        expect(authCheck.data.wasScopeOmitted).toBe(true);
        expect(authCheck.data.resource).toBe(CANONICAL_MCP_RESOURCE);
      }
    });

    it('rejects missing state, plain PKCE, invalid code_challenge, and unrecognized scopes', async () => {
      // Missing state
      const noState = await validateOAuthAuthorizeParams(
        {
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: '',
        },
        { adminClient }
      );
      expect(noState.valid).toBe(false);

      // Plain PKCE rejected
      const plainPkce = await validateOAuthAuthorizeParams(
        {
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'plain',
          state: 'state-1',
        },
        { adminClient }
      );
      expect(plainPkce.valid).toBe(false);

      // Unrecognized scope rejected
      const badScope = await validateOAuthAuthorizeParams(
        {
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-1',
          scope: 'task:read admin:superuser',
        },
        { adminClient }
      );
      expect(badScope.valid).toBe(false);
      if (!badScope.valid) {
        expect(badScope.errorCode).toBe('invalid_scope');
      }
    });

    it('verifies PKCE S256 challenges accurately and rejects wrong verifiers', () => {
      expect(verifyPkceS256(validVerifier, validChallenge)).toBe(true);
      expect(
        verifyPkceS256(
          'wrong_verifier_0123456789abcdef0123456789abcdef0123456789abcdef',
          validChallenge
        )
      ).toBe(false);
      expect(verifyPkceS256('too_short', validChallenge)).toBe(false);
    });

    it('supports explicit user denial and explicit scope consent via submitOAuthDecisionAction', async () => {
      // 1. User clicks Deny
      const denyRes = await submitOAuthDecisionAction(
        {
          decision: 'deny',
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'claude-state-999',
        },
        { adminClient }
      );

      expect(denyRes.success).toBe(true);
      const denyUrl = new URL(denyRes.redirectUrl!);
      expect(denyUrl.origin + denyUrl.pathname).toBe(
        'https://claude.ai/api/mcp/auth_callback'
      );
      expect(denyUrl.searchParams.get('error')).toBe('access_denied');
      expect(denyUrl.searchParams.get('state')).toBe('claude-state-999');

      // 2. User approves only ['task:read', 'task:write']
      const approveRes = await submitOAuthDecisionAction(
        {
          decision: 'approve',
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'claude-state-999',
          workspaceId: workspaceA,
          approvedScopes: ['task:read', 'task:write'],
        },
        { adminClient }
      );

      expect(approveRes.success).toBe(true);
      const approveUrl = new URL(approveRes.redirectUrl!);
      const code = approveUrl.searchParams.get('code');
      expect(code).toMatch(/^ctc_code_[0-9a-f]{64}$/);
      expect(approveUrl.searchParams.get('state')).toBe('claude-state-999');
    });
  });

  // ===========================================================================
  // 4. CODE EXPIRATION, SINGLE-USE REUSE DETECTION, & SCOPE ESCALATION
  // ===========================================================================
  describe('4. Authorization Code Expiration, Single-Use Enforcement & Scope Escalation', () => {
    let clientId: string;

    beforeEach(async () => {
      const client = await registerOAuthClient(
        { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] },
        { adminClient }
      );
      clientId = client.client_id;
    });

    it('rejects expired authorization codes', async () => {
      const t0 = new Date('2026-10-31T10:00:00.000Z');
      const issued = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-exp',
        },
        { adminClient, referenceTime: t0 }
      );

      // Advance 6 minutes (past 5-minute TTL)
      const tExpired = new Date(t0.getTime() + 6 * 60 * 1000);
      await expect(
        exchangeAuthorizationCode(
          {
            code: issued.code,
            clientId,
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            codeVerifier: validVerifier,
          },
          { adminClient, referenceTime: tExpired }
        )
      ).rejects.toThrow(/expired/i);
    });

    it('enforces single-use authorization codes and revokes issued tokens on code replay', async () => {
      const issued = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read', 'content:read'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-single',
        },
        { adminClient }
      );

      const firstExchange = await exchangeAuthorizationCode(
        {
          code: issued.code,
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeVerifier: validVerifier,
        },
        { adminClient }
      );

      expect(firstExchange.access_token).toMatch(/^ctc_live_[0-9a-f]{64}$/);

      // Replaying the same authorization code must fail with invalid_grant
      await expect(
        exchangeAuthorizationCode(
          {
            code: issued.code,
            clientId,
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            codeVerifier: validVerifier,
          },
          { adminClient }
        )
      ).rejects.toThrow(/already been used/i);

      // And the previously issued access token must now be revoked as a precaution
      const authResult = await authenticateAiToken(firstExchange.access_token, {
        adminClient,
      });
      expect(authResult.success).toBe(false);
      if (!authResult.success) {
        expect(authResult.status).toBe(401);
      }
    });

    it('blocks scope escalation attempts during authorization code exchange', async () => {
      // User only consented to read-only scopes ['task:read', 'content:read']
      const issued = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read', 'content:read'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-scope',
        },
        { adminClient }
      );

      // Client tries to escalate to task:write during token exchange
      const tokenReq = new Request('http://localhost:3000/api/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: issued.code,
          client_id: clientId,
          redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
          code_verifier: validVerifier,
          scope: 'task:read task:write',
        }).toString(),
      });

      const res = await handleOAuthTokenRequest(tokenReq, { adminClient });
      expect(res.status).toBe(400);
      const err = await res.json();
      expect(err.error).toBe('invalid_scope');
    });

    it('rejects cross-client authorization code exchange attempts and issues no tokens to Client B', async () => {
      // 1. Register Client B (clientId from beforeEach is Client A)
      const clientB = await registerOAuthClient(
        {
          client_name: 'Client B',
          redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        },
        { adminClient }
      );

      // 2. Issue authorization code specifically for Client A
      const issuedForA = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-cross-code',
        },
        { adminClient }
      );

      const tokenCountBefore = db.tokens.size;
      const refreshCountBefore = db.refreshTokens.size;

      // 3. Client B attempts to exchange Client A's authorization code via POST /api/oauth/token
      const crossReq = new Request('http://localhost:3000/api/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: issuedForA.code,
          client_id: clientB.client_id,
          redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
          code_verifier: validVerifier,
        }).toString(),
      });

      const res = await handleOAuthTokenRequest(crossReq, { adminClient });
      expect(res.status).toBe(400);
      const err = await res.json();
      expect(err.error).toBe('invalid_grant');

      // Verify no tokens were issued to Client B
      expect(db.tokens.size).toBe(tokenCountBefore);
      expect(db.refreshTokens.size).toBe(refreshCountBefore);

      // 4. Client A then successfully exchanges the same still-valid code
      const clientAExchange = await exchangeAuthorizationCode(
        {
          code: issuedForA.code,
          clientId, // Client A
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeVerifier: validVerifier,
        },
        { adminClient }
      );
      expect(clientAExchange.access_token).toMatch(/^ctc_live_[0-9a-f]{64}$/);
      expect(clientAExchange.refresh_token).toMatch(/^ctc_rt_[0-9a-f]{64}$/);

      // 5. Subsequent reuse of the now-consumed code is strictly rejected
      await expect(
        exchangeAuthorizationCode(
          {
            code: issuedForA.code,
            clientId, // Client A
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            codeVerifier: validVerifier,
          },
          { adminClient }
        )
      ).rejects.toThrow(/already been used/i);

      // Direct exchange on a fresh code with wrong client also fails with client_id mismatch
      const issuedForA2 = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-cross-code-2',
        },
        { adminClient }
      );

      await expect(
        exchangeAuthorizationCode(
          {
            code: issuedForA2.code,
            clientId: clientB.client_id,
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            codeVerifier: validVerifier,
          },
          { adminClient }
        )
      ).rejects.toThrow(/client_id mismatch/i);
    });

    it('scopes authorization-code replay revocation strictly to its own grant family, leaving concurrent grants and manual tokens intact', async () => {
      // 1. Authorize Client A and exchange Code A -> Grant A
      const issuedA = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-grant-a',
        },
        { adminClient }
      );

      const grantA = await exchangeAuthorizationCode(
        {
          code: issuedA.code,
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeVerifier: validVerifier,
        },
        { adminClient }
      );

      // 2. Authorize Client A again and exchange Code B -> Grant B
      const issuedB = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read', 'task:write'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-grant-b',
        },
        { adminClient }
      );

      const grantB = await exchangeAuthorizationCode(
        {
          code: issuedB.code,
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeVerifier: validVerifier,
        },
        { adminClient }
      );

      // 3. Create a manual API token for the same user and workspace
      const manualToken = await createAiToken(adminClient, {
        workspaceId: workspaceA,
        userId,
        name: 'Manual Workspace Token',
        scopes: ['task:read', 'task:write'],
      });

      // Confirm all three credentials are active
      const authA0 = await authenticateAiToken(grantA.access_token, { adminClient });
      expect(authA0.success).toBe(true);

      const authB0 = await authenticateAiToken(grantB.access_token, { adminClient });
      expect(authB0.success).toBe(true);

      const authManual0 = await authenticateAiToken(manualToken.token, { adminClient });
      expect(authManual0.success).toBe(true);

      // 4 & 5. Replay Code A -> Replay is rejected
      await expect(
        exchangeAuthorizationCode(
          {
            code: issuedA.code,
            clientId,
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            codeVerifier: validVerifier,
          },
          { adminClient }
        )
      ).rejects.toThrow(/already been used/i);

      // 6. Confirm Grant A's access and refresh tokens are revoked
      const authAAfter = await authenticateAiToken(grantA.access_token, { adminClient });
      expect(authAAfter.success).toBe(false);

      await expect(
        rotateOAuthRefreshToken(
          { refreshToken: grantA.refresh_token, clientId },
          { adminClient }
        )
      ).rejects.toThrow(/revoked/i);

      // 7. Confirm Grant B's access and refresh tokens remain completely active
      const authBAfter = await authenticateAiToken(grantB.access_token, { adminClient });
      expect(authBAfter.success).toBe(true);

      const rotatedB = await rotateOAuthRefreshToken(
        { refreshToken: grantB.refresh_token, clientId },
        { adminClient }
      );
      expect(rotatedB.access_token).toBeDefined();

      const authBRotated = await authenticateAiToken(rotatedB.access_token, { adminClient });
      expect(authBRotated.success).toBe(true);

      // 8. Confirm manual API token remains active
      const authManualAfter = await authenticateAiToken(manualToken.token, { adminClient });
      expect(authManualAfter.success).toBe(true);
    });

    it('safely handles replay of a consumed code with null grant_id without broad revocation', async () => {
      // Create an active Grant B
      const issuedB = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-active-b',
        },
        { adminClient }
      );
      const grantB = await exchangeAuthorizationCode(
        {
          code: issuedB.code,
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeVerifier: validVerifier,
        },
        { adminClient }
      );

      // Simulate a code row consumed before token minting (grant_id is null)
      const orphanCode = 'ctc_code_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const orphanHash = crypto.createHash('sha256').update(orphanCode).digest('hex');
      db.codes.set(orphanHash, {
        id: crypto.randomUUID(),
        code_hash: orphanHash,
        client_id: clientId,
        user_id: userId,
        workspace_id: workspaceA,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        scopes: ['task:read'],
        code_challenge: validChallenge,
        code_challenge_method: 'S256',
        resource: 'https://miler-creater.vercel.app/api/mcp',
        consumed_at: new Date().toISOString(),
        grant_id: null,
        expires_at: new Date(Date.now() + 60000).toISOString(),
        created_at: new Date().toISOString(),
      });

      // Replaying the orphan code is rejected
      await expect(
        exchangeAuthorizationCode(
          {
            code: orphanCode,
            clientId,
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            codeVerifier: validVerifier,
          },
          { adminClient }
        )
      ).rejects.toThrow(/already been used/i);

      // Active Grant B is NOT revoked
      const authBCheck = await authenticateAiToken(grantB.access_token, { adminClient });
      expect(authBCheck.success).toBe(true);
    });

    it('scopes authorization-code replay revocation strictly to its own grant family when atomic PostgreSQL RPC is used', async () => {
      db.useRpc = true;

      // 1. Authorize Client A and exchange Code A -> Grant A
      const issuedA = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-rpc-grant-a',
          resource: CANONICAL_MCP_RESOURCE,
        },
        { adminClient }
      );

      const grantA = await exchangeAuthorizationCode(
        {
          code: issuedA.code,
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeVerifier: validVerifier,
          resource: CANONICAL_MCP_RESOURCE,
        },
        { adminClient }
      );

      // 2. Authorize Client A again and exchange Code B -> Grant B
      const issuedB = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read', 'task:write'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-rpc-grant-b',
          resource: CANONICAL_MCP_RESOURCE,
        },
        { adminClient }
      );

      const grantB = await exchangeAuthorizationCode(
        {
          code: issuedB.code,
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeVerifier: validVerifier,
          resource: CANONICAL_MCP_RESOURCE,
        },
        { adminClient }
      );

      // 3. Create a manual API token for the same user and workspace
      const manualToken = await createAiToken(adminClient, {
        workspaceId: workspaceA,
        userId,
        name: 'Manual RPC Token',
        scopes: ['task:read', 'task:write'],
      });

      // 4. Replay Code A via RPC
      await expect(
        exchangeAuthorizationCode(
          {
            code: issuedA.code,
            clientId,
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            codeVerifier: validVerifier,
            resource: CANONICAL_MCP_RESOURCE,
          },
          { adminClient }
        )
      ).rejects.toThrow(/code_reused|already been used/i);

      // 5. Grant A is revoked
      const authAAfter = await authenticateAiToken(grantA.access_token, { adminClient });
      expect(authAAfter.success).toBe(false);

      // 6. Grant B remains active
      const authBAfter = await authenticateAiToken(grantB.access_token, { adminClient });
      expect(authBAfter.success).toBe(true);

      const rotatedB = await rotateOAuthRefreshToken(
        { refreshToken: grantB.refresh_token, clientId, resource: CANONICAL_MCP_RESOURCE },
        { adminClient }
      );
      expect(rotatedB.access_token).toBeDefined();

      // 7. Manual API token remains active
      const authManualAfter = await authenticateAiToken(manualToken.token, { adminClient });
      expect(authManualAfter.success).toBe(true);
    });

    it('fails closed when exchange_oauth_authorization_code RPC is unavailable (e.g. PGRST202) without performing fallback mutations', async () => {
      const issued = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-missing-rpc',
        },
        { adminClient }
      );

      // Disable RPC to simulate PGRST202 / missing schema cache
      db.useRpc = false;
      const tokensBefore = db.tokens.size;
      const refreshBefore = db.refreshTokens.size;

      await expect(
        exchangeAuthorizationCode(
          {
            code: issued.code,
            clientId,
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            codeVerifier: validVerifier,
          },
          { adminClient }
        )
      ).rejects.toMatchObject({
        code: OAuthErrorCode.ServerError,
        message: expect.stringMatching(/database error during authorization code exchange/i),
      });

      // Verify fail-closed invariant: NO fallback mutations occurred
      expect(db.tokens.size).toBe(tokensBefore);
      expect(db.refreshTokens.size).toBe(refreshBefore);
      const codeHash = crypto.createHash('sha256').update(issued.code).digest('hex');
      const codeRow = db.codes.get(codeHash);
      expect(codeRow?.consumed_at).toBeFalsy();
      expect(codeRow?.grant_id).toBeFalsy();
    });
  });

  // ===========================================================================
  // 5. RFC 8707 RESOURCE INDICATOR VALIDATION & ACCESS TOKEN BINDING
  // ===========================================================================
  describe('5. RFC 8707 Resource Indicator Validation & Binding', () => {
    let clientId: string;

    beforeEach(async () => {
      const client = await registerOAuthClient(
        { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] },
        { adminClient }
      );
      clientId = client.client_id;
    });

    it('rejects authorization and token requests for a non-canonical resource or resource with fragment', async () => {
      expect(
        normalizeResourceIndicator('https://miler-creater.vercel.app/api/mcp#frag')
      ).toBeNull();

      // 1. Wrong resource at /oauth/authorize
      const badAuthResource = await validateOAuthAuthorizeParams(
        {
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-res',
          resource: 'https://evil-resource.example.com/api/mcp',
        },
        { adminClient }
      );
      expect(badAuthResource.valid).toBe(false);
      if (!badAuthResource.valid) {
        expect(badAuthResource.errorCode).toBe('invalid_target');
      }

      // 2. Valid authorize, then wrong resource at /api/oauth/token
      const issued = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-res-2',
          resource: CANONICAL_MCP_RESOURCE,
        },
        { adminClient }
      );

      const badTokenRes = await handleOAuthTokenRequest(
        new Request('http://localhost:3000/api/oauth/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: issued.code,
            client_id: clientId,
            redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
            code_verifier: validVerifier,
            resource: 'https://other-service.example.com/api/mcp',
          }).toString(),
        }),
        { adminClient }
      );

      expect(badTokenRes.status).toBe(400);
      expect((await badTokenRes.json()).error).toBe('invalid_target');
    });

    it('enforces resource binding during authenticateAiToken while preserving manual ctc_live_ tokens', async () => {
      // 1. OAuth-issued token is bound to https://miler-creater.vercel.app/api/mcp
      const issued = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-bind',
        },
        { adminClient }
      );

      const tokens = await exchangeAuthorizationCode(
        {
          code: issued.code,
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeVerifier: validVerifier,
        },
        { adminClient }
      );

      // Valid against canonical resource
      const validAuth = await authenticateAiToken(tokens.access_token, {
        adminClient,
        expectedResource: CANONICAL_MCP_RESOURCE,
      });
      expect(validAuth.success).toBe(true);

      // Rejected if verified against a different resource
      const wrongResourceAuth = await authenticateAiToken(tokens.access_token, {
        adminClient,
        expectedResource: 'https://different.example.com/api/mcp',
      });
      expect(wrongResourceAuth.success).toBe(false);
      if (!wrongResourceAuth.success) {
        expect(wrongResourceAuth.status).toBe(401);
        expect(wrongResourceAuth.error.message).toContain(
          'Token was not issued for this MCP resource'
        );
      }

      // 2. Existing manually created ctc_live_ token (resource = null) continues to work seamlessly
      const manualCreated = await createAiToken(adminClient, {
        workspaceId: workspaceA,
        userId,
        name: 'Manual CLI Token',
        scopes: ['task:read', 'task:write'],
      });

      const manualAuth = await authenticateAiToken(manualCreated.token, {
        adminClient,
      });
      expect(manualAuth.success).toBe(true);
      if (manualAuth.success) {
        expect(manualAuth.context.workspaceId).toBe(workspaceA);
        expect(manualAuth.context.scopes).toEqual(['task:read', 'task:write']);
      }
    });
  });

  // ===========================================================================
  // 6. REFRESH-TOKEN ROTATION, REPLAY DETECTION & REVOCATION CASCADE
  // ===========================================================================
  describe('6. Refresh-Token Rotation, Replay Detection & Revocation', () => {
    let clientId: string;

    beforeEach(async () => {
      const client = await registerOAuthClient(
        { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] },
        { adminClient }
      );
      clientId = client.client_id;
    });

    it('rotates refresh tokens atomically, invalidates the old access token, and detects refresh token replay', async () => {
      const issued = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read', 'task:write'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-rot',
        },
        { adminClient }
      );

      const initialTokens = await exchangeAuthorizationCode(
        {
          code: issued.code,
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeVerifier: validVerifier,
        },
        { adminClient }
      );

      // Rotate refresh token
      const rotatedTokens = await rotateOAuthRefreshToken(
        {
          refreshToken: initialTokens.refresh_token,
          clientId,
        },
        { adminClient }
      );

      expect(rotatedTokens.access_token).not.toBe(initialTokens.access_token);
      expect(rotatedTokens.refresh_token).not.toBe(initialTokens.refresh_token);

      // Old access token is now revoked
      const oldAccessCheck = await authenticateAiToken(initialTokens.access_token, {
        adminClient,
      });
      expect(oldAccessCheck.success).toBe(false);

      // New access token works
      const newAccessCheck = await authenticateAiToken(rotatedTokens.access_token, {
        adminClient,
      });
      expect(newAccessCheck.success).toBe(true);

      // REPLAY ATTACK: Presenting the old refresh token a second time revokes the entire grant family!
      await expect(
        rotateOAuthRefreshToken(
          {
            refreshToken: initialTokens.refresh_token,
            clientId,
          },
          { adminClient }
        )
      ).rejects.toThrow(/replay/i);

      // Both the rotated access token and rotated refresh token are now revoked!
      const afterReplayAccessCheck = await authenticateAiToken(
        rotatedTokens.access_token,
        { adminClient }
      );
      expect(afterReplayAccessCheck.success).toBe(false);

      await expect(
        rotateOAuthRefreshToken(
          {
            refreshToken: rotatedTokens.refresh_token,
            clientId,
          },
          { adminClient }
        )
      ).rejects.toThrow(/revoked/i);
    });

    it('prevents refresh token usage when its linked access token is revoked via /settings/tokens or /api/oauth/revoke', async () => {
      const issued = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-rev',
        },
        { adminClient }
      );

      const tokens = await exchangeAuthorizationCode(
        {
          code: issued.code,
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeVerifier: validVerifier,
        },
        { adminClient }
      );

      // Find the token ID in db and revoke it via revokeAiToken (simulating /settings/tokens UI)
      const tokenEntry = Array.from(db.tokens.values())[0];
      await revokeAiToken(adminClient, workspaceA, tokenEntry.id, userId);

      // Refresh token must now be rejected because its linked access token was revoked
      await expect(
        rotateOAuthRefreshToken(
          {
            refreshToken: tokens.refresh_token,
            clientId,
          },
          { adminClient }
        )
      ).rejects.toThrow(/revoked/i);

      // Also test /api/oauth/revoke with a refresh token directly
      const issued2 = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-rev-2',
        },
        { adminClient }
      );
      const tokens2 = await exchangeAuthorizationCode(
        {
          code: issued2.code,
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeVerifier: validVerifier,
        },
        { adminClient }
      );

      const revokeRes = await handleOAuthRevokeRequest(
        new Request('http://localhost:3000/api/oauth/revoke', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: tokens2.refresh_token }).toString(),
        }),
        { adminClient }
      );
      expect(revokeRes.status).toBe(200);

      // Linked access token is now revoked
      const check2 = await authenticateAiToken(tokens2.access_token, { adminClient });
      expect(check2.success).toBe(false);
    });

    it('rejects cross-client refresh token rotation attempts and issues no new token to Client B', async () => {
      // 1. Register Client B (clientId from beforeEach is Client A)
      const clientB = await registerOAuthClient(
        {
          client_name: 'Client B',
          redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        },
        { adminClient }
      );

      // 2. Complete authorization and exchange for Client A
      const issuedForA = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read', 'task:write'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-cross-refresh',
        },
        { adminClient }
      );

      const tokensA = await exchangeAuthorizationCode(
        {
          code: issuedForA.code,
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeVerifier: validVerifier,
        },
        { adminClient }
      );

      const tokenCountBefore = db.tokens.size;

      // 3. Client B attempts to rotate Client A's refresh token via POST /api/oauth/token
      const crossReq = new Request('http://localhost:3000/api/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokensA.refresh_token,
          client_id: clientB.client_id,
        }).toString(),
      });

      const res = await handleOAuthTokenRequest(crossReq, { adminClient });
      expect(res.status).toBe(400);
      const err = await res.json();
      expect(err.error).toBe('invalid_grant');

      // Verify no new token was issued to Client B
      expect(db.tokens.size).toBe(tokenCountBefore);

      // 4. Verify Client A's access token remains valid
      const clientAAuth = await authenticateAiToken(tokensA.access_token, {
        adminClient,
      });
      expect(clientAAuth.success).toBe(true);

      // 5. Verify Client A can still rotate the refresh token successfully
      const rotatedByA = await rotateOAuthRefreshToken(
        {
          refreshToken: tokensA.refresh_token,
          clientId,
        },
        { adminClient }
      );
      expect(rotatedByA.access_token).toBeDefined();
      expect(rotatedByA.refresh_token).toBeDefined();
    });

    it('handles concurrent refresh token rotation: prevents double-rotation and enforces grant-family replay revocation', async () => {
      db.useRpc = true;

      // 1. Creates a valid OAuth grant and refresh token
      const issued = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read', 'task:write'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-concurrent-rotation',
        },
        { adminClient }
      );

      const initialTokens = await exchangeAuthorizationCode(
        {
          code: issued.code,
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeVerifier: validVerifier,
        },
        { adminClient }
      );

      // 2. Starts two refresh attempts against the same token concurrently
      const [attempt1, attempt2] = await Promise.allSettled([
        rotateOAuthRefreshToken(
          {
            refreshToken: initialTokens.refresh_token,
            clientId,
          },
          { adminClient }
        ),
        rotateOAuthRefreshToken(
          {
            refreshToken: initialTokens.refresh_token,
            clientId,
          },
          { adminClient }
        ),
      ]);

      // 3. Awaits both results and verifies that the same refresh token cannot produce two independent rotations
      const fulfilled = [attempt1, attempt2].filter(
        (r): r is PromiseFulfilledResult<TokenExchangeResponse> => r.status === 'fulfilled'
      );
      const rejected = [attempt1, attempt2].filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );

      // Invariant: Two independent rotations can NEVER both succeed
      expect(fulfilled.length).toBeLessThanOrEqual(1);
      expect(rejected.length).toBeGreaterThanOrEqual(1);

      // The losing request must be rejected with invalid_grant / replay detection
      const rejectedError = rejected[0].reason;
      expect(rejectedError.message || String(rejectedError)).toMatch(
        /replay|already been used|invalid_grant|revoked/i
      );

      // 4. Verify resulting grant state:
      // Under strict RFC 6819 single-use rotation with immediate replay revocation:
      // When the second concurrent request presents the already-consumed refresh token,
      // replay detection triggers, revoking the entire grant family.
      // Consequently, the access token received by the first request is now revoked.
      if (fulfilled.length === 1) {
        const winningTokens = fulfilled[0].value;
        expect(winningTokens.access_token).toBeDefined();

        const tokenAuthCheck = await authenticateAiToken(winningTokens.access_token, {
          adminClient,
        });
        expect(tokenAuthCheck.success).toBe(false);
      }
    });

    it('fails closed when rotate_oauth_refresh_token RPC is unavailable (e.g. PGRST202) without performing fallback mutations', async () => {
      // 1. Create a valid grant while RPC is available
      const issued = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-rt-missing-rpc',
        },
        { adminClient }
      );
      const grant = await exchangeAuthorizationCode(
        {
          code: issued.code,
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeVerifier: validVerifier,
        },
        { adminClient }
      );

      // 2. Disable RPC to simulate PGRST202 / missing schema cache
      db.useRpc = false;
      const tokensBefore = db.tokens.size;
      const refreshBefore = db.refreshTokens.size;

      await expect(
        rotateOAuthRefreshToken(
          {
            refreshToken: grant.refresh_token,
            clientId,
          },
          { adminClient }
        )
      ).rejects.toMatchObject({
        code: OAuthErrorCode.ServerError,
        message: expect.stringMatching(/database error during refresh token rotation/i),
      });

      // Verify fail-closed invariant: NO fallback mutations occurred
      expect(db.tokens.size).toBe(tokensBefore);
      expect(db.refreshTokens.size).toBe(refreshBefore);
      const rtHash = crypto.createHash('sha256').update(grant.refresh_token).digest('hex');
      const rtRow = Array.from(db.refreshTokens.values()).find((r) => r.token_hash === rtHash);
      expect(rtRow?.consumed_at).toBeNull();
      expect(rtRow?.is_revoked).toBe(false);
      const accessRow = Array.from(db.tokens.values()).find((t) => t.id === rtRow?.access_token_id);
      expect(accessRow?.is_revoked).toBe(false);
    });
  });

  // ===========================================================================
  // 7. VIEWER ROLE REJECTION, MEMBERSHIP REMOVAL & WORKSPACE ISOLATION
  // ===========================================================================
  describe('7. Viewer Role Rejection, Membership Removal & Workspace Isolation', () => {
    let clientId: string;

    beforeEach(async () => {
      const client = await registerOAuthClient(
        { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] },
        { adminClient }
      );
      clientId = client.client_id;
    });

    it('rejects viewer role from approving OAuth grants (including write-capable and read-only)', async () => {
      await expect(
        issueOAuthAuthorizationCode(
          {
            userId: viewerUserId,
            workspaceId: workspaceA,
            approvedScopes: ['task:read', 'task:write'],
            clientId,
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            responseType: 'code',
            codeChallenge: validChallenge,
            codeChallengeMethod: 'S256',
            state: 'state-viewer',
          },
          { adminClient }
        )
      ).rejects.toThrow(/viewers cannot authorize write-capable/i);

      await expect(
        issueOAuthAuthorizationCode(
          {
            userId: viewerUserId,
            workspaceId: workspaceA,
            approvedScopes: ['task:read'],
            clientId,
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            responseType: 'code',
            codeChallenge: validChallenge,
            codeChallengeMethod: 'S256',
            state: 'state-viewer-2',
          },
          { adminClient }
        )
      ).rejects.toThrow(/viewers are not permitted/i);
    });

    it('immediately rejects MCP requests and token refreshes when a user is demoted to viewer or removed from workspace', async () => {
      const issued = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read', 'task:write'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-demote',
        },
        { adminClient }
      );

      const tokens = await exchangeAuthorizationCode(
        {
          code: issued.code,
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeVerifier: validVerifier,
        },
        { adminClient }
      );

      // 1. Demote user to viewer
      db.members.set(`${workspaceA}:${userId}`, { role: 'viewer' });

      const demotedAuth = await authenticateAiToken(tokens.access_token, {
        adminClient,
      });
      expect(demotedAuth.success).toBe(false);
      if (!demotedAuth.success) {
        expect(demotedAuth.status).toBe(403);
        expect(demotedAuth.error.message).toMatch(/viewer role is not permitted/i);
      }

      // Refresh rotation also fails when demoted to viewer
      await expect(
        rotateOAuthRefreshToken(
          { refreshToken: tokens.refresh_token, clientId },
          { adminClient }
        )
      ).rejects.toThrow(/viewer/i);

      // 2. Remove user from workspace completely
      db.members.delete(`${workspaceA}:${userId}`);
      await expect(
        issueOAuthAuthorizationCode(
          {
            userId,
            workspaceId: workspaceA,
            approvedScopes: ['task:read'],
            clientId,
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            responseType: 'code',
            codeChallenge: validChallenge,
            codeChallengeMethod: 'S256',
            state: 'state-removed',
          },
          { adminClient }
        )
      ).rejects.toThrow(/not an active member/i);
    });

    it('allows owner, admin, and member to authorize grants, exchange codes, and authenticate with MCP endpoint', async () => {
      const allowedRoles = [
        { role: 'owner' as const, uid: userId },
        { role: 'admin' as const, uid: adminUserId },
        { role: 'member' as const, uid: memberUserId },
      ];

      for (const { role, uid } of allowedRoles) {
        // 1. Authorize grant
        const issued = await issueOAuthAuthorizationCode(
          {
            userId: uid,
            workspaceId: workspaceA,
            approvedScopes: ['task:read', 'task:write'],
            clientId,
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            responseType: 'code',
            codeChallenge: validChallenge,
            codeChallengeMethod: 'S256',
            state: `state-role-${role}`,
          },
          { adminClient }
        );
        expect(issued.code).toMatch(/^ctc_code_[0-9a-f]{64}$/);

        // 2. Exchange code for access & refresh tokens
        const tokens = await exchangeAuthorizationCode(
          {
            code: issued.code,
            clientId,
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            codeVerifier: validVerifier,
          },
          { adminClient }
        );
        expect(tokens.access_token).toMatch(/^ctc_live_[0-9a-f]{64}$/);
        expect(tokens.refresh_token).toMatch(/^ctc_rt_[0-9a-f]{64}$/);

        // 3. Authenticate against MCP endpoint
        const auth = await authenticateAiToken(tokens.access_token, { adminClient });
        expect(auth.success).toBe(true);
        if (auth.success) {
          expect(auth.context.workspaceId).toBe(workspaceA);
          expect(auth.context.userId).toBe(uid);
          expect(db.members.get(`${workspaceA}:${uid}`)?.role).toBe(role);
        }
      }
    });

    it('rejects authorization code exchange if user is demoted to viewer or removed from workspace after code issuance', async () => {
      // 1. Demoted to viewer before code exchange
      const demotedUser = '66666666-6666-4666-8666-666666666666';
      db.members.set(`${workspaceA}:${demotedUser}`, { role: 'member' });
      db.profiles.set(demotedUser, { timezone: 'UTC' });

      const codeForDemote = await issueOAuthAuthorizationCode(
        {
          userId: demotedUser,
          workspaceId: workspaceA,
          approvedScopes: ['task:read'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-pre-demote',
        },
        { adminClient }
      );

      // User gets demoted to viewer
      db.members.set(`${workspaceA}:${demotedUser}`, { role: 'viewer' });

      await expect(
        exchangeAuthorizationCode(
          {
            code: codeForDemote.code,
            clientId,
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            codeVerifier: validVerifier,
          },
          { adminClient }
        )
      ).rejects.toThrow(/viewers cannot obtain OAuth tokens|viewer_role_forbidden/i);

      // 2. Removed from workspace before code exchange
      const removedUser = '77777777-7777-4777-8777-777777777777';
      db.members.set(`${workspaceA}:${removedUser}`, { role: 'member' });
      db.profiles.set(removedUser, { timezone: 'UTC' });

      const codeForRemoval = await issueOAuthAuthorizationCode(
        {
          userId: removedUser,
          workspaceId: workspaceA,
          approvedScopes: ['task:read'],
          clientId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'state-pre-remove',
        },
        { adminClient }
      );

      // User removed from workspace
      db.members.delete(`${workspaceA}:${removedUser}`);

      await expect(
        exchangeAuthorizationCode(
          {
            code: codeForRemoval.code,
            clientId,
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            codeVerifier: validVerifier,
          },
          { adminClient }
        )
      ).rejects.toThrow(/no longer an active member|membership_revoked/i);
    });

    it('rejects users with no workspace membership from authorizing an OAuth grant', async () => {
      const nonMember = '88888888-8888-4888-8888-888888888888';
      // nonMember is not in db.members

      await expect(
        issueOAuthAuthorizationCode(
          {
            userId: nonMember,
            workspaceId: workspaceA,
            approvedScopes: ['task:read'],
            clientId,
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
            responseType: 'code',
            codeChallenge: validChallenge,
            codeChallengeMethod: 'S256',
            state: 'non-member-state',
          },
          { adminClient }
        )
      ).rejects.toThrow(/not an active member/i);
    });
  });

  // ===========================================================================
  // 8. END-TO-END FLOW: OAUTH -> DISCOVER ALL 14 TOOLS -> CREATE TASK (MODERN & LEGACY)
  // ===========================================================================
  describe('8. Full OAuth 2.1 -> MCP 14-Tool Discovery & Task Creation Flow', () => {
    it('completes OAuth 2.1 PKCE flow, discovers all 14 MCP tools, creates a task in the authorized workspace, and enforces workspace isolation & consented scopes', async () => {
      // Step 1: Dynamic Client Registration by Claude
      const registered = await registerOAuthClient(
        {
          client_name: 'Claude Web',
          redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        },
        { adminClient }
      );

      // Step 2: User authorizes Workspace A with ['task:read', 'task:write'] (NOT content:write)
      const issued = await issueOAuthAuthorizationCode(
        {
          userId,
          workspaceId: workspaceA,
          approvedScopes: ['task:read', 'task:write'],
          clientId: registered.client_id,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
          state: 'claude-e2e-state',
          resource: CANONICAL_MCP_RESOURCE,
        },
        { adminClient }
      );

      // Step 3: Claude exchanges authorization code + PKCE verifier at POST /api/oauth/token
      const tokenRes = await handleOAuthTokenRequest(
        new Request('http://localhost:3000/api/oauth/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: issued.code,
            client_id: registered.client_id,
            redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
            code_verifier: validVerifier,
            resource: CANONICAL_MCP_RESOURCE,
          }).toString(),
        }),
        { adminClient }
      );
      expect(tokenRes.status).toBe(200);
      const tokenData = await tokenRes.json();
      expect(tokenData.access_token).toMatch(/^ctc_live_[0-9a-f]{64}$/);
      expect(tokenData.scope).toBe('task:read task:write');

      // Step 4: Claude discovers all 14 tools over stateless legacy 2025-11-25 Streamable HTTP
      const listReq = new Request('http://localhost:3000/api/mcp?format=json', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          authorization: `Bearer ${tokenData.access_token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 101,
          method: 'tools/list',
          params: {},
        }),
      });

      const listRes = await handleMcpRequest(listReq, { adminClient });
      expect(listRes.status).toBe(200);
      const listText = await listRes.text();
      const listJson = listText.startsWith('event:')
        ? JSON.parse(listText.match(/^data:\s*(.+)$/m)![1])
        : JSON.parse(listText);
      expect(listJson.result.tools).toHaveLength(14);

      // Step 5: Claude calls create_task — succeeds in Workspace A!
      vi.mocked(createTask).mockResolvedValueOnce({
        id: '77777777-7777-4777-8777-777777777777',
        workspace_id: workspaceA,
        title: 'Prepare Q4 Content Launch',
        status: 'todo',
        priority: 'high',
        created_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never);

      const createReq = new Request('http://localhost:3000/api/mcp?format=json', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          authorization: `Bearer ${tokenData.access_token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 102,
          method: 'tools/call',
          params: {
            name: 'create_task',
            arguments: {
              title: 'Prepare Q4 Content Launch',
              priority: 'high',
            },
          },
        }),
      });

      const createRes = await handleMcpRequest(createReq, { adminClient });
      expect(createRes.status).toBe(200);
      const createText = await createRes.text();
      const createJson = createText.startsWith('event:')
        ? JSON.parse(createText.match(/^data:\s*(.+)$/m)![1])
        : JSON.parse(createText);

      expect(createJson.result.isError).toBe(false);
      expect(createTask).toHaveBeenCalledTimes(1);
      // Verify trusted Workspace A and userId were injected by OAuth token context
      // createTask signature: (supabase, workspaceId, input, userId)
      expect(vi.mocked(createTask).mock.calls[0][1]).toBe(workspaceA);
      expect(vi.mocked(createTask).mock.calls[0][1]).not.toBe(workspaceB);
      expect(vi.mocked(createTask).mock.calls[0][2]).toMatchObject({
        title: 'Prepare Q4 Content Launch',
        priority: 'high',
      });
      expect(vi.mocked(createTask).mock.calls[0][3]).toBe(userId);

      // Step 6: Consent enforcement — calling create_content_item fails with INSUFFICIENT_SCOPE
      // because the user only consented to ['task:read', 'task:write']
      const unconsentedReq = new Request('http://localhost:3000/api/mcp?format=json', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          authorization: `Bearer ${tokenData.access_token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 103,
          method: 'tools/call',
          params: {
            name: 'create_content_item',
            arguments: {
              title: 'Unauthorized Post',
              platform: 'linkedin',
              action_type: 'post',
            },
          },
        }),
      });

      const unconsentedRes = await handleMcpRequest(unconsentedReq, { adminClient });
      expect(unconsentedRes.status).toBe(200);
      const unconsentedText = await unconsentedRes.text();
      const unconsentedJson = unconsentedText.startsWith('event:')
        ? JSON.parse(unconsentedText.match(/^data:\s*(.+)$/m)![1])
        : JSON.parse(unconsentedText);

      expect(unconsentedJson.result.isError).toBe(true);
      expect(unconsentedJson.result.content[0].text).toContain('FORBIDDEN');
      expect(unconsentedJson.result.content[0].text).toContain('content:write');
    });

    it('executes atomic SECURITY DEFINER RPC paths for code exchange, refresh rotation, and replay family revocation when RPCs are present', async () => {
      db.useRpc = true;

      const regRes = await registerOAuthClient(
        {
          client_name: 'Claude Web RPC Client',
          redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
          token_endpoint_auth_method: 'none',
        },
        { adminClient, ipAddress: '203.0.113.77' }
      );
      expect(regRes.client_id).toBeTruthy();

      const issued = await issueOAuthAuthorizationCode(
        {
          clientId: regRes.client_id,
          workspaceId: workspaceA,
          userId,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          responseType: 'code',
          state: 'rpc-state-12345678',
          approvedScopes: ['task:read', 'task:write'],
          resource: CANONICAL_MCP_RESOURCE,
          codeChallenge: validChallenge,
          codeChallengeMethod: 'S256',
        },
        { adminClient }
      );
      expect(issued.code).toMatch(/^ctc_code_/);

      const exchanged = await exchangeAuthorizationCode(
        {
          clientId: regRes.client_id,
          code: issued.code,
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeVerifier: validVerifier,
          resource: CANONICAL_MCP_RESOURCE,
        },
        { adminClient }
      );
      expect(exchanged.access_token).toMatch(/^ctc_live_/);

      // Rotate via RPC
      const rotated = await rotateOAuthRefreshToken(
        {
          clientId: regRes.client_id,
          refreshToken: exchanged.refresh_token,
          resource: CANONICAL_MCP_RESOURCE,
        },
        { adminClient }
      );
      expect(rotated.access_token).toMatch(/^ctc_live_/);

      // Replay old refresh token via RPC -> revokes entire grant family
      await expect(
        rotateOAuthRefreshToken(
          {
            clientId: regRes.client_id,
            refreshToken: exchanged.refresh_token,
            resource: CANONICAL_MCP_RESOURCE,
          },
          { adminClient }
        )
      ).rejects.toThrow(/refresh_token_replayed_grant_revoked/i);

      // Latest access token is now revoked as part of the family revocation
      const authAfterReplay = await authenticateAiToken(rotated.access_token, {
        adminClient,
      });
      expect(authAfterReplay.success).toBe(false);
    });
  });
});
