import crypto from 'crypto';

export const VALID_AI_SCOPES = [
  'content:read',
  'content:write',
  'task:read',
  'task:write',
  'calendar:read',
  'calendar:reschedule',
  'action:confirm_required',
] as const;

export type AiScope = (typeof VALID_AI_SCOPES)[number];

export const HIGH_RISK_OPERATIONS = [
  'delete_content',
  'delete_task',
  'bulk_reschedule',
  'revoke_token',
  'transfer_workspace',
] as const;

export interface GeneratedAiToken {
  /** The plaintext token shown ONCE to the user upon generation. Never stored in DB. */
  rawToken: string;
  /** Visible prefix for identification in management UI. */
  tokenPrefix: string;
  /** SHA-256 hash to be persisted in public.ai_api_tokens. */
  tokenHash: string;
}

/**
 * Generates a cryptographically secure AI client token.
 * Follows industry best practices:
 * - 256 bits of entropy
 * - 'ctc_live_' prefix for secret scanners
 * - Only SHA-256 hash is stored in database
 */
export function generateAiToken(): GeneratedAiToken {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  const rawToken = `ctc_live_${randomBytes}`;
  const tokenPrefix = `ctc_live_${randomBytes.substring(0, 8)}`;
  const tokenHash = hashAiToken(rawToken);

  return {
    rawToken,
    tokenPrefix,
    tokenHash,
  };
}

/**
 * Computes the SHA-256 hash of a raw token for database lookup.
 */
export function hashAiToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Validates that an array of scopes only contains known, valid scopes.
 */
export function validateScopes(scopes: string[]): boolean {
  if (!Array.isArray(scopes) || scopes.length === 0) return false;
  return scopes.every((s) => (VALID_AI_SCOPES as readonly string[]).includes(s));
}

/**
 * Verifies whether a token's granted scopes satisfy a required operation scope.
 */
export function hasRequiredScope(grantedScopes: string[], requiredScope: AiScope): boolean {
  if (!grantedScopes || !Array.isArray(grantedScopes)) return false;
  return grantedScopes.includes(requiredScope);
}

/**
 * Determines whether an AI operation must be intercepted for explicit human confirmation.
 * Enforces server-side guardrails regardless of client request headers.
 */
export function requiresUserConfirmation(operation: string, grantedScopes: string[] = []): boolean {
  // 1. Destructive operations ALWAYS require confirmation
  if ((HIGH_RISK_OPERATIONS as readonly string[]).includes(operation)) {
    return true;
  }

  // 2. If token is marked with 'action:confirm_required', all mutations require confirmation
  if (grantedScopes.includes('action:confirm_required') && !operation.endsWith(':read') && !operation.startsWith('get_') && !operation.startsWith('list_') && !operation.startsWith('search_')) {
    return true;
  }

  return false;
}
