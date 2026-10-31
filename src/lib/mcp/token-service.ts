import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { ToolScope } from '@/lib/mcp/types';
import { generateAiToken } from '@/lib/ai/tokens';
import { logAiAuditEvent } from '@/lib/mcp/audit';

export interface CreateTokenInput {
  workspaceId: string;
  userId: string;
  name: string;
  scopes: ToolScope[];
  expiresInDays?: number;
}

export interface SafeTokenMetadata {
  id: string;
  workspaceId: string;
  name: string;
  clientName: string;
  tokenPrefix: string;
  scopes: ToolScope[];
  isRevoked: boolean;
  revokedAt: string | null;
  createdBy: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateTokenResult {
  /**
   * The plaintext high-entropy bearer token.
   * SECURITY GUARANTEE: Returned exactly once upon creation.
   * Never persisted to the database and never returned by any other endpoint.
   */
  token: string;
  /** Non-sensitive token metadata suitable for display in management UI */
  tokenMetadata: SafeTokenMetadata;
}

const VALID_TOOL_SCOPES: Set<ToolScope> = new Set([
  'task:read',
  'task:write',
  'content:read',
  'content:write',
]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, fieldName: string): void {
  if (!value || typeof value !== 'string' || !UUID_REGEX.test(value)) {
    throw new Error(`Invalid ${fieldName}: must be a valid UUID`);
  }
}

/**
 * Creates a new high-entropy, individually revocable AI API token.
 * 
 * Invariants:
 * 1. Plaintext token is returned ONLY in the result of this function call.
 * 2. Only the SHA-256 hash is persisted in the database.
 * 3. Token is bound to a single workspace and creator.
 * 4. Caller must hold an active 'owner', 'admin', or 'member' role in the workspace.
 */
export async function createAiToken(
  supabase: SupabaseClient<Database>,
  input: CreateTokenInput
): Promise<CreateTokenResult> {
  assertUuid(input.workspaceId, 'workspaceId');
  assertUuid(input.userId, 'userId');

  const trimmedName = input.name ? input.name.trim() : '';
  if (!trimmedName || trimmedName.length < 1 || trimmedName.length > 100) {
    throw new Error('Token name must be between 1 and 100 characters');
  }

  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    throw new Error('At least one valid scope is required');
  }

  for (const scope of input.scopes) {
    if (!VALID_TOOL_SCOPES.has(scope)) {
      throw new Error(`Invalid tool scope: "${scope}". Allowed scopes: task:read, task:write, content:read, content:write`);
    }
  }

  // 1. Authorize workspace membership and verify caller role
  const { data: member, error: memberErr } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', input.workspaceId)
    .eq('user_id', input.userId)
    .maybeSingle();

  if (memberErr || !member) {
    throw new Error('Unauthorized: You do not have access to this workspace');
  }

  if (member.role === 'viewer') {
    throw new Error('Forbidden: Viewers are not permitted to create AI API tokens');
  }

  // 2. Cryptographic token generation (256 bits entropy)
  const tokenBundle = generateAiToken();
  const rawToken = tokenBundle.rawToken;
  const tokenPrefix = tokenBundle.tokenPrefix;
  const tokenHash = tokenBundle.tokenHash;

  // 3. Calculate optional expiration
  let expiresAt: string | null = null;
  if (input.expiresInDays) {
    if (input.expiresInDays <= 0 || !Number.isInteger(input.expiresInDays)) {
      throw new Error('expiresInDays must be a positive integer');
    }
    const expDate = new Date();
    expDate.setDate(expDate.getDate() + input.expiresInDays);
    expiresAt = expDate.toISOString();
  }

  // 4. Persist token hash and safe metadata
  const { data: inserted, error: insertErr } = await supabase
    .from('ai_api_tokens')
    .insert({
      workspace_id: input.workspaceId,
      client_name: trimmedName,
      name: trimmedName,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      scopes: input.scopes,
      is_revoked: false,
      created_by: input.userId,
      expires_at: expiresAt,
    })
    .select(
      'id, workspace_id, client_name, name, token_prefix, scopes, is_revoked, revoked_at, created_by, last_used_at, expires_at, created_at'
    )
    .single();

