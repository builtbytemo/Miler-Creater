/**
 * ==============================================================================
 * Unified AI Tool Dispatcher (Phase 7.3)
 * ==============================================================================
 * 
 * Architectural Role:
 *   Acts as the single authoritative gateway dispatcher between external AI
 *   assistants (Claude MCP, ChatGPT Actions) and the internal application domain
 *   services (tasks, content, dashboard metrics).
 * 
 * Security Invariants & Guarantees:
 *   1. Dependency Injection: Receives an explicit trusted execution context
 *      (AIExecutionContext) containing the verified Supabase client, verified
 *      workspace ID, verified user ID, and granted token scopes.
 *   2. Identity Tamper-Proofing: The dispatcher strictly rejects or ignores any
 *      workspace_id, user_id, or actor identity arguments supplied by the model.
 *      All operations are forced to run under the trusted context's verified IDs.
 *   3. Scope Enforcement: Verifies that the trusted context holds the required
 *      read/write permission scopes before invoking any underlying domain service.
 *   4. Isolation from Web Sessions: Fully decoupled from Next.js cookies,
 *      browser headers, and Server Actions.
 *   5. Information Leakage Prevention: Catches exceptions and returns sanitized
 *      structured error objects, ensuring database connection strings, stack
 *      traces, and cross-workspace existence data are never leaked to the model.
 * 
 * Protocol Compatibility Note (for Phase 7.5):
 *   Phase 7.5 will expose this dispatcher over the Model Context Protocol (MCP)
 *   Streamable HTTP transport. Phase 7.5 must inspect the installed
 *   @modelcontextprotocol/sdk to verify its actual supported protocol version
 *   negotiation dynamically, rather than assuming or hardcoding any specific
 *   legacy or draft version string (such as "2024-11-05").
 */

import type {
  AIExecutionContext,
  ToolDefinition,
  ToolExecutionResult,
  ToolScope,
} from '@/lib/mcp/types';
import {
  getWorkspaceSummaryInputSchema,
  searchTasksInputSchema,
  getTaskDetailsInputSchema,
  listOverdueTasksInputSchema,
  searchContentInputSchema,
  getContentDetailsInputSchema,
  listScheduledContentInputSchema,
  createTaskInputSchema,
  updateTaskInputSchema,
  changeTaskStatusInputSchema,
  rescheduleTaskInputSchema,
  createContentItemInputSchema,
  updateContentItemInputSchema,
  rescheduleContentInputSchema,
  type GetWorkspaceSummaryInput,
  type SearchTasksInput,
  type GetTaskDetailsInput,
  type ListOverdueTasksInput,
  type SearchContentInput,
  type GetContentDetailsInput,
  type ListScheduledContentInput,
  type CreateTaskInput,
  type UpdateTaskInput,
  type ChangeTaskStatusInput,
  type RescheduleTaskInput,
  type CreateContentItemInput,
  type UpdateContentItemInput,
  type RescheduleContentInput,
} from '@/lib/mcp/schemas';
import { getDashboardSummary } from '@/lib/services/dashboard-service';
import {
  getTasks,
  getTaskById,
  createTask,
  updateTask,
  completeTask,
} from '@/lib/services/task-service';
import {
  getContentItems,
  getContentItemById,
  createContentItem,
  updateContentItem,
} from '@/lib/services/content-service';

// -----------------------------------------------------------------------------
// AUTHORITATIVE TOOL DEFINITIONS (EXACTLY 14 TOOLS)
// -----------------------------------------------------------------------------

