/**
 * ==============================================================================
 * Model Context Protocol (MCP) HTTP Gateway Integration Tests (Phase 7.5.1)
 * ==============================================================================
 * 
 * Verifies the stateless Streamable HTTP gateway (/api/mcp) under the modern
 * 2026-07-28 protocol specification:
 * 1. Current protocol version (2026-07-28) is supported.
 * 2. A request using the current protocol works without the old initialization handshake.
 * 3. No protocol-level session is created or required.
 * 4. POST tool discovery works.
 * 5. POST tool execution works.
 * 6. All 14 tools remain available.
 * 7. Authentication runs on every request.
 * 8. Invalid, expired, revoked, and rate-limited tokens remain rejected.
 * 9. Trusted workspace and user context reaches the dispatcher.
 * 10. Client-supplied identity cannot override trusted context.
 * 11. Invalid protocol versions are rejected correctly.
 * 12. Required protocol headers and metadata are validated.
 * 13. Invalid origins are rejected.
 * 14. Request size limits remain enforced.
 * 15. Errors remain sanitized.
 * 16. Unsupported legacy HTTP methods are rejected correctly.
 * 17. Notifications follow the new protocol behavior.
 * 18. Official MCP Client connects and operates successfully.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AIExecutionContext } from '@/lib/mcp/types';
import {
  POST,
  GET,
  DELETE,
  OPTIONS,
  PUT,
  PATCH,
  validateHostHeaderSyntax,
  sanitizeAllowedHostname,
  getAllowedHostnames,
} from '@/app/api/mcp/route';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  PROTOCOL_VERSION_META_KEY,
  CLIENT_CAPABILITIES_META_KEY,
} from '@modelcontextprotocol/server';

// Mock auth module
vi.mock('@/lib/mcp/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mcp/auth')>();
  return {
    ...actual,
    authenticateAiToken: vi.fn(),
  };
});

// Mock domain services
vi.mock('@/lib/services/task-service', () => ({
  getTasks: vi.fn(),
  getTaskById: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
}));

vi.mock('@/lib/services/content-service', () => ({
  getContentItems: vi.fn(),
  getContentItemById: vi.fn(),
  createContentItem: vi.fn(),
  updateContentItem: vi.fn(),
}));

vi.mock('@/lib/services/dashboard-service', () => ({
  getDashboardSummary: vi.fn(),
}));

import { authenticateAiToken } from '@/lib/mcp/auth';
import { getTasks, createTask } from '@/lib/services/task-service';
import { getDashboardSummary } from '@/lib/services/dashboard-service';

describe('MCP Streamable HTTP Gateway (/api/mcp) — Modern 2026-07-28 Protocol', () => {
  const trustedWorkspaceId = '11111111-1111-4111-8111-111111111111';
  const trustedUserId = '22222222-2222-4222-8222-222222222222';
  const validToken = 'ctc_live_' + 'a'.repeat(64);
  const MODERN_PROTOCOL_VERSION = '2026-07-28';

  const mockContext: AIExecutionContext = {
    workspaceId: trustedWorkspaceId,
    userId: trustedUserId,
    actorId: '33333333-3333-4333-8333-333333333333',
    scopes: ['task:read', 'task:write', 'content:read', 'content:write'],
    supabase: {} as any,
    timeZone: 'UTC',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateAiToken).mockResolvedValue({
      success: true,
      context: mockContext,
    });
  });

  // Helper to construct conformant 2026-07-28 Streamable HTTP POST requests
  function createModernRequest(
    method: string,
    bodyData: { id?: number | string | null; params?: Record<string, any> } = {},
    customHeaders: Record<string, string> = {}
  ): Request {
    const isNotification = bodyData.id === undefined || bodyData.id === null;
    const body: Record<string, any> = {
      jsonrpc: '2.0',
      method,
    };
    if (!isNotification) {
      body.id = bodyData.id;
    }

    body.params = {
      ...bodyData.params,
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
        [CLIENT_CAPABILITIES_META_KEY]: {},
        ...bodyData.params?._meta,
      },
    };

    const headers: Record<string, string> = {
      host: 'localhost:3000',
      authorization: `Bearer ${validToken}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MODERN_PROTOCOL_VERSION,
      'mcp-method': method,
      ...customHeaders,
    };

    if (bodyData.params?.name && !headers['mcp-name']) {
      headers['mcp-name'] = bodyData.params.name;
    }

    for (const [k, v] of Object.entries(customHeaders)) {
      if (v === undefined) {
        delete headers[k];
      }
    }

    return new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  // Helper to parse SSE or direct JSON response
  async function parseResponsePayload(res: Response): Promise<any> {
    const text = await res.text();
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return JSON.parse(text);
    }
    // Parse SSE lines: data: {...}
    const match = text.match(/^data:\s*(.+)$/m);
    if (match) {
      return JSON.parse(match[1]);
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // ---------------------------------------------------------------------------
  // 1. CURRENT PROTOCOL VERSION IS SUPPORTED
  // ---------------------------------------------------------------------------
  it('1. current protocol version (2026-07-28) is supported via server/discover and requests', async () => {
    const req = createModernRequest('server/discover', { id: 1 });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const payload = await parseResponsePayload(res);
    expect(payload.result).toBeDefined();
    expect(payload.result.supportedVersions).toContain(MODERN_PROTOCOL_VERSION);
    expect(payload.result.capabilities.tools).toBeDefined();
    expect(payload.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('content-task-command-center');
  });

  // ---------------------------------------------------------------------------
  // 2. WORKS WITHOUT INITIALIZATION IN MODERN MODE & SUPPORTS STATELESS LEGACY
  // ---------------------------------------------------------------------------
  it('2. works without initialization handshake in modern mode and supports stateless legacy (2025-11-25, 2025-06-18, 2025-03-26) initialize, tools/list, and tools/call', async () => {
    // A modern tools/list request succeeds immediately as the very first exchange
    const modernReq = createModernRequest('tools/list', { id: 1 });
    const modernRes = await POST(modernReq);
    expect(modernRes.status).toBe(200);
    const modernPayload = await parseResponsePayload(modernRes);
    expect(modernPayload.result.tools).toHaveLength(14);

    // Legacy initialize requests succeed statelessly across 2025-11-25, 2025-06-18, and 2025-03-26
    for (const legacyVersion of ['2025-11-25', '2025-06-18', '2025-03-26']) {
      const legacyInitReq = new Request('http://localhost:3000/api/mcp', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          authorization: `Bearer ${validToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'initialize',
          params: {
            protocolVersion: legacyVersion,
            capabilities: {},
            clientInfo: { name: 'legacy-client', version: '1.0' },
          },
        }),
      });

      const legacyRes = await POST(legacyInitReq);
      expect(legacyRes.status).toBe(200);
      expect(legacyRes.headers.get('mcp-session-id')).toBeNull();
      const legacyPayload = await parseResponsePayload(legacyRes);
      expect(legacyPayload.result).toBeDefined();
      expect(legacyPayload.result.protocolVersion).toBe(legacyVersion);
      expect(legacyPayload.result.serverInfo.name).toBe('content-task-command-center');
    }

    // Legacy stateless tools/list request succeeds without mcp-session-id
    const legacyListReq = new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        authorization: `Bearer ${validToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
        params: {},
      }),
    });

    const legacyListRes = await POST(legacyListReq);
    expect(legacyListRes.status).toBe(200);
    expect(legacyListRes.headers.get('mcp-session-id')).toBeNull();
    const legacyListPayload = await parseResponsePayload(legacyListRes);
    expect(legacyListPayload.result.tools).toHaveLength(14);

    // Legacy stateless tools/call request succeeds without mcp-session-id
    vi.mocked(getDashboardSummary).mockResolvedValueOnce({
      overdueTasksCount: 1,
      dueTodayTasksCount: 2,
      pendingSubtasksCount: 0,
      blockedTasksCount: 0,
      draftContentCount: 3,
      upcomingScheduledCount: 1,
      unreadNotificationsCount: 0,
    } as never);

    const legacyCallReq = new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        authorization: `Bearer ${validToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'get_workspace_summary',
          arguments: {},
        },
      }),
    });

    const legacyCallRes = await POST(legacyCallReq);
    expect(legacyCallRes.status).toBe(200);
    expect(legacyCallRes.headers.get('mcp-session-id')).toBeNull();
    const legacyCallPayload = await parseResponsePayload(legacyCallRes);
    expect(legacyCallPayload.result.isError).toBe(false);
    expect(JSON.parse(legacyCallPayload.result.content[0].text).draftContentCount).toBe(3);

    // Authentication ran independently on every single HTTP request (1 modern + 3 init + 1 list + 1 call = 6)
    expect(authenticateAiToken).toHaveBeenCalledTimes(6);
  });

  // ---------------------------------------------------------------------------
  // 3. NO PROTOCOL-LEVEL SESSION CREATED OR REQUIRED
  // ---------------------------------------------------------------------------
  it('3. operates completely statelessly without creating or requiring mcp-session-id', async () => {
    const req1 = createModernRequest('tools/list', { id: 10 });
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);
    // In 2026-07-28, mcp-session-id is not returned
    expect(res1.headers.get('mcp-session-id')).toBeNull();

    // A second independent request without any session identifier succeeds identically
    const req2 = createModernRequest('tools/list', { id: 11 });
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    expect(res2.headers.get('mcp-session-id')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 4. POST TOOL DISCOVERY WORKS
  // ---------------------------------------------------------------------------
  it('4. POST tool discovery works via tools/list', async () => {
    const req = createModernRequest('tools/list', { id: 20 });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const payload = await parseResponsePayload(res);
    expect(payload.result).toBeDefined();
    expect(Array.isArray(payload.result.tools)).toBe(true);
    expect(payload.result.tools.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 5. POST TOOL EXECUTION WORKS
  // ---------------------------------------------------------------------------
  it('5. POST tool execution works via tools/call', async () => {
    vi.mocked(getTasks).mockResolvedValueOnce([
      {
        id: '44444444-4444-4444-8444-444444444444',
        workspace_id: trustedWorkspaceId,
        title: 'Launch Preparation Task',
        status: 'in_progress',
        priority: 'high',
        subtasks_count: 0,
        subtasks_completed_count: 0,
        is_blocked: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any,
    ]);

    const req = createModernRequest('tools/call', {
      id: 25,
      params: {
        name: 'search_tasks',
        arguments: {
          search: 'Launch Preparation',
        },
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const payload = await parseResponsePayload(res);
    expect(payload.result.isError).toBe(false);
    expect(payload.result.content[0].text).toContain('Launch Preparation Task');
  });

  // ---------------------------------------------------------------------------
  // 6. ALL 14 TOOLS REMAIN AVAILABLE
  // ---------------------------------------------------------------------------
  it('6. all 14 tools remain available in tool registry', async () => {
    const expectedTools = [
      'get_workspace_summary',
      'search_tasks',
      'get_task_details',
      'list_overdue_tasks',
      'search_content',
      'get_content_details',
      'list_scheduled_content',
      'create_task',
      'update_task',
      'change_task_status',
      'reschedule_task',
      'create_content_item',
      'update_content_item',
      'reschedule_content',
    ];

    const req = createModernRequest('tools/list', { id: 30 });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const payload = await parseResponsePayload(res);
    const returnedToolNames = payload.result.tools.map((t: any) => t.name);
    expect(returnedToolNames).toHaveLength(14);
    for (const toolName of expectedTools) {
      expect(returnedToolNames).toContain(toolName);
    }
  });

  // ---------------------------------------------------------------------------
  // 7. AUTHENTICATION RUNS ON EVERY REQUEST
  // ---------------------------------------------------------------------------
  it('7. authentication runs on every request: missing Authorization header is rejected (401)', async () => {
    const req = new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': MODERN_PROTOCOL_VERSION,
        'mcp-method': 'tools/list',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
            [CLIENT_CAPABILITIES_META_KEY]: {},
          },
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.code).toBe('UNAUTHORIZED');
    expect(data.error.message).toContain('Missing or malformed Authorization header');
  });

  // ---------------------------------------------------------------------------
  // 8. INVALID, EXPIRED, REVOKED, AND RATE-LIMITED TOKENS REJECTED
  // ---------------------------------------------------------------------------
  it('8a. rejects malformed Authorization header (401)', async () => {
    const req = createModernRequest(
      'tools/list',
      { id: 40 },
      { authorization: 'Basic dXNlcjpwYXNz' }
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.code).toBe('UNAUTHORIZED');
  });

  it('8b. rejects revoked or expired tokens via authentication pipeline (401)', async () => {
    vi.mocked(authenticateAiToken).mockResolvedValueOnce({
      success: false,
      status: 401,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or unauthenticated API token',
      },
    });

    const req = createModernRequest('tools/list', { id: 41 });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.code).toBe('UNAUTHORIZED');
  });

  it('8c. rejects rate-limited requests with 429 and Retry-After header', async () => {
    vi.mocked(authenticateAiToken).mockResolvedValueOnce({
      success: false,
      status: 429,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit of 60 requests per minute exceeded. Try again later.',
      },
    });

    const req = createModernRequest('tools/list', { id: 42 });
    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    const data = await res.json();
    expect(data.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  // ---------------------------------------------------------------------------
  // 9. TRUSTED WORKSPACE AND USER CONTEXT REACHES DISPATCHER
  // ---------------------------------------------------------------------------
  it('9. trusted workspace and user context reaches dispatcher during tool calls', async () => {
    vi.mocked(getTasks).mockResolvedValueOnce([]);

    const req = createModernRequest('tools/call', {
      id: 50,
      params: {
        name: 'search_tasks',
        arguments: { search: 'VerifyContext' },
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    await parseResponsePayload(res);

    expect(getTasks).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(getTasks).mock.calls[0];
    expect(callArgs[1]).toBe(trustedWorkspaceId); // Trusted workspace
    expect(callArgs[2]).toMatchObject({ search: 'VerifyContext' });
  });

  // ---------------------------------------------------------------------------
  // 10. CLIENT-SUPPLIED IDENTITY CANNOT OVERRIDE TRUSTED CONTEXT
  // ---------------------------------------------------------------------------
  it('10. rejects client-supplied workspace_id or user_id in tool arguments and enforces trusted context', async () => {
    const req = createModernRequest('tools/call', {
      id: 60,
      params: {
        name: 'create_task',
        arguments: {
          title: 'Untampered Task',
          workspace_id: '99999999-9999-4999-8999-999999999999', // Attacker injection
        },
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await parseResponsePayload(res);
    expect(payload.result.isError).toBe(true);
    expect(payload.result.content[0].text).toContain('Unrecognized key');
    expect(createTask).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 11. LEGACY FALLBACK & INVALID PROTOCOL VERSIONS REJECTED CORRECTLY
  // ---------------------------------------------------------------------------
  it('11a. serves envelope-less requests via stateless legacy fallback and rejects unsupported MCP-Protocol-Version headers', async () => {
    // 1. Envelope-less tools/list request succeeds via legacy: 'stateless' fallback
    const req = new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        authorization: `Bearer ${validToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 70,
        method: 'tools/list',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await parseResponsePayload(res);
    expect(payload.result).toBeDefined();
    expect(payload.result.tools).toHaveLength(14);

    // 2. Envelope-less request with an unknown/unsupported MCP-Protocol-Version header is rejected with 400
    const badVersionReq = new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        authorization: `Bearer ${validToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '1999-01-01',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 701,
        method: 'tools/list',
      }),
    });

    const badVersionRes = await POST(badVersionReq);
    expect(badVersionRes.status).toBe(400);
    const badVersionPayload = await parseResponsePayload(badVersionRes);
    expect(badVersionPayload.error.message).toContain('Unsupported protocol version: 1999-01-01');
  });

  it('11b. rejects obsolete protocol versions (2024-11-05) with -32022', async () => {
    const req = new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        authorization: `Bearer ${validToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2024-11-05',
        'mcp-method': 'tools/list',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 71,
        method: 'tools/list',
        params: {
          _meta: {
            [PROTOCOL_VERSION_META_KEY]: '2024-11-05',
            [CLIENT_CAPABILITIES_META_KEY]: {},
          },
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const payload = await parseResponsePayload(res);
    expect(payload.error.code).toBe(-32022);
    expect(payload.error.message).toContain('Unsupported protocol version: 2024-11-05');
  });

  // ---------------------------------------------------------------------------
  // 12. REQUIRED PROTOCOL HEADERS AND METADATA VALIDATED
  // ---------------------------------------------------------------------------
  it('12a. rejects missing MCP-Protocol-Version header when body envelope is present with -32020', async () => {
    const req = new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        authorization: `Bearer ${validToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-method': 'tools/list',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 80,
        method: 'tools/list',
        params: {
          _meta: {
            [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
            [CLIENT_CAPABILITIES_META_KEY]: {},
          },
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const payload = await parseResponsePayload(res);
    expect(payload.error.code).toBe(-32020);
    expect(payload.error.message).toContain('MCP-Protocol-Version header is absent');
  });

  it('12b. rejects missing Mcp-Method header with -32020', async () => {
    const req = new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        authorization: `Bearer ${validToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': MODERN_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 81,
        method: 'tools/list',
        params: {
          _meta: {
            [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
            [CLIENT_CAPABILITIES_META_KEY]: {},
          },
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const payload = await parseResponsePayload(res);
    expect(payload.error.code).toBe(-32020);
    expect(payload.error.message).toContain('required Mcp-Method header is absent');
  });

  it('12c. rejects header and body method mismatch with -32020', async () => {
    const req = new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        authorization: `Bearer ${validToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': MODERN_PROTOCOL_VERSION,
        'mcp-method': 'tools/call', // Mismatch with body method tools/list
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 82,
        method: 'tools/list',
        params: {
          _meta: {
            [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
            [CLIENT_CAPABILITIES_META_KEY]: {},
          },
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const payload = await parseResponsePayload(res);
    expect(payload.error.code).toBe(-32020);
    expect(payload.error.message).toContain('headers and body disagree');
  });

  // ---------------------------------------------------------------------------
  // 13. INVALID ORIGINS ARE REJECTED
  // ---------------------------------------------------------------------------
  it('13a. rejects untrusted cross-origin requests with 403 Forbidden without CORS allow header', async () => {
    const req = createModernRequest(
      'tools/list',
      { id: 90 },
      { origin: 'https://evil-hacker.com' }
    );

    const res = await POST(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error.code).toBe('FORBIDDEN');
    // Security verification: untrusted origin must NEVER receive Access-Control-Allow-Origin
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toBe('no-store, no-cache, must-revalidate');
  });

  it('13b. rejects untrusted cross-origin OPTIONS preflight with 403 Forbidden without CORS allow header', async () => {
    const req = new Request('http://localhost:3000/api/mcp', {
      method: 'OPTIONS',
      headers: {
        host: 'localhost:3000',
        origin: 'https://evil-hacker.com',
      },
    });

    const res = await OPTIONS(req);
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('13c. allows matching origins and applies non-wildcard CORS headers', async () => {
    const req = createModernRequest(
      'tools/list',
      { id: 91 },
      { origin: 'http://localhost:3000' }
    );

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('13d. allows configured production host and applies matching CORS header', async () => {
    const originalAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
    try {
      process.env.MCP_ALLOWED_HOSTS = 'app.mydomain.com';
      const req = createModernRequest(
        'tools/list',
        { id: 92 },
        {
          host: 'app.mydomain.com',
          origin: 'https://app.mydomain.com',
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://app.mydomain.com');
    } finally {
      if (originalAllowedHosts !== undefined) {
        process.env.MCP_ALLOWED_HOSTS = originalAllowedHosts;
      } else {
        delete process.env.MCP_ALLOWED_HOSTS;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 14. REQUEST SIZE LIMITS REMAIN ENFORCED
  // ---------------------------------------------------------------------------
  it('14. rejects request bodies exceeding maxRequestBodySize with 413', async () => {
    const originalLimit = process.env.MCP_MAX_BODY_SIZE_BYTES;
    try {
      process.env.MCP_MAX_BODY_SIZE_BYTES = '100'; // Tight limit

      const req = createModernRequest('tools/call', {
        id: 100,
        params: {
          name: 'create_task',
          arguments: { title: 'x'.repeat(250) },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(413);
      const payload = await parseResponsePayload(res);
      expect(payload.error.message).toContain('Payload Too Large');
    } finally {
      if (originalLimit !== undefined) {
        process.env.MCP_MAX_BODY_SIZE_BYTES = originalLimit;
      } else {
        delete process.env.MCP_MAX_BODY_SIZE_BYTES;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 15. ERRORS REMAIN SANITIZED
  // ---------------------------------------------------------------------------
  it('15. sanitizes internal exceptions and prevents database leakage', async () => {
    vi.mocked(getTasks).mockRejectedValueOnce(
      new Error('FATAL: connection to postgresql://postgres:super_secret_pw@db.internal:5432 failed')
    );

    const req = createModernRequest('tools/call', {
      id: 110,
      params: {
        name: 'search_tasks',
        arguments: {},
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await parseResponsePayload(res);
    expect(payload.result.isError).toBe(true);
    const errorText = payload.result.content[0].text;
    expect(errorText).not.toContain('super_secret_pw');
    expect(errorText).toContain('[REDACTED_DATABASE_URI]');
  });

  // ---------------------------------------------------------------------------
  // 16. UNSUPPORTED LEGACY HTTP METHODS ARE REJECTED CORRECTLY
  // ---------------------------------------------------------------------------
  it('16. rejects unsupported HTTP methods (GET, DELETE, PUT, PATCH) with 405 Method Not Allowed', async () => {
    // GET: legacy session stream endpoint removed
    const getRes = await GET();
    expect(getRes.status).toBe(405);
    expect(getRes.headers.get('allow')).toBe('POST, OPTIONS');
    const getData = await getRes.json();
    expect(getData.error.message).toContain('Method not allowed');

    // DELETE: legacy session deletion removed
    const deleteRes = await DELETE();
    expect(deleteRes.status).toBe(405);
    expect(deleteRes.headers.get('allow')).toBe('POST, OPTIONS');

    // PUT
    const putRes = await PUT();
    expect(putRes.status).toBe(405);
    expect(putRes.headers.get('allow')).toBe('POST, OPTIONS');

    // PATCH
    const patchRes = await PATCH();
    expect(patchRes.status).toBe(405);
    expect(patchRes.headers.get('allow')).toBe('POST, OPTIONS');

    // OPTIONS preflight remains allowed
    const optReq = new Request('http://localhost:3000/api/mcp', {
      method: 'OPTIONS',
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
    });
    const optRes = await OPTIONS(optReq);
    expect(optRes.status).toBe(204);
    expect(optRes.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
  });

  // ---------------------------------------------------------------------------
  // 17. NOTIFICATIONS FOLLOW NEW PROTOCOL BEHAVIOR
  // ---------------------------------------------------------------------------
  it('17. notifications return 202 Accepted without response body', async () => {
    const req = createModernRequest('notifications/cancelled', {
      id: null, // Notification has no ID
      params: {
        requestId: '12345',
        reason: 'User cancelled operation',
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(202);
  });

  // ---------------------------------------------------------------------------
  // 18. OFFICIAL MCP CLIENT INTEGRATION OVER MODERN STREAMABLE HTTP
  // ---------------------------------------------------------------------------
  it('18. connects successfully via official MCP Client over Streamable HTTP without initialization handshake', async () => {
    vi.mocked(getDashboardSummary).mockResolvedValueOnce({
      overdueTasksCount: 2,
      dueTodayTasksCount: 3,
      pendingSubtasksCount: 1,
      blockedTasksCount: 0,
      draftContentCount: 4,
      upcomingScheduledCount: 2,
      unreadNotificationsCount: 5,
    } as any);

    // Custom fetch directing to our route handler
    const customFetch = async (url: string | URL | Request, init?: RequestInit) => {
      const request = url instanceof Request ? url : new Request(url, init);
      if (!request.headers.get('host')) {
        request.headers.set('host', 'localhost:3000');
      }
      if (request.method === 'GET') {
        return GET();
      } else if (request.method === 'DELETE') {
        return DELETE();
      } else if (request.method === 'OPTIONS') {
        return OPTIONS(request);
      }
      return POST(request);
    };

    const clientTransport = new StreamableHTTPClientTransport(
      new URL('http://localhost:3000/api/mcp'),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${validToken}`,
          },
        },
        fetch: customFetch as any,
      }
    );

    // Client config with automatic version negotiation (discovers 2026-07-28 via server/discover)
    const client = new Client(
      { name: 'test-claude-client', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } }
    );
    await client.connect(clientTransport);

    // 1. List tools
    const toolList = await client.listTools();
    expect(toolList.tools).toHaveLength(14);

    // 2. Call tool
    const callRes = await client.callTool({
      name: 'get_workspace_summary',
      arguments: {},
    });

    expect(callRes.isError).toBeFalsy();
    const content = callRes.content as any[];
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');
    const summaryData = JSON.parse(content[0].text);
    expect(summaryData.overdueTasksCount).toBe(2);
    expect(summaryData.draftContentCount).toBe(4);

    // 3. Clean close
    await client.close();
  });

  it('18b. connects successfully via official MCP Client in default legacy mode (2025-11-25 initialize handshake + tools/list + tools/call)', async () => {
    vi.mocked(getDashboardSummary).mockResolvedValueOnce({
      overdueTasksCount: 5,
      dueTodayTasksCount: 1,
      pendingSubtasksCount: 2,
      blockedTasksCount: 1,
      draftContentCount: 7,
      upcomingScheduledCount: 3,
      unreadNotificationsCount: 0,
    } as never);

    const customFetch = async (url: string | URL | Request, init?: RequestInit) => {
      const request = url instanceof Request ? url : new Request(url, init);
      if (!request.headers.get('host')) {
        request.headers.set('host', 'localhost:3000');
      }
      if (request.method === 'GET') {
        return GET();
      } else if (request.method === 'DELETE') {
        return DELETE();
      } else if (request.method === 'OPTIONS') {
        return OPTIONS(request);
      }
      return POST(request);
    };

    const clientTransport = new StreamableHTTPClientTransport(
      new URL('http://localhost:3000/api/mcp'),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${validToken}`,
          },
        },
        fetch: customFetch as typeof fetch,
      }
    );

    // Default Client options: versionNegotiation defaults to mode: 'legacy' (2025-11-25 initialize handshake)
    const legacyClient = new Client({ name: 'test-claude-legacy-client', version: '1.0.0' });
    await legacyClient.connect(clientTransport);

    // 1. List all 14 tools over legacy 2025-11-25 Streamable HTTP
    const toolList = await legacyClient.listTools();
    expect(toolList.tools).toHaveLength(14);

    // 2. Call tool over legacy 2025-11-25 Streamable HTTP
    const callRes = await legacyClient.callTool({
      name: 'get_workspace_summary',
      arguments: {},
    });

    expect(callRes.isError).toBeFalsy();
    const content = callRes.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');
    const summaryData = JSON.parse(content[0].text);
    expect(summaryData.overdueTasksCount).toBe(5);
    expect(summaryData.draftContentCount).toBe(7);

    // 3. Clean close
    await legacyClient.close();
  });

  // ---------------------------------------------------------------------------
  // 19. HOST HEADER VALIDATION & PROXY TRUST INVARIANTS (Phase 7.5.3)
  // ---------------------------------------------------------------------------
  describe('Host Header Validation and Proxy Trust Invariants', () => {
    const originalAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
    const originalAllowedOrigins = process.env.MCP_ALLOWED_ORIGINS;

    afterEach(() => {
      if (originalAllowedHosts !== undefined) {
        process.env.MCP_ALLOWED_HOSTS = originalAllowedHosts;
      } else {
        delete process.env.MCP_ALLOWED_HOSTS;
      }
      if (originalAllowedOrigins !== undefined) {
        process.env.MCP_ALLOWED_ORIGINS = originalAllowedOrigins;
      } else {
        delete process.env.MCP_ALLOWED_ORIGINS;
      }
    });

    it('rejects requests with missing Host header with 403 Forbidden without CORS allow header', async () => {
      const req = createModernRequest('tools/list', { id: 201 }, { host: undefined as any });
      const res = await POST(req);
      expect(res.status).toBe(403);
      const payload = await parseResponsePayload(res);
      expect(payload.error.message).toContain('Missing Host header');
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('rejects requests with invalid/unauthorized Host header with 403 Forbidden', async () => {
      const req = createModernRequest('tools/list', { id: 202 }, { host: 'evil-attacker.com' });
      const res = await POST(req);
      expect(res.status).toBe(403);
      const payload = await parseResponsePayload(res);
      expect(payload.error.message).toContain('Invalid Host: evil-attacker.com');
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('rejects requests with malicious Host even when Origin is omitted', async () => {
      // Non-browser client attempting to reach API with forged Host header
      const req = createModernRequest(
        'tools/list',
        { id: 203 },
        { host: 'malicious-host.org' }
      );
      const res = await POST(req);
      expect(res.status).toBe(403);
      const payload = await parseResponsePayload(res);
      expect(payload.error.message).toContain('Invalid Host: malicious-host.org');
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('allows requests with valid configured Host from MCP_ALLOWED_HOSTS', async () => {
      process.env.MCP_ALLOWED_HOSTS = 'api.mycommandcenter.com, mcp.commandcenter.com';
      const req = createModernRequest(
        'tools/list',
        { id: 204 },
        { host: 'api.mycommandcenter.com' }
      );
      const res = await POST(req);
      expect(res.status).toBe(200);
      const payload = await parseResponsePayload(res);
      expect(payload.result.tools).toHaveLength(14);
    });

    it('allows requests with valid Host when Origin is legitimately omitted (Claude Desktop)', async () => {
      // Claude Desktop sends Host: localhost:3000 but no Origin header
      const req = createModernRequest('tools/list', { id: 205 }, { host: 'localhost:3000' });
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('allows requests with valid Host and matching allowed Origin', async () => {
      const req = createModernRequest(
        'tools/list',
        { id: 206 },
        {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
        }
      );
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    });

    it('rejects untrusted x-forwarded-host value when Origin is malicious', async () => {
      // Attacker attempts to forge X-Forwarded-Host to match Origin
      const req = createModernRequest(
        'tools/list',
        { id: 207 },
        {
          host: 'localhost:3000',
          origin: 'https://evil.com',
          'x-forwarded-host': 'evil.com',
        }
      );
      const res = await POST(req);
      expect(res.status).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('allows local development host behavior across localhost, 127.0.0.1, and [::1]', async () => {
      for (const localHost of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000']) {
        const req = createModernRequest('tools/list', { id: 208 }, { host: localHost });
        const res = await POST(req);
        expect(res.status).toBe(200);
      }
    });

    it('rejects OPTIONS preflight with invalid Host with 403 Forbidden without CORS allow header', async () => {
      const optReq = new Request('http://localhost:3000/api/mcp', {
        method: 'OPTIONS',
        headers: {
          host: 'evil-host.com',
          origin: 'http://localhost:3000',
        },
      });
      const res = await OPTIONS(optReq);
      expect(res.status).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Host Header Parser Edge-Cases & Environment Validation (Phase 7.5.4)
  // ---------------------------------------------------------------------------
  describe('Host Header Parser Edge-Cases & Environment Validation (Phase 7.5.4)', () => {
    describe('Application-Level Syntax Validation (validateHostHeaderSyntax)', () => {
      it('rejects userinfo injection (defending against SDK Issue #2489)', () => {
        const userCases = [
          'user@localhost:3000',
          'user:pass@localhost:3000',
          'user@allowed.example.com',
          'allowed.example.com@evil.example',
          'evil.example@allowed.example.com',
        ];
        for (const host of userCases) {
          const res = validateHostHeaderSyntax(host);
          expect(res.valid).toBe(false);
          expect(res.message).toMatch(/forbidden characters|userinfo/i);
        }
      });

      it('rejects path separators, queries, fragments, and delimiters', () => {
        const pathCases = [
          'allowed.example.com/path',
          'allowed.example.com/api/mcp',
          'allowed.example.com?x=1',
          'allowed.example.com#hash',
          'allowed.example.com\\path',
          'allowed.example.com;param=1',
        ];
        for (const host of pathCases) {
          const res = validateHostHeaderSyntax(host);
          expect(res.valid).toBe(false);
          expect(res.message).toMatch(/forbidden characters/i);
        }
      });

      it('rejects comma-separated multi-valued Host headers', () => {
        const commaCases = [
          'allowed.example.com, evil.example',
          'allowed.example.com,evil.example',
          'localhost:3000, 127.0.0.1:3000',
        ];
        for (const host of commaCases) {
          const res = validateHostHeaderSyntax(host);
          expect(res.valid).toBe(false);
        }
      });

      it('rejects whitespace and control-character injection', () => {
        const injectionCases = [
          ' localhost:3000',
          'localhost:3000 ',
          'localhost:3000\r\nInjected-Header: evil',
          'localhost:3000\t',
          'localhost:\x00',
        ];
        for (const host of injectionCases) {
          const res = validateHostHeaderSyntax(host);
          expect(res.valid).toBe(false);
          expect(res.message).toMatch(/whitespace or control characters/i);
        }
      });

      it('rejects malformed port specifications', () => {
        const portCases = [
          'localhost:abc',
          'localhost:99999',
          'localhost:0',
          'localhost:-1',
          'localhost:+3000',
          'localhost: 3000',
          'localhost:',
          ':3000',
          '[::1]:abc',
          '[::1]:99999',
          '[::1]:0',
        ];
        for (const host of portCases) {
          const res = validateHostHeaderSyntax(host);
          expect(res.valid).toBe(false);
        }
      });

      it('rejects unbracketed IPv6 and malformed brackets', () => {
        const ipv6Cases = [
          '::1',
          '::3000',
          '2001:db8::1',
          '2001:db8::1:8080',
          '[invalid-ipv6]:3000',
          '[::1]:3000:extra',
          'localhost[3000]',
        ];
        for (const host of ipv6Cases) {
          const res = validateHostHeaderSyntax(host);
          expect(res.valid).toBe(false);
        }
      });

      it('preserves valid host and port syntaxes', () => {
        const validCases: Array<{ input: string; expectedHost: string; expectedPort?: number }> = [
          { input: 'allowed.example.com', expectedHost: 'allowed.example.com' },
          { input: 'allowed.example.com:443', expectedHost: 'allowed.example.com', expectedPort: 443 },
          { input: 'allowed.example.com:8443', expectedHost: 'allowed.example.com', expectedPort: 8443 },
          { input: 'localhost', expectedHost: 'localhost' },
          { input: 'localhost:3000', expectedHost: 'localhost', expectedPort: 3000 },
          { input: '127.0.0.1', expectedHost: '127.0.0.1' },
          { input: '127.0.0.1:8080', expectedHost: '127.0.0.1', expectedPort: 8080 },
          { input: '[::1]', expectedHost: '[::1]' },
          { input: '[::1]:3000', expectedHost: '[::1]', expectedPort: 3000 },
          { input: '[2001:db8::1]:8080', expectedHost: '[2001:db8::1]', expectedPort: 8080 },
        ];
        for (const tc of validCases) {
          const res = validateHostHeaderSyntax(tc.input);
          expect(res.valid).toBe(true);
          expect(res.hostname).toBe(tc.expectedHost);
          expect(res.port).toBe(tc.expectedPort);
        }
      });
    });

    describe('Environment Configuration Sanitization (sanitizeAllowedHostname)', () => {
      it('rejects arbitrary URLs, userinfo, paths, queries, ports, and wildcards in env entries', () => {
        const badEnvEntries = [
          'https://app.example.com',
          'http://app.example.com/api',
          'user@app.example.com',
          'app.example.com/path',
          'app.example.com?query=1',
          'app.example.com:3000',
          '*',
          '*.example.com',
          'app..example.com',
          '-app.example.com',
          '',
          '   ',
        ];
        for (const entry of badEnvEntries) {
          expect(sanitizeAllowedHostname(entry)).toBeNull();
        }
      });

      it('accepts clean bare hostnames, IPv4, and bracketed IPv6 in env entries', () => {
        expect(sanitizeAllowedHostname('app.example.com')).toBe('app.example.com');
        expect(sanitizeAllowedHostname('APP.EXAMPLE.COM ')).toBe('app.example.com');
        expect(sanitizeAllowedHostname('my-project.vercel.app')).toBe('my-project.vercel.app');
        expect(sanitizeAllowedHostname('127.0.0.1')).toBe('127.0.0.1');
        expect(sanitizeAllowedHostname('[::1]')).toBe('[::1]');
        expect(sanitizeAllowedHostname('[2001:db8::1]')).toBe('[2001:db8::1]');
      });

      it('getAllowedHostnames rejects malformed environment entries rather than broadening allowlist', () => {
        const originalHosts = process.env.MCP_ALLOWED_HOSTS;
        const originalVercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
        try {
          process.env.MCP_ALLOWED_HOSTS = 'https://evil.com/path, user@attacker.com, allowed.example.com, *';
          process.env.VERCEL_PROJECT_PRODUCTION_URL = 'https://malicious.vercel.app';
          const allowed = getAllowedHostnames();
          expect(allowed).toContain('allowed.example.com');
          expect(allowed).not.toContain('evil.com');
          expect(allowed).not.toContain('attacker.com');
          expect(allowed).not.toContain('*');
          expect(allowed).not.toContain('malicious.vercel.app');
        } finally {
          if (originalHosts !== undefined) process.env.MCP_ALLOWED_HOSTS = originalHosts;
          else delete process.env.MCP_ALLOWED_HOSTS;
          if (originalVercel !== undefined) process.env.VERCEL_PROJECT_PRODUCTION_URL = originalVercel;
          else delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
        }
      });
    });

    describe('Environment-Specific Localhost Invariants', () => {
      it('rejects localhost in production environment unless explicitly configured in MCP_ALLOWED_HOSTS', async () => {
        const env = process.env as Record<string, string | undefined>;
        const originalEnv = env.NODE_ENV;
        const originalHosts = env.MCP_ALLOWED_HOSTS;
        const originalProdUrl = env.VERCEL_PROJECT_PRODUCTION_URL;
        const originalVercelUrl = env.VERCEL_URL;
        try {
          env.NODE_ENV = 'production';
          delete env.MCP_ALLOWED_HOSTS;
          delete env.VERCEL_PROJECT_PRODUCTION_URL;
          delete env.VERCEL_URL;

          const req = createModernRequest('tools/list', { id: 250 }, { host: 'localhost:3000' });
          const res = await POST(req);
          expect(res.status).toBe(403);
          const payload = await parseResponsePayload(res);
          expect(payload.error.message).toContain('Invalid Host: localhost');
          expect(res.headers.get('access-control-allow-origin')).toBeNull();
        } finally {
          env.NODE_ENV = originalEnv;
          if (originalHosts !== undefined) env.MCP_ALLOWED_HOSTS = originalHosts;
          if (originalProdUrl !== undefined) env.VERCEL_PROJECT_PRODUCTION_URL = originalProdUrl;
          if (originalVercelUrl !== undefined) env.VERCEL_URL = originalVercelUrl;
        }
      });

      it('allows localhost in production environment if explicitly configured in MCP_ALLOWED_HOSTS', async () => {
        const env = process.env as Record<string, string | undefined>;
        const originalEnv = env.NODE_ENV;
        const originalHosts = env.MCP_ALLOWED_HOSTS;
        try {
          env.NODE_ENV = 'production';
          env.MCP_ALLOWED_HOSTS = 'localhost';

          const req = createModernRequest('tools/list', { id: 251 }, { host: 'localhost:3000' });
          const res = await POST(req);
          expect(res.status).toBe(200);
        } finally {
          env.NODE_ENV = originalEnv;
          if (originalHosts !== undefined) env.MCP_ALLOWED_HOSTS = originalHosts;
          else delete env.MCP_ALLOWED_HOSTS;
        }
      });
    });

    describe('HTTP Gateway Edge-Case Regression Tests (POST /api/mcp)', () => {
      it('rejects user@allowed.example.com with 403 Forbidden without CORS allow header', async () => {
        process.env.MCP_ALLOWED_HOSTS = 'allowed.example.com';
        const req = createModernRequest('tools/list', { id: 260 }, { host: 'user@allowed.example.com' });
        const res = await POST(req);
        expect(res.status).toBe(403);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
      });

      it('rejects allowed.example.com@evil.example with 403 Forbidden without CORS allow header', async () => {
        process.env.MCP_ALLOWED_HOSTS = 'allowed.example.com';
        const req = createModernRequest('tools/list', { id: 261 }, { host: 'allowed.example.com@evil.example' });
        const res = await POST(req);
        expect(res.status).toBe(403);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
      });

      it('rejects user@localhost:3000 (SDK Issue #2489) with 403 Forbidden without CORS allow header', async () => {
        const req = createModernRequest('tools/list', { id: 262 }, { host: 'user@localhost:3000' });
        const res = await POST(req);
        expect(res.status).toBe(403);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
      });

      it('rejects allowed.example.com/path with 403 Forbidden without CORS allow header', async () => {
        process.env.MCP_ALLOWED_HOSTS = 'allowed.example.com';
        const req = createModernRequest('tools/list', { id: 263 }, { host: 'allowed.example.com/path' });
        const res = await POST(req);
        expect(res.status).toBe(403);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
      });

      it('rejects allowed.example.com?x=1 with 403 Forbidden without CORS allow header', async () => {
        process.env.MCP_ALLOWED_HOSTS = 'allowed.example.com';
        const req = createModernRequest('tools/list', { id: 264 }, { host: 'allowed.example.com?x=1' });
        const res = await POST(req);
        expect(res.status).toBe(403);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
      });

      it('rejects comma-separated Host values with 403 Forbidden without CORS allow header', async () => {
        process.env.MCP_ALLOWED_HOSTS = 'allowed.example.com';
        const req = createModernRequest(
          'tools/list',
          { id: 265 },
          { host: 'allowed.example.com, evil.example' }
        );
        const res = await POST(req);
        expect(res.status).toBe(403);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
      });

      it('rejects whitespace and control-character injection in Host header with 403 Forbidden', async () => {
        // Test with internal whitespace preserved by Headers parser
        const req = createModernRequest('tools/list', { id: 266 }, { host: 'local host:3000' });
        const res = await POST(req);
        expect(res.status).toBe(403);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();

        // Test with space before port
        const req2 = createModernRequest('tools/list', { id: 267 }, { host: 'localhost: 3000' });
        const res2 = await POST(req2);
        expect(res2.status).toBe(403);
        expect(res2.headers.get('access-control-allow-origin')).toBeNull();

        // Test with raw unstripped leading whitespace via mock request object
        const mockReq = {
          headers: new Map([['host', ' localhost:3000']]),
        } as unknown as Request;
        // Host validation function directly rejects unstripped leading/trailing whitespace
        const { validateHost } = await import('@/app/api/mcp/route');
        const check = validateHost({
          headers: {
            get: (name: string) => (name.toLowerCase() === 'host' ? ' localhost:3000' : null),
          },
        } as unknown as Request);
        expect(check.allowed).toBe(false);
      });

      it('rejects malformed port in Host header with 403 Forbidden', async () => {
        const portTests = ['localhost:abc', 'localhost:99999', 'localhost:0', 'localhost:-1', 'localhost:'];
        for (let i = 0; i < portTests.length; i++) {
          const req = createModernRequest('tools/list', { id: 270 + i }, { host: portTests[i] });
          const res = await POST(req);
          expect(res.status).toBe(403);
          expect(res.headers.get('access-control-allow-origin')).toBeNull();
        }
      });
    });
  });
});
