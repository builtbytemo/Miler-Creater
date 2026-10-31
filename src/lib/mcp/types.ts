import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { z } from 'zod';

/**
 * Tool domain category classification.
 */
export type ToolCategory = 'read' | 'write';

/**
 * Standard granular scopes required for tool execution.
 * Matched against the verified `scopes` array in the execution context.
 */
export type ToolScope = 'task:read' | 'task:write' | 'content:read' | 'content:write';

/**
 * Standard error codes returned by the tool dispatcher.
 */
export type ToolErrorCode =
  | 'UNKNOWN_TOOL'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_ARGUMENTS'
  | 'NOT_FOUND'
  | 'DEPENDENCY_ERROR'
  | 'INVALID_OPERATION'
  | 'RATE_LIMIT_EXCEEDED'
  | 'EXECUTION_FAILED';

/**
 * Trusted execution context supplied by the API gateway/server.
 * 
 * SECURITY INVARIANT:
 * The dispatcher and tools must NEVER accept or trust workspace, user,
 * or actor identifiers from tool arguments supplied by the AI model.
 * All operations must use the verified identifiers injected into this context.
 */
export interface AIExecutionContext {
  /** Authenticated Supabase client passed from the gateway */
  supabase: SupabaseClient<Database>;
  /** Verified workspace ID bound to the authenticated token */
  workspaceId: string;
  /** Verified user ID of the token owner */
  userId: string;
  /** Token ID or actor identifier for audit ledger attribution */
  actorId: string;
  /** Granular permission scopes granted to the authenticated token */
  scopes: string[];
  /** Optional user timezone string (e.g. 'America/New_York', defaults to 'Asia/Cairo' / 'Africa/Cairo') */
  timeZone?: string;
}

/**
 * Structured error details returned upon tool failure.
 */
export interface ToolError {
  code: ToolErrorCode;
  message: string;
  details?: unknown;
}

/**
 * Consistent structured response returned by the tool dispatcher.
 */
export interface ToolExecutionResult<T = unknown> {
  success: boolean;
  tool: string;
  data?: T;
  error?: ToolError;
}

/**
 * Type definition for a registered MCP tool.
 */
export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  category: ToolCategory;
  requiredScopes: ToolScope[];
  schema: z.ZodType<TInput>;
  execute: (context: AIExecutionContext, input: TInput) => Promise<TOutput>;
}