  if (insertErr || !inserted) {
    throw new Error(`Failed to create AI API token: ${insertErr?.message || 'Unknown database error'}`);
  }

  const safeMetadata: SafeTokenMetadata = {
    id: inserted.id,
    workspaceId: inserted.workspace_id,
    name: inserted.name || inserted.client_name,
    clientName: inserted.client_name,
    tokenPrefix: inserted.token_prefix,
    scopes: (inserted.scopes as ToolScope[]) || [],
    isRevoked: inserted.is_revoked,
    revokedAt: inserted.revoked_at ?? null,
    createdBy: inserted.created_by,
    lastUsedAt: inserted.last_used_at,
    expiresAt: inserted.expires_at,
    createdAt: inserted.created_at,
  };

  // 5. Record lifecycle audit event
  await logAiAuditEvent(supabase, {
    workspaceId: input.workspaceId,
    actorType: 'user',
    actorId: input.userId,
    eventType: 'token.created',
    entityType: 'ai_api_token',
    entityId: safeMetadata.id,
    details: {
      name: safeMetadata.name,
      tokenPrefix: safeMetadata.tokenPrefix,
      scopes: safeMetadata.scopes,
      expiresAt: safeMetadata.expiresAt,
    },
  });

  return {
    token: rawToken,
    tokenMetadata: safeMetadata,
  };
}

/**
 * Lists AI API tokens for an authorized workspace.
 * 
 * SECURITY INVARIANTS:
 * 1. NEVER selects or returns `token_hash` or plaintext tokens.
 * 2. Workspace members can ONLY list tokens they personally created.
 * 3. Workspace admins and owners can list all tokens in the workspace.
 * 4. Viewers are rejected.
 */
export async function listWorkspaceTokens(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  userId: string
): Promise<SafeTokenMetadata[]> {
  assertUuid(workspaceId, 'workspaceId');
  assertUuid(userId, 'userId');

  const { data: member, error: memberErr } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (memberErr || !member) {
    throw new Error('Unauthorized: You do not have access to this workspace');
  }

  if (member.role === 'viewer') {
    throw new Error('Forbidden: Viewers cannot manage or list AI API tokens');
  }

  let query = supabase
    .from('ai_api_tokens')
    .select(
      'id, workspace_id, client_name, name, token_prefix, scopes, is_revoked, revoked_at, created_by, last_used_at, expires_at, created_at'
    )
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });

  // Non-admin members may only inspect tokens they personally created
  if (member.role === 'member') {
    query = query.eq('created_by', userId);
  }

  const { data: records, error: listErr } = await query;

  if (listErr) {
    throw new Error(`Failed to list AI API tokens: ${listErr.message}`);
  }

  return (records || []).map((record) => ({
    id: record.id,
    workspaceId: record.workspace_id,
    name: record.name || record.client_name,
    clientName: record.client_name,
    tokenPrefix: record.token_prefix,
    scopes: (record.scopes as ToolScope[]) || [],
    isRevoked: record.is_revoked,
    revokedAt: record.revoked_at,
    createdBy: record.created_by,
    lastUsedAt: record.last_used_at,
    expiresAt: record.expires_at,
    createdAt: record.created_at,
  }));
}

/**
 * Retrieves safe metadata for a specific token in a workspace.
 */
