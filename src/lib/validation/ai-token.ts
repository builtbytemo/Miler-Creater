import { z } from 'zod';
import type { ToolScope } from '@/lib/mcp/types';
import type { SafeTokenMetadata } from '@/lib/mcp/token-service';

/**
 * Authoritative tool scopes supported by the backend token service and MCP dispatcher.
 */
export const SUPPORTED_AI_TOKEN_SCOPES: readonly ToolScope[] = [
  'task:read',
  'task:write',
  'content:read',
  'content:write',
] as const;

export const aiTokenScopeEnum = z.enum([
  'task:read',
  'task:write',
  'content:read',
  'content:write',
]);

export interface AiTokenScopeDescriptor {
  scope: ToolScope;
  label: string;
  category: 'read' | 'write';
  domain: 'tasks' | 'content';
  description: string;
  tools: string[];
}

/**
 * Human-readable metadata for each supported scope, mapping directly to the
 * 14 registered MCP tools in src/lib/mcp/dispatcher.ts.
 */
export const AI_TOKEN_SCOPE_DETAILS: readonly AiTokenScopeDescriptor[] = [
  {
    scope: 'task:read',
    label: 'Read Tasks',
    category: 'read',
    domain: 'tasks',
    description:
      'Search workspace tasks, inspect task details & subtasks, list overdue tasks, and read workspace task summaries.',
    tools: ['search_tasks', 'get_task_details', 'list_overdue_tasks', 'get_workspace_summary'],
  },
  {
    scope: 'task:write',
    label: 'Write Tasks',
    category: 'write',
    domain: 'tasks',
    description:
      'Create new tasks, update task fields, transition task status, and reschedule task dates.',
    tools: ['create_task', 'update_task', 'change_task_status', 'reschedule_task'],
  },
  {
    scope: 'content:read',
    label: 'Read Content',
    category: 'read',
    domain: 'content',
    description:
      'Search social content items, inspect post details, list scheduled content, and read workspace content summaries.',
    tools: [
      'search_content',
      'get_content_details',
      'list_scheduled_content',
      'get_workspace_summary',
    ],
  },
  {
    scope: 'content:write',
    label: 'Write Content',
    category: 'write',
    domain: 'content',
    description:
      'Create new social content ideas or drafts, update content bodies & metadata, and schedule or reschedule posts.',
    tools: ['create_content_item', 'update_content_item', 'reschedule_content'],
  },
] as const;

export interface AiTokenExpirationPreset {
  label: string;
  /** Number of days until expiration, or null for no expiration */
  days: number | null;
}

/**
 * Standard expiration presets supported by createAiToken (expiresInDays?: number).
 */
export const AI_TOKEN_EXPIRATION_PRESETS: readonly AiTokenExpirationPreset[] = [
  { label: '7 days', days: 7 },
  { label: '30 days (Recommended)', days: 30 },
  { label: '60 days', days: 60 },
  { label: '90 days', days: 90 },
  { label: '180 days', days: 180 },
  { label: '1 year (365 days)', days: 365 },
  { label: 'No expiration', days: null },
] as const;

export const createAiTokenSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Token name is required')
    .max(100, 'Token name cannot exceed 100 characters'),
  scopes: z
    .array(aiTokenScopeEnum)
    .min(1, 'At least one permission scope must be selected')
    .transform((scopes) => Array.from(new Set(scopes)) as ToolScope[]),
  expiresInDays: z
    .number()
    .int('Expiration must be a whole number of days')
    .min(1, 'Expiration must be at least 1 day')
    .max(3650, 'Expiration cannot exceed 3,650 days (10 years)')
    .optional()
    .nullable(),
});

export const revokeAiTokenSchema = z.object({
  tokenId: z.string().uuid('Invalid token ID format'),
});

export type CreateAiTokenSchemaInput = z.input<typeof createAiTokenSchema>;
export type CreateAiTokenSchemaOutput = z.output<typeof createAiTokenSchema>;
export type RevokeAiTokenSchemaInput = z.input<typeof revokeAiTokenSchema>;

export type TokenLifecycleStatus = 'active' | 'revoked' | 'expired';

/**
 * Computes the current lifecycle state of a token from its safe metadata.
 */
export function getTokenLifecycleStatus(
  token: Pick<SafeTokenMetadata, 'isRevoked' | 'expiresAt'>,
  referenceTime: Date = new Date()
): TokenLifecycleStatus {
  if (token.isRevoked) {
    return 'revoked';
  }
  if (token.expiresAt) {
    const expMs = new Date(token.expiresAt).getTime();
    if (!Number.isNaN(expMs) && expMs <= referenceTime.getTime()) {
      return 'expired';
    }
  }
  return 'active';
}
