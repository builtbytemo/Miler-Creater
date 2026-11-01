/**
 * ==============================================================================
 * Model Context Protocol (MCP) Streamable HTTP Gateway Route (Phase 7.5.1)
 * ==============================================================================
 * 
 * Architectural Role:
 *   Exposes the unified AI tool dispatcher over the official Model Context
 *   Protocol (MCP) Streamable HTTP transport (Specification 2026-07-28) at `/api/mcp`.
 * 
 * Transport & Protocol Invariants:
 *   1. Modern 2026-07-28 Protocol: Targets the 2026-07-28 Streamable HTTP specification.
 *      Removes initialization handshake, protocol-level sessions, and legacy GET stream.
 *      Strict legacy rejection ('legacy: reject') rejects non-conforming 2025 requests.
 *   2. Stateless Architecture: Operates in pure stateless mode without in-memory
 *      session persistence. A fresh handler and server instance are instantiated
 *      for each request.
 *   3. Streamable HTTP Handler: Uses createMcpHandler from @modelcontextprotocol/server
 *      to handle standard Web Request/Response objects.
 *   4. Universal Authentication: Every incoming request must provide a valid
 *      AI API bearer token (`Authorization: Bearer ctc_live_<64-hex>`). Fails fast
 *      with 401/403/429 before invoking any MCP capabilities.
 *   5. Injection of Verified Context: Passes the verified AIExecutionContext
 *      produced by authenticateAiToken() into createMcpServer(). The dispatcher
 *      strictly uses context-derived workspaceId and userId, ignoring any caller
 *      arguments attempting identity tampering.
 *   6. HTTP & Transport Security:
 *      - Strict origin verification (no wildcard `*` allowed for authenticated endpoint).
 *      - Request body size limits (default 1MB, configurable via MCP_MAX_BODY_SIZE_BYTES).
 *      - Method enforcement (POST and OPTIONS preflight). Unhandled/legacy methods return 405.
 *      - Content-Type (application/json) and protocol headers enforced by SDK handler.
 *      - Strict response security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Cache-Control`).
 *      - Sanitized error responses without leaking database credentials or stack traces.
 */

import { isIP } from 'net';
import {
  createMcpHandler,
  validateHostHeader,
  localhostAllowedHostnames,
} from '@modelcontextprotocol/server';
import { authenticateAiToken, type AuthenticateTokenOptions } from '@/lib/mcp/auth';
import { buildMcpWwwAuthenticateHeader } from '@/lib/mcp/oauth';
import { createMcpServer } from '@/lib/mcp/server';

export interface HostSyntaxValidationResult {
  valid: boolean;
  hostname?: string;
  port?: number;
  message?: string;
}

/**
 * Validates the syntax of an incoming HTTP Host header according to RFC 9110 / RFC 3986.
 * Rejects userinfo, paths, queries, fragments, multiple comma-separated values,
 * whitespace/control characters, and malformed ports before delegating to the MCP SDK.
 *
 * Defends against MCP TypeScript SDK Issue #2489:
 * https://github.com/modelcontextprotocol/typescript-sdk/issues/2489
 * where validateHostHeader('user@localhost:3000', ['localhost']) passes due to URL parsing.
 */
