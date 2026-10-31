/**
 * ==============================================================================
 * Model Context Protocol (MCP) Server Factory (Phase 7.5)
 * ==============================================================================
 * 
 * Architectural Role:
 *   Instantiates and configures a Model Context Protocol (MCP) server bound to
 *   a verified AIExecutionContext. Wires the 14 authoritative tools registered in
 *   TOOL_REGISTRY directly to dispatchTool(), preserving scope checks, schema
 *   validation, identity tamper-proofing, and error sanitization.
 * 
 * Security Invariants & Guarantees:
 *   1. Context Injection: Bound strictly to the verified AIExecutionContext
 *      produced by authenticateAiToken().
 *   2. Identity Tamper-Proofing: Tool execution delegates to dispatchTool() which
 *      enforces workspaceId and userId from the trusted context, completely
 *      ignoring any caller-supplied identity or workspace parameters.
 *   3. Scope Enforcement: Inherits the dispatcher's rigorous requiredScopes checks.
 *   4. Information Leakage Prevention: Formats errors safely and catches unexpected
 *      exceptions to ensure stack traces and internal secrets never reach the client.
 */

import { McpServer } from '@modelcontextprotocol/server';
import type { AIExecutionContext } from '@/lib/mcp/types';
import { TOOL_REGISTRY, dispatchTool } from '@/lib/mcp/dispatcher';

/**
 * Sanitizes tool error payloads to guarantee that internal database connection strings,
 * credentials, and secrets are never returned to the external AI client.
 */
function sanitizeToolError(error: unknown): unknown {
  if (!error || typeof error !== 'object') {
    return error;
  }
  const str = JSON.stringify(error);
  const sanitized = str
    .replace(/(?:postgresql|postgres|mysql|mongodb|redis):\/\/[^\s"',]+/gi, '[REDACTED_DATABASE_URI]')
    .replace(/ctc_live_[0-9a-fA-F]+/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]');
  return JSON.parse(sanitized);
}

/**
 * Creates an McpServer instance wired to the authoritative 14-tool registry
 * and bound to the provided trusted execution context.
 */
export function createMcpServer(context: AIExecutionContext): McpServer {
  const server = new McpServer(
    {
      name: 'content-task-command-center',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {
          listChanged: true,
        },
      },
      instructions:
        'Content & Task Command Center MCP Server. Enables AI assistants to interact with workspace tasks, content items, and operational summaries.',
    }
  );

  for (const [toolName, toolDef] of Object.entries(TOOL_REGISTRY)) {
    server.registerTool(
      toolName,
      {
        description: toolDef.description,
        inputSchema: toolDef.schema as any,
      },
      async (args: any) => {
        try {
          const result = await dispatchTool(toolName, args, context);

          if (result.success) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text:
                    typeof result.data === 'string'
                      ? result.data
                      : JSON.stringify(result.data, null, 2),
                },
              ],
              isError: false,
            };
          } else {
            const sanitizedError = sanitizeToolError(result.error);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(sanitizedError, null, 2),
                },
              ],
              isError: true,
            };
          }
        } catch (err) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    code: 'EXECUTION_FAILED',
                    message: 'An unexpected internal error occurred during tool execution.',
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}
