import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, AuditActorType, Json } from '@/types/database';

export type AiAuditEventType =
  | 'token.created'
  | 'token.revoked'
  | 'token.auth_failed'
  | 'tool.executed';

export interface LogAiAuditEventOptions {
  /** Workspace ID if known and verified, or null for unbound gateway auth failures */
  workspaceId: string | null;
  actorType: AuditActorType;
  actorId: string;
  eventType: AiAuditEventType;
  entityType: 'ai_api_token' | 'tool_execution' | 'workspace';
  entityId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const SENSITIVE_KEY_PATTERN = /(?:token|raw_?token|token_?hash|hash|secret|password|auth(?:orization)?|key|bearer|credential|api_?key)/i;
const TOKEN_VALUE_PATTERN = /ctc_live_[0-9a-fA-F]+/g;
const BEARER_HEADER_PATTERN = /Bearer\s+[A-Za-z0-9_\-\.]+/gi;

/**
 * Sanitizes arbitrary string values to prevent credentials from leaking through error messages,
 * URLs, or structured text fields.
 */
function sanitizeStringValue(val: string): string {
  return val
    .replace(TOKEN_VALUE_PATTERN, '[REDACTED_TOKEN]')
    .replace(BEARER_HEADER_PATTERN, 'Bearer [REDACTED]');
}

/**
 * Recursively sanitizes audit event details to guarantee that plaintext tokens,
 * token hashes, passwords, and sensitive credentials can NEVER be leaked to
 * the immutable audit ledger.
 * 
 * Redaction Rules:
 * 1. Any key matching sensitive patterns has its value completely replaced with '[REDACTED]'.
 * 2. Any string value containing token signatures ('ctc_live_...') or bearer auth headers has
 *    the secret fragment stripped and replaced with '[REDACTED_TOKEN]' or 'Bearer [REDACTED]'.
 * 3. Nested objects and arrays are traversed recursively.
 */
export function sanitizeAuditDetails(details?: Record<string, unknown>): Record<string, unknown> {
  if (!details || typeof details !== 'object') {
    return {};
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      sanitized[key] = sanitizeStringValue(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeAuditDetails(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) => {
        if (typeof item === 'string') {
          return sanitizeStringValue(item);
        }
        if (item && typeof item === 'object') {
          return sanitizeAuditDetails(item as Record<string, unknown>);
        }
        return item;
      });
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Records an AI security, lifecycle, or tool execution audit event into `public.audit_events`.
 * 
 * ARCHITECTURAL DESIGN & AVAILABILITY TRADE-OFF:
 * - This function operates in a non-blocking ("best-effort") pattern. If writing to the
 *   audit table fails (e.g. transient database lock or timeout), it logs a warning rather
 *   than throwing a fatal exception to the caller.
 * - Trade-off: Primary user transactions and tool dispatches will not abort if the audit
 *   subsystem experiences a transient write failure; however, audit records are not
 *   strictly guaranteed to survive a database partition or catastrophic storage failure.
 *   For mission-critical audit trails, synchronous transactional audit insertion can be
 *   configured where required.
 */
export async function logAiAuditEvent(
  supabase: SupabaseClient<Database>,
  options: LogAiAuditEventOptions
): Promise<void> {
  try {
    const cleanDetails = sanitizeAuditDetails(options.details);

    const { error } = await supabase.from('audit_events').insert({
      workspace_id: options.workspaceId,
      actor_type: options.actorType,
      actor_id: options.actorId,
      event_type: options.eventType,
      entity_type: options.entityType,
      entity_id: options.entityId || null,
      details: cleanDetails as Json,
      ip_address: options.ipAddress || null,
      user_agent: options.userAgent || null,
    });

    if (error) {
      console.warn('[AI Audit Warning] Non-fatal failure logging audit event:', error.message);
    }
  } catch (err) {
    console.warn('[AI Audit Warning] Non-fatal exception logging audit event:', err);
  }
}