export async function getTokenMetadata(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  tokenId: string,
  userId: string
): Promise<SafeTokenMetadata | null> {
  assertUuid(workspaceId, 'workspaceId');
  assertUuid(tokenId, 'tokenId');
  assertUuid(userId, 'userId');

  const { data: member, error: memberErr } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (memberErr || !member) {
    throw new Error('Unauthorized: You do not have access to this workspace');
  }

  const { data: record, error: fetchErr } = await supabase
    .from('ai_api_tokens')
    .select(
      'id, workspace_id, client_name, name, token_prefix, scopes, is_revoked, revoked_at, created_by, last_used_at, expires_at, created_at'
    )
    .eq('workspace_id', workspaceId)
    .eq('id', tokenId)
    .maybeSingle();

  if (fetchErr || !record) {
    return null;
  }

  // Non-admin members may only inspect their own token
  if (member.role === 'member' && record.created_by !== userId) {
    throw new Error('Forbidden: You do not have permission to inspect this token');
  }

  return {
    id: record.id,
    workspaceId: record.workspace_id,
    name: record.name || record.client_name,
    clientName: record.client_name,
    tokenPrefix: record.token_prefix,
    scopes: (record.scopes as ToolScope[]) || [],
    isRevoked: record.is_revoked,
    revokedAt: record.revoked_at,
    createdBy: record.created_by,
    lastUsedAt: record.last_used_at,
    expiresAt: record.expires_at,
    createdAt: record.created_at,
  };
}

/**
 * Revokes an AI API token immediately.
 * 
 * Authorization:
 * - A workspace admin or owner can revoke any token in the workspace.
 * - A regular member can ONLY revoke tokens that they created.
 * - Viewers are rejected.
 */
export async function revokeAiToken(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  tokenId: string,
  userId: string
): Promise<{ success: boolean }> {
  assertUuid(workspaceId, 'workspaceId');
  assertUuid(tokenId, 'tokenId');
  assertUuid(userId, 'userId');

  // 1. Authorize workspace membership
  const { data: member, error: memberErr } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (memberErr || !member) {
    throw new Error('Unauthorized: You do not have access to this workspace');
  }

  if (member.role === 'viewer') {
    throw new Error('Forbidden: Viewers are not permitted to revoke AI API tokens');
  }

  // 2. Fetch target token to verify ownership and existence
  const { data: targetToken, error: tokenErr } = await supabase
    .from('ai_api_tokens')
    .select('id, workspace_id, created_by, is_revoked, name, client_name')
    .eq('workspace_id', workspaceId)
    .eq('id', tokenId)
    .maybeSingle();

  if (tokenErr || !targetToken) {
    throw new Error('Token not found');
  }

  // 3. Check authorization: member can only revoke own token
  const isPrivileged = member.role === 'owner' || member.role === 'admin';
  const isCreator = targetToken.created_by === userId;

  if (!isPrivileged && !isCreator) {
    throw new Error('Forbidden: You do not have permission to revoke another user\'s token');
  }

  if (targetToken.is_revoked) {
    return { success: true };
  }

  const nowIso = new Date().toISOString();

  // 4. Set is_revoked = true and record revoked_at
  const { error: updateErr } = await supabase
    .from('ai_api_tokens')
    .update({
      is_revoked: true,
      revoked_at: nowIso,
    })
    .eq('id', tokenId)
    .eq('workspace_id', workspaceId);

  if (updateErr) {
    throw new Error(`Failed to revoke token: ${updateErr.message}`);
  }

  // 5. Record lifecycle audit event
  await logAiAuditEvent(supabase, {
    workspaceId,
    actorType: 'user',
    actorId: userId,
    eventType: 'token.revoked',
    entityType: 'ai_api_token',
    entityId: tokenId,
    details: {
      name: targetToken.name || targetToken.client_name,
      revokedBy: userId,
      revokedAt: nowIso,
    },
  });

  return { success: true };
}

/**
 * Updates last_used_at timestamp asynchronously in non-blocking fashion.
 */
export async function updateTokenLastUsed(
  supabase: SupabaseClient<Database>,
  tokenId: string
): Promise<void> {
  try {
    await supabase
      .from('ai_api_tokens')
      .update({
        last_used_at: new Date().toISOString(),
      })
      .eq('id', tokenId);
  } catch (err) {
    console.warn('[AI Token Warning] Non-fatal failure updating token last_used_at:', err);
  }
}