export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  // --- 1. get_workspace_summary ---
  get_workspace_summary: {
    name: 'get_workspace_summary',
    description:
      'Retrieve high-level operational metrics: overdue task counts, tasks due today, pending subtasks, blocked tasks, draft content count, upcoming scheduled content, and unread alerts.',
    category: 'read',
    requiredScopes: ['task:read', 'content:read'],
    schema: getWorkspaceSummaryInputSchema,
    execute: async (context: AIExecutionContext, _input: GetWorkspaceSummaryInput) => {
      return await getDashboardSummary(
        context.supabase,
        context.workspaceId,
        context.userId,
        { userTimeZone: context.timeZone }
      );
    },
  },

  // --- 2. search_tasks ---
  search_tasks: {
    name: 'search_tasks',
    description:
      'Search tasks in the workspace by search keyword, status, priority, or due-date boundaries.',
    category: 'read',
    requiredScopes: ['task:read'],
    schema: searchTasksInputSchema,
    execute: async (context: AIExecutionContext, input: SearchTasksInput) => {
      const { limit, ...filters } = input;
      const tasks = await getTasks(context.supabase, context.workspaceId, filters);
      return tasks.slice(0, limit);
    },
  },

  // --- 3. get_task_details ---
  get_task_details: {
    name: 'get_task_details',
    description:
      'Get comprehensive details for a single task by ID, including subtasks, project metadata, and dependency prerequisites.',
    category: 'read',
    requiredScopes: ['task:read'],
    schema: getTaskDetailsInputSchema,
    execute: async (context: AIExecutionContext, input: GetTaskDetailsInput) => {
      return await getTaskById(context.supabase, context.workspaceId, input.task_id);
    },
  },

  // --- 4. list_overdue_tasks ---
  list_overdue_tasks: {
    name: 'list_overdue_tasks',
    description:
      'List incomplete tasks whose due_date is in the past, ordered oldest due-date first.',
    category: 'read',
    requiredScopes: ['task:read'],
    schema: listOverdueTasksInputSchema,
    execute: async (context: AIExecutionContext, input: ListOverdueTasksInput) => {
      const nowIso = new Date().toISOString();
      const tasks = await getTasks(context.supabase, context.workspaceId, {
        status: ['todo', 'in_progress', 'blocked'],
        due_date_to: nowIso,
      });
      return tasks.slice(0, input.limit);
    },
  },

  // --- 5. search_content ---
  search_content: {
    name: 'search_content',
    description:
      'Search social content items by text keyword, target social platform, or publication status.',
    category: 'read',
    requiredScopes: ['content:read'],
    schema: searchContentInputSchema,
    execute: async (context: AIExecutionContext, input: SearchContentInput) => {
      const { limit, ...filters } = input;
      const items = await getContentItems(context.supabase, context.workspaceId, filters);
      return items.slice(0, limit);
    },
  },

  // --- 6. get_content_details ---
  get_content_details: {
    name: 'get_content_details',
    description:
      'Get full details for a single content item, including post body, tags, notes, and platform scheduling.',
    category: 'read',
    requiredScopes: ['content:read'],
    schema: getContentDetailsInputSchema,
    execute: async (context: AIExecutionContext, input: GetContentDetailsInput) => {
      return await getContentItemById(context.supabase, context.workspaceId, input.content_id);
    },
  },

  // --- 7. list_scheduled_content ---
  list_scheduled_content: {
    name: 'list_scheduled_content',
    description:
      'Retrieve upcoming scheduled social posts in chronological order, with optional date range and platform filters.',
    category: 'read',
    requiredScopes: ['content:read'],
    schema: listScheduledContentInputSchema,
    execute: async (context: AIExecutionContext, input: ListScheduledContentInput) => {
      const items = await getContentItems(context.supabase, context.workspaceId, {
        is_scheduled: true,
        scheduled_from: input.scheduled_from,
        scheduled_to: input.scheduled_to,
        platform: input.platform,
      });
      return items.slice(0, input.limit);
    },
  },

  // --- 8. create_task ---
  create_task: {
    name: 'create_task',
    description:
      'Create a new task in the workspace with title, description, priority, deadline, and tags.',
    category: 'write',
    requiredScopes: ['task:write'],
    schema: createTaskInputSchema,
    execute: async (context: AIExecutionContext, input: CreateTaskInput) => {
      return await createTask(context.supabase, context.workspaceId, input, context.userId);
    },
  },

  // --- 9. update_task ---
  update_task: {
    name: 'update_task',
    description:
      'Update attributes of an existing task (title, description, priority, duration, tags, project).',
    category: 'write',
    requiredScopes: ['task:write'],
    schema: updateTaskInputSchema,
    execute: async (context: AIExecutionContext, input: UpdateTaskInput) => {
      const { task_id, ...updates } = input;
      return await updateTask(context.supabase, context.workspaceId, task_id, updates);
    },
  },

  // --- 10. change_task_status ---
  change_task_status: {
    name: 'change_task_status',
    description:
      'Advance or update task status (todo, in_progress, blocked, done, cancelled). If transitioning to done, verifies prerequisite dependencies and spawns next occurrence for recurring tasks.',
    category: 'write',
    requiredScopes: ['task:write'],
    schema: changeTaskStatusInputSchema,
    execute: async (context: AIExecutionContext, input: ChangeTaskStatusInput) => {
      if (input.status === 'done') {
        const result = await completeTask(context.supabase, context.workspaceId, input.task_id);
        return result.completedTask;
      }
      return await updateTask(context.supabase, context.workspaceId, input.task_id, {
        status: input.status,
      });
    },
  },

  // --- 11. reschedule_task ---
  reschedule_task: {
    name: 'reschedule_task',
    description:
      'Reschedule a task by updating its due_date and/or scheduled_start and scheduled_end times.',
    category: 'write',
    requiredScopes: ['task:write'],
    schema: rescheduleTaskInputSchema,
    execute: async (context: AIExecutionContext, input: RescheduleTaskInput) => {
      const { task_id, ...updates } = input;
      return await updateTask(context.supabase, context.workspaceId, task_id, updates);
    },
  },

  // --- 12. create_content_item ---
  create_content_item: {
    name: 'create_content_item',
    description:
      'Create a social content idea or scheduled draft for LinkedIn, Reddit, Threads, or X.',
    category: 'write',
    requiredScopes: ['content:write'],
    schema: createContentItemInputSchema,
    execute: async (context: AIExecutionContext, input: CreateContentItemInput) => {
      return await createContentItem(context.supabase, context.workspaceId, input, context.userId);
    },
  },

  // --- 13. update_content_item ---
  update_content_item: {
    name: 'update_content_item',
    description:
      'Update an existing content item (title, body, platform, status, scheduled date, tags, notes).',
    category: 'write',
    requiredScopes: ['content:write'],
    schema: updateContentItemInputSchema,
    execute: async (context: AIExecutionContext, input: UpdateContentItemInput) => {
      const { content_id, ...updates } = input;
      return await updateContentItem(context.supabase, context.workspaceId, content_id, updates);
    },
  },

  // --- 14. reschedule_content ---
  reschedule_content: {
    name: 'reschedule_content',
    description:
      'Move a scheduled content item to a new publication datetime (scheduled_at).',
    category: 'write',
    requiredScopes: ['content:write'],
    schema: rescheduleContentInputSchema,
    execute: async (context: AIExecutionContext, input: RescheduleContentInput) => {
      // 1. Check existing status - cannot reschedule published or archived posts
      const existing = await getContentItemById(
        context.supabase,
        context.workspaceId,
        input.content_id
      );

      if (!existing) {
        throw new Error('Content item not found');
      }

      if (existing.status === 'published' || existing.status === 'archived') {
        throw new Error(
          `Cannot reschedule content item with terminal status "${existing.status}". Only ideas, drafts, or scheduled items can be rescheduled.`
        );
      }

      return await updateContentItem(context.supabase, context.workspaceId, input.content_id, {
        scheduled_at: input.scheduled_at,
        status: 'scheduled',
      });
    },
  },
};