export function validateHostHeaderSyntax(
  hostHeader: string | null | undefined
): HostSyntaxValidationResult {
  if (!hostHeader || typeof hostHeader !== 'string') {
    return { valid: false, message: 'Missing Host header' };
  }

  // 1. Reject whitespace, control characters, or line break injection (\r, \n, \t, etc.)
  if (/[\s\x00-\x1F\x7F]/.test(hostHeader)) {
    return {
      valid: false,
      message: 'Host header contains invalid whitespace or control characters',
    };
  }

  // 2. Reject userinfo (@), path separators (/ or \), query strings (?), fragments (#),
  // comma-separated lists (,), or parameter semicolons (;)
  if (/[@/\\?#,;]/.test(hostHeader)) {
    return {
      valid: false,
      message: 'Host header contains forbidden characters (userinfo, path, query, or multiple values)',
    };
  }

  let hostPart: string;
  let portPart: string | undefined;

  // 3. Bracketed IPv6 literal: [::1] or [::1]:3000
  if (hostHeader.startsWith('[')) {
    const ipv6Match = hostHeader.match(/^\[([^\]]+)\](?::(.*))?$/);
    if (!ipv6Match) {
      return { valid: false, message: 'Malformed bracketed IPv6 host syntax' };
    }
    const ip6Address = ipv6Match[1];
    if (isIP(ip6Address) !== 6) {
      return { valid: false, message: 'Invalid IPv6 address inside brackets' };
    }
    hostPart = `[${ip6Address.toLowerCase()}]`;
    portPart = ipv6Match[2];
  } else {
    // Cannot contain square brackets if not beginning with [
    if (/[\[\]]/.test(hostHeader)) {
      return { valid: false, message: 'Unmatched brackets in Host header' };
    }

    const colonCount = (hostHeader.match(/:/g) || []).length;
    if (colonCount > 1) {
      return {
        valid: false,
        message: 'Host header contains multiple colons (IPv6 addresses must be bracketed)',
      };
    }

    if (colonCount === 1) {
      const parts = hostHeader.split(':');
      hostPart = parts[0];
      portPart = parts[1];
      if (!hostPart || !portPart) {
        return { valid: false, message: 'Empty hostname or port in Host header' };
      }
    } else {
      hostPart = hostHeader;
    }

    // Validate hostPart as either an IPv4 or RFC 1123 DNS hostname
    const ipVersion = isIP(hostPart);
    if (ipVersion === 4) {
      // Valid IPv4
      hostPart = hostPart.toLowerCase();
    } else if (ipVersion === 6) {
      return {
        valid: false,
        message: 'IPv6 addresses in Host header must be enclosed in square brackets',
      };
    } else {
      // DNS domain / hostname validation
      if (hostPart.length > 253) {
        return { valid: false, message: 'Hostname exceeds maximum length of 253 characters' };
      }
      const labelRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
      const labels = hostPart.split('.');
      for (const label of labels) {
        if (!labelRegex.test(label)) {
          return { valid: false, message: `Invalid hostname label: "${label}"` };
        }
      }
      hostPart = hostPart.toLowerCase();
    }
  }

  // 4. Validate port number if present
  if (portPart !== undefined) {
    if (!/^\d+$/.test(portPart)) {
      return { valid: false, message: `Malformed port in Host header: "${portPart}"` };
    }
    const port = Number(portPart);
    if (port < 1 || port > 65535) {
      return { valid: false, message: `Port in Host header is out of valid range (1-65535): ${port}` };
    }
  }

  return {
    valid: true,
    hostname: hostPart,
    port: portPart ? Number(portPart) : undefined,
  };
}

/**
 * Validates and sanitizes an allowed hostname entry from environment variables.
 * Ensures the entry is a strictly valid bare hostname (domain, IPv4, or bracketed IPv6).
 * Rejects arbitrary URLs, userinfo, paths, queries, ports, wildcards, or malformed entries
 * rather than silently broadening or corrupting the allowlist.
 */
export function sanitizeAllowedHostname(entry: string | undefined | null): string | null {
  if (!entry || typeof entry !== 'string') return null;
  const trimmed = entry.trim().toLowerCase();
  if (!trimmed) return null;

  // Bracketed IPv6: e.g. [::1] or [2001:db8::1]
  if (trimmed.startsWith('[')) {
    const match = trimmed.match(/^\[([^\]]+)\]$/);
    if (!match) return null;
    const ip6 = match[1];
    return isIP(ip6) === 6 ? `[${ip6.toLowerCase()}]` : null;
  }

  // Reject forbidden characters: userinfo (@), paths (/ or \), query (?), fragment (#),
  // comma (,), semicolon (;), whitespace, brackets, or ports (:)
  if (/[@/\\?#,;:\s\[\]]/.test(trimmed)) {
    return null;
  }

  // IPv4 literal
  if (isIP(trimmed) === 4) {
    return trimmed;
  }

  // Domain name check (RFC 1123)
  if (trimmed.length > 253) return null;
  const labelRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  const labels = trimmed.split('.');
  for (const label of labels) {
    if (!labelRegex.test(label)) {
      return null;
    }
  }

  return trimmed;
}

/**
 * Resolves the explicit list of allowed hostnames for Host header validation.
 * In production, configured explicitly via MCP_ALLOWED_HOSTS or Vercel deployment variables.
 * Local development hostnames (localhost, 127.0.0.1, [::1]) are included only in
 * non-production environments (development / test) unless explicitly configured.
 */
export function getAllowedHostnames(): string[] {
  const allowed = new Set<string>();

  if (process.env.MCP_ALLOWED_HOSTS) {
    for (const raw of process.env.MCP_ALLOWED_HOSTS.split(',')) {
      const sanitized = sanitizeAllowedHostname(raw);
      if (sanitized) {
        allowed.add(sanitized);
      }
    }
  }

  // Incorporate Vercel deployment hostnames if running on Vercel
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    const sanitized = sanitizeAllowedHostname(process.env.VERCEL_PROJECT_PRODUCTION_URL);
    if (sanitized) {
      allowed.add(sanitized);
    }
  }
  if (process.env.VERCEL_URL) {
    const sanitized = sanitizeAllowedHostname(process.env.VERCEL_URL);
    if (sanitized) {
      allowed.add(sanitized);
    }
  }

  // Local development hostnames (localhost, 127.0.0.1, [::1]) are included ONLY in
  // non-production environments (test / development) to prevent accidental localhost exposure in production.
  if (process.env.NODE_ENV !== 'production') {
    for (const localHost of localhostAllowedHostnames()) {
      const sanitized = sanitizeAllowedHostname(localHost);
      if (sanitized) {
        allowed.add(sanitized);
      }
    }
  }

  return Array.from(allowed);
}

