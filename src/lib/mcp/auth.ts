import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { AIExecutionContext, ToolError } from '@/lib/mcp/types';
import { hashAiToken } from '@/lib/ai/tokens';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAiAuditEvent } from '@/lib/mcp/audit';
import { checkTokenRateLimit, type RateLimitOptions } from '@/lib/mcp/rate-limiter';
import { updateTokenLastUsed } from '@/lib/mcp/token-service';
import { getCanonicalMcpResource, isCanonicalMcpResource } from '@/lib/mcp/oauth';

export interface AuthenticateTokenOptions extends RateLimitOptions {
  /** Optional override for privileged admin client (e.g. for offline mock tests) */
  adminClient?: SupabaseClient<Database>;
  /** Client IP address for audit ledger attribution */
  ipAddress?: string | null;
  /** Client user agent for audit ledger attribution */
  userAgent?: string | null;
  /** Expected RFC 8707 canonical MCP resource for OAuth-bound tokens */
  expectedResource?: string;
}

export type AuthenticationResult =
  | { success: true; context: AIExecutionContext }
  | { success: false; status: number; error: ToolError };

const TOKEN_FORMAT_REGEX = /^ctc_live_[0-9a-f]{64}$/;

/**
 * Server-side authentication and security validation layer for AI API bearer tokens.
 * 
 * Pipeline:
 *  1. Format validation (fails fast on malformed tokens without DB touch)
 *  2. SHA-256 hash calculation
 *  3. Token record lookup via privileged admin client (bypassing RLS)
 *  4. Reject unknown tokens (generic 401, audit failure with NO raw token logging)
 *  5. Reject revoked tokens (generic 401, audit failure)
 *  6. Reject expired tokens (generic 401, audit failure)
 *  7. Re-verify active workspace membership for creator in workspace_members
 *  8. Reject deactivated/removed members (403, audit failure)
 *  9. Enforce atomic serverless rate limiting via checkTokenRateLimit (429 on exhaustion or fail-closed)
 * 10. Load profile timezone, update last_used_at, and construct immutable AIExecutionContext
 */