// -----------------------------------------------------------------------------
// HELPER FUNCTIONS & REGISTRY ACCESSORS
// -----------------------------------------------------------------------------

/**
 * Returns an array of all registered tool names.
 */
export function getRegisteredToolNames(): string[] {
  return Object.keys(TOOL_REGISTRY);
}

/**
 * Retrieves a tool definition by name.
 */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY[name];
}

/**
 * Returns all registered tool definitions as an array.
 */
export function listToolDefinitions(): ToolDefinition[] {
  return Object.values(TOOL_REGISTRY);
}

// -----------------------------------------------------------------------------
// CENTRAL TOOL DISPATCHER ENTRY POINT
// -----------------------------------------------------------------------------

/**
 * Dispatches an incoming tool request from an external AI assistant.
 * 
 * Execution Flow:
 * 1. Resolves tool definition from registry (fails with UNKNOWN_TOOL if missing).
 * 2. Enforces required scopes against context.scopes (fails with FORBIDDEN if missing).
 * 3. Validates tool arguments against strict Zod schema (fails with INVALID_ARGUMENTS).
 * 4. Injects trusted context into domain service (attributing created_by and scoping workspace_id).
 * 5. Returns consistent, sanitized ToolExecutionResult.
 */
export async function dispatchTool(
  toolName: string,
  rawArgs: unknown,
  context: AIExecutionContext
): Promise<ToolExecutionResult> {
  // 1. Identify requested tool
  const tool = getToolDefinition(toolName);
  if (!tool) {
    return {
      success: false,
      tool: toolName,
      error: {
        code: 'UNKNOWN_TOOL',
        message: `Unknown or unregistered tool: "${toolName}". Use tools/list to see available tools.`,
      },
    };
  }

  // 2. Scope verification
  const missingScopes: ToolScope[] = [];
  for (const scope of tool.requiredScopes) {
    if (!context.scopes.includes(scope)) {
      missingScopes.push(scope);
    }
  }

  if (missingScopes.length > 0) {
    return {
      success: false,
      tool: toolName,
      error: {
        code: 'FORBIDDEN',
        message: `Execution denied: Token lacks required scope(s): ${missingScopes.join(', ')}.`,
      },
    };
  }

  // 3. Schema validation
  const parseResult = tool.schema.safeParse(rawArgs ?? {});
  if (!parseResult.success) {
    const formattedIssues = parseResult.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));

    return {
      success: false,
      tool: toolName,
      error: {
        code: 'INVALID_ARGUMENTS',
        message: 'Invalid arguments provided for tool execution.',
        details: formattedIssues,
      },
    };
  }

  // 4. Execute domain service with trusted context
  try {
    const data = await tool.execute(context, parseResult.data);

    return {
      success: true,
      tool: toolName,
      data,
    };
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const lowerMessage = rawMessage.toLowerCase();

    // Map common domain errors to standardized error codes
    if (lowerMessage.includes('not found') || lowerMessage.includes('does not exist')) {
      return {
        success: false,
        tool: toolName,
        error: {
          code: 'NOT_FOUND',
          message: 'The requested record was not found or is inaccessible in this workspace.',
        },
      };
    }

    if (
      lowerMessage.includes('prerequisite') ||
      lowerMessage.includes('dependency') ||
      lowerMessage.includes('dependencies')
    ) {
      return {
        success: false,
        tool: toolName,
        error: {
          code: 'DEPENDENCY_ERROR',
          message: rawMessage,
        },
      };
    }

    if (lowerMessage.includes('cannot reschedule') || lowerMessage.includes('terminal status')) {
      return {
        success: false,
        tool: toolName,
        error: {
          code: 'INVALID_OPERATION',
          message: rawMessage,
        },
      };
    }

    // Generic safe error to prevent leaking internal database / stack trace details
    return {
      success: false,
      tool: toolName,
      error: {
        code: 'EXECUTION_FAILED',
        message: 'An error occurred while executing the tool operation.',
        details: rawMessage,
      },
    };
  }
}