/**
 * Validates the incoming Host header against the explicit trusted-host policy.
 * Defends against DNS rebinding attacks and requests with hostile/untrusted Host headers.
 * Performs application-level syntax validation first (fixing SDK issue #2489)
 * before calling the SDK validateHostHeader helper.
 */
export function validateHost(
  req: Request
): { allowed: boolean; hostname?: string; message?: string } {
  const hostHeader = req.headers.get('host');
  if (!hostHeader) {
    return {
      allowed: false,
      message: 'Missing Host header',
    };
  }

  // Application-level syntax validation (rejects userinfo, path, query, malformed ports, etc.)
  const syntaxCheck = validateHostHeaderSyntax(hostHeader);
  if (!syntaxCheck.valid) {
    return {
      allowed: false,
      hostname: syntaxCheck.hostname,
      message: syntaxCheck.message || 'Malformed Host header',
    };
  }

  const allowedHostnames = getAllowedHostnames();
  const result = validateHostHeader(hostHeader, allowedHostnames);

  if (!result.ok) {
    return {
      allowed: false,
      hostname: 'hostname' in result ? (result.hostname as string) : syntaxCheck.hostname,
      message: result.message,
    };
  }

  return {
    allowed: true,
    hostname: result.hostname,
  };
}

/**
 * Validates request origin against allowed origin policy.
 * Non-browser requests (missing Origin header from Claude Desktop, curl, server-to-server)
 * are allowed by default.
 * For browser requests, matches against configured origins, local development origins,
 * or the validated canonical host (without trusting client-forged x-forwarded-host).
 */
export function validateOrigin(
  req: Request,
  validatedHostname?: string
): { allowed: boolean; origin: string | null } {
  const origin = req.headers.get('origin');
  if (!origin) {
    // Non-browser client (Claude Desktop, curl, server-to-server) -> Allowed
    return { allowed: true, origin: null };
  }

  // 1. Check explicit environment-configured allowed origins
  const configuredOrigins = process.env.MCP_ALLOWED_ORIGINS
    ? process.env.MCP_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : null;

  if (configuredOrigins && configuredOrigins.length > 0) {
    return {
      allowed: configuredOrigins.includes(origin),
      origin,
    };
  }

  // 2. Default fallback: allow local development origins and verified same-origin
  try {
    const originUrl = new URL(origin);
    // Reject origins containing userinfo
    if (originUrl.username || originUrl.password) {
      return { allowed: false, origin };
    }
    const originHostname = originUrl.hostname.toLowerCase();

    // Standard local development origins only in non-production environments
    if (process.env.NODE_ENV !== 'production' && localhostAllowedHostnames().includes(originHostname)) {
      return { allowed: true, origin };
    }

    // Match against validated host header (canonical host, NOT untrusted x-forwarded-host)
    if (validatedHostname && originHostname === validatedHostname.toLowerCase()) {
      return { allowed: true, origin };
    }
  } catch {
    return { allowed: false, origin };
  }

  return { allowed: false, origin };
}

/**
 * Applies security and CORS headers to the outgoing response.
 */
export function applySecurityHeaders(
  response: Response,
  origin: string | null = null
): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate, Retry-After');
    headers.set('Vary', 'Origin');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Core stateless request handler for MCP HTTP operations.
 */