export async function authenticateAiToken(
  rawBearerToken: string,
  options: AuthenticateTokenOptions = {}
): Promise<AuthenticationResult> {
  // 1. Fast format validation (guarantees timing safety & avoids pointless DB queries)
  if (
    !rawBearerToken ||
    typeof rawBearerToken !== 'string' ||
    !TOKEN_FORMAT_REGEX.test(rawBearerToken.trim())
  ) {
    return {
      success: false,
      status: 401,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or malformed API token',
      },
    };
  }

  const cleanToken = rawBearerToken.trim();
  const adminClient = options.adminClient ?? createAdminClient();
  const now = options.referenceTime ?? new Date();

  // 2. Hash presented token
  const tokenHash = hashAiToken(cleanToken);

  // 3. Query token record using privileged client
  const { data: tokenRecord, error: tokenErr } = await adminClient
    .from('ai_api_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  // 4. Reject unknown token (generic 401 prevents token enumeration)
  if (tokenErr || !tokenRecord) {
    // Audit failure without leaking any portion of the presented bearer token
    await logAiAuditEvent(adminClient, {
      workspaceId: null, // No verified workspace association
      actorType: 'ai_client',
      actorId: 'unknown',
      eventType: 'token.auth_failed',
      entityType: 'ai_api_token',
      details: {
        reason: 'token_not_found',
      },
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
    });

    return {
      success: false,
      status: 401,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or unauthenticated API token',
      },
    };
  }

  // 5. Reject revoked token
  if (tokenRecord.is_revoked) {
    await logAiAuditEvent(adminClient, {
      workspaceId: tokenRecord.workspace_id,
      actorType: 'ai_client',
      actorId: tokenRecord.id,
      eventType: 'token.auth_failed',
      entityType: 'ai_api_token',
      entityId: tokenRecord.id,
      details: {
        reason: 'token_revoked',
        name: tokenRecord.name || tokenRecord.client_name,
      },
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
    });

    return {
      success: false,
      status: 401,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or unauthenticated API token',
      },
    };
  }

  // 6. Reject expired token
  if (tokenRecord.expires_at) {
    const expiresMs = new Date(tokenRecord.expires_at).getTime();
    if (expiresMs <= now.getTime()) {
      await logAiAuditEvent(adminClient, {
        workspaceId: tokenRecord.workspace_id,
        actorType: 'ai_client',
        actorId: tokenRecord.id,
        eventType: 'token.auth_failed',
        entityType: 'ai_api_token',
        entityId: tokenRecord.id,
        details: {
          reason: 'token_expired',
          expiresAt: tokenRecord.expires_at,
        },
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });

      return {
        success: false,
        status: 401,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or unauthenticated API token',
        },
      };
    }
  }

  // 6b. Enforce RFC 8707 resource binding for OAuth-issued tokens
  // Existing manually generated ctc_live_ tokens have resource = null and oauth_client_id = null
  const isOAuthBoundToken = Boolean(tokenRecord.oauth_client_id || tokenRecord.resource);
  if (isOAuthBoundToken) {
    const expectedResource = options.expectedResource ?? getCanonicalMcpResource();
    if (!tokenRecord.resource || !isCanonicalMcpResource(tokenRecord.resource, expectedResource)) {
      await logAiAuditEvent(adminClient, {
        workspaceId: tokenRecord.workspace_id,
        actorType: 'ai_client',
        actorId: tokenRecord.id,
        eventType: 'token.auth_failed',
        entityType: 'ai_api_token',
        entityId: tokenRecord.id,
        details: {
          reason: 'resource_mismatch',
          expectedResource,
        },
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });

      return {
        success: false,
        status: 401,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Token was not issued for this MCP resource',
        },
      };
    }
  }

  // 7 & 8. Re-verify active workspace membership and role of token creator
  const { data: memberRecord, error: memberErr } = await adminClient
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', tokenRecord.workspace_id)
    .eq('user_id', tokenRecord.created_by)
    .maybeSingle();

  if (memberErr || !memberRecord) {
    await logAiAuditEvent(adminClient, {
      workspaceId: tokenRecord.workspace_id,
      actorType: 'ai_client',
      actorId: tokenRecord.id,
      eventType: 'token.auth_failed',
      entityType: 'ai_api_token',
      entityId: tokenRecord.id,
      details: {
        reason: 'workspace_membership_revoked',
        creatorId: tokenRecord.created_by,
      },
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
    });

    return {
      success: false,
      status: 403,
      error: {
        code: 'FORBIDDEN',
        message: 'Workspace access denied: token creator is no longer an active workspace member',
      },
    };
  }

  if (memberRecord.role === 'viewer') {
    await logAiAuditEvent(adminClient, {
      workspaceId: tokenRecord.workspace_id,
      actorType: 'ai_client',
      actorId: tokenRecord.id,
      eventType: 'token.auth_failed',
      entityType: 'ai_api_token',
      entityId: tokenRecord.id,
      details: {
        reason: 'workspace_role_insufficient',
        creatorId: tokenRecord.created_by,
        role: memberRecord.role,
      },
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
    });

    return {
      success: false,
      status: 403,
      error: {
        code: 'FORBIDDEN',
        message: 'Workspace access denied: viewer role is not permitted to use AI API tokens',
      },
    };
  }

  // 9. Enforce atomic serverless rate limiting (fails closed on database error)
  const rateLimitResult = await checkTokenRateLimit(adminClient, tokenRecord.id, options);

  if (!rateLimitResult.allowed) {
    return {
      success: false,
      status: 429,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded. Please retry in ${rateLimitResult.retryAfterSeconds} seconds.`,
        details: {
          retryAfterSeconds: rateLimitResult.retryAfterSeconds,
          currentCount: rateLimitResult.currentCount,
        },
      },
    };
  }

  // 10. Load profile timezone, update last_used_at, and construct immutable AIExecutionContext
  const { data: profile } = await adminClient
    .from('profiles')
    .select('timezone')
    .eq('id', tokenRecord.created_by)
    .maybeSingle();

  // Async non-blocking update of last_used_at
  updateTokenLastUsed(adminClient, tokenRecord.id).catch(() => {});

  const context: AIExecutionContext = {
    supabase: adminClient,
    workspaceId: tokenRecord.workspace_id,
    userId: tokenRecord.created_by,
    actorId: tokenRecord.id,
    scopes: (tokenRecord.scopes as string[]) || [],
    timeZone: profile?.timezone || 'UTC',
  };

  return {
    success: true,
    context,
  };
}
