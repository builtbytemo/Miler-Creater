'use server';

import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { resolveAuthorizedWorkspace } from '@/lib/auth/workspace';
import {
  createAiToken,
  listWorkspaceTokens,
  revokeAiToken,
  type CreateTokenResult,
  type SafeTokenMetadata,
} from '@/lib/mcp/token-service';
import {
  createAiTokenSchema,
  revokeAiTokenSchema,
  type CreateAiTokenSchemaInput,
} from '@/lib/validation/ai-token';

export interface AiTokenActionResult<T = unknown> {
  success?: boolean;
  error?: string;
  data?: T;
}

/**
 * Formats exceptions into safe, user-facing error messages while stripping
 * any potential bearer token secrets or hashes.
 */
function formatSafeError(err: unknown): string {
  let rawMessage = 'An unexpected error occurred while managing AI API tokens';

  if (err instanceof ZodError) {
    rawMessage = err.issues.map((i) => i.message).join('; ');
  } else if (err instanceof Error && err.message) {
    rawMessage = err.message;
  }

  return rawMessage
    .replace(/ctc_live_[0-9a-fA-F]+/g, '[REDACTED_TOKEN]')
    .replace(/\b[0-9a-fA-F]{64}\b/g, '[REDACTED_HASH]');
}

/**
 * Creates a new AI API token for the authorized workspace.
 *
 * Security Invariants:
 * 1. Authenticates the current user via Supabase Auth.
 * 2. Resolves and authorizes workspace membership via resolveAuthorizedWorkspace.
 * 3. Validates name, scopes, and optional expiration via createAiTokenSchema.
 * 4. Delegates generation, role verification (owner/admin/member only, viewers rejected),
 *    SHA-256 hashing, and audit logging to createAiToken().
 * 5. Returns the plaintext token ONCE in data.token alongside safe metadata.
 */
export async function createAiTokenAction(
  workspaceId: string | undefined,
  input: CreateAiTokenSchemaInput
): Promise<AiTokenActionResult<CreateTokenResult>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();

    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const validated = createAiTokenSchema.parse(input);

    const result = await createAiToken(supabase, {
      workspaceId: authWsId,
      userId: authData.user.id,
      name: validated.name,
      scopes: validated.scopes,
      expiresInDays: validated.expiresInDays ?? undefined,
    });

    revalidatePath('/settings/tokens');

    return {
      success: true,
      data: result,
    };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

/**
 * Lists AI API tokens for the authorized workspace.
 *
 * Security Invariants:
 * 1. Authenticates the current user via Supabase Auth.
 * 2. Resolves and authorizes workspace membership via resolveAuthorizedWorkspace.
 * 3. Delegates to listWorkspaceTokens(), which never selects token_hash or raw secrets,
 *    restricts non-admin members to their own created tokens, and rejects viewers.
 */
export async function listWorkspaceTokensAction(
  workspaceId?: string
): Promise<AiTokenActionResult<SafeTokenMetadata[]>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();

    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const tokens = await listWorkspaceTokens(supabase, authWsId, authData.user.id);

    return {
      success: true,
      data: tokens,
    };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

/**
 * Revokes an existing AI API token in the authorized workspace.
 *
 * Security Invariants:
 * 1. Authenticates the current user via Supabase Auth.
 * 2. Validates tokenId format as a UUID before database queries.
 * 3. Resolves and authorizes workspace membership via resolveAuthorizedWorkspace.
 * 4. Delegates to revokeAiToken(), which enforces that members can only revoke
 *    their own tokens, owners/admins can revoke any workspace token, and viewers are rejected.
 */
export async function revokeAiTokenAction(
  workspaceId: string | undefined,
  tokenId: string
): Promise<AiTokenActionResult<{ revoked: boolean }>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();

    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    if (!tokenId || typeof tokenId !== 'string' || !tokenId.trim()) {
      return { error: 'Token ID is required' };
    }

    const validated = revokeAiTokenSchema.parse({ tokenId: tokenId.trim() });

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const res = await revokeAiToken(supabase, authWsId, validated.tokenId, authData.user.id);

    revalidatePath('/settings/tokens');

    return {
      success: true,
      data: { revoked: res.success },
    };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}