export async function handleMcpRequest(
  req: Request,
  authOptions?: AuthenticateTokenOptions
): Promise<Response> {
  // 1. Host header validation (DNS rebinding and hostile Host header protection)
  const hostCheck = validateHost(req);
  if (!hostCheck.allowed) {
    const invalidHostRes = new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: hostCheck.message || 'Host not allowed.',
        },
        id: null,
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    return applySecurityHeaders(invalidHostRes, null);
  }

  // 2. Origin validation (browser CORS protection; non-browser clients without Origin pass)
  const originCheck = validateOrigin(req, hostCheck.hostname);
  if (!originCheck.allowed) {
    const forbiddenRes = new Response(
      JSON.stringify({
        error: {
          code: 'FORBIDDEN',
          message: 'Origin not allowed by CORS policy.',
        },
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    return applySecurityHeaders(forbiddenRes, null);
  }

  // 3. Bearer token extraction
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    const unauthorizedRes = new Response(
      JSON.stringify({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or malformed Authorization header. Bearer token required.',
        },
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': buildMcpWwwAuthenticateHeader({
            error: 'invalid_token',
            errorDescription: 'Missing or malformed Authorization header. Bearer token required.',
          }),
        },
      }
    );
    return applySecurityHeaders(unauthorizedRes, originCheck.origin);
  }

  const rawBearerToken = authHeader.slice(7).trim();
  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    null;
  const userAgent = req.headers.get('user-agent') || null;

  // 3. Authenticate token via Phase 7.4 pipeline
  const authResult = await authenticateAiToken(rawBearerToken, {
    ipAddress,
    userAgent,
    ...authOptions,
  });

  if (!authResult.success) {
    const errorHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authResult.status === 401) {
      errorHeaders['WWW-Authenticate'] = buildMcpWwwAuthenticateHeader({
        error: 'invalid_token',
        errorDescription: authResult.error.message,
      });
    } else if (authResult.status === 429) {
      errorHeaders['Retry-After'] = '60';
    }

    const authErrorRes = new Response(
      JSON.stringify({
        error: {
          code: authResult.error.code,
          message: authResult.error.message,
          ...(authResult.error.details ? { details: authResult.error.details } : {}),
        },
      }),
      {
        status: authResult.status,
        headers: errorHeaders,
      }
    );
    return applySecurityHeaders(authErrorRes, originCheck.origin);
  }

  // 4. Create stateless MCP handler bound to verified context
  const rawMax = process.env.MCP_MAX_BODY_SIZE_BYTES;
  const parsedMax = rawMax ? parseInt(rawMax, 10) : NaN;
  const maxBodySize = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 1024 * 1024;

  const wantsJsonResponse =
    req.headers.get('x-mcp-json-response') === 'true' ||
    new URL(req.url).searchParams.get('format') === 'json' ||
    process.env.MCP_ENABLE_JSON_RESPONSE === 'true';

  const handler = createMcpHandler(
    () => createMcpServer(authResult.context),
    {
      legacy: 'stateless', // Serve both modern 2026-07-28 and stateless 2025-* Streamable HTTP requests
      responseMode: wantsJsonResponse ? 'json' : 'auto',
      maxRequestBodySize: maxBodySize,
    }
  );

  try {
    const response = await handler.fetch(req);
    return applySecurityHeaders(response, originCheck.origin);
  } catch {
    const errorRes = new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'An unexpected internal error occurred while processing the MCP request.',
        },
        id: null,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    return applySecurityHeaders(errorRes, originCheck.origin);
  }
}

// -----------------------------------------------------------------------------
// NEXT.JS APP ROUTER EXPORTS
// -----------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  return handleMcpRequest(req);
}

export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed. Streamable HTTP 2026-07-28 uses POST for all operations.',
      },
      id: null,
    }),
    {
      status: 405,
      headers: {
        Allow: 'POST, OPTIONS',
        'Content-Type': 'application/json',
      },
    }
  );
}

export async function DELETE(): Promise<Response> {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed. Session termination is obsolete in stateless 2026-07-28 protocol.',
      },
      id: null,
    }),
    {
      status: 405,
      headers: {
        Allow: 'POST, OPTIONS',
        'Content-Type': 'application/json',
      },
    }
  );
}

export async function OPTIONS(req: Request): Promise<Response> {
  // 1. Host header validation
  const hostCheck = validateHost(req);
  if (!hostCheck.allowed) {
    const invalidHostRes = new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: hostCheck.message || 'Host not allowed.',
        },
        id: null,
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    return applySecurityHeaders(invalidHostRes, null);
  }

  // 2. Origin validation
  const originCheck = validateOrigin(req, hostCheck.hostname);
  if (!originCheck.allowed) {
    const forbiddenRes = new Response(
      JSON.stringify({
        error: {
          code: 'FORBIDDEN',
          message: 'Origin not allowed by CORS policy.',
        },
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    return applySecurityHeaders(forbiddenRes, null);
  }

  const headers = new Headers();
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, Accept, mcp-protocol-version, mcp-method, mcp-name, x-mcp-json-response'
  );
  headers.set('Access-Control-Max-Age', '86400');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (originCheck.origin) {
    headers.set('Access-Control-Allow-Origin', originCheck.origin);
    headers.set('Vary', 'Origin');
  }

  return new Response(null, { status: 204, headers });
}

export async function PUT(): Promise<Response> {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed. Only POST and OPTIONS are supported.',
      },
      id: null,
    }),
    {
      status: 405,
      headers: {
        Allow: 'POST, OPTIONS',
        'Content-Type': 'application/json',
      },
    }
  );
}

export async function PATCH(): Promise<Response> {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed. Only POST and OPTIONS are supported.',
      },
      id: null,
    }),
    {
      status: 405,
      headers: {
        Allow: 'POST, OPTIONS',
        'Content-Type': 'application/json',
      },
    }
  );
}
