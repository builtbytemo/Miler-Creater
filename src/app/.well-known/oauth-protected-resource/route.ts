import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import { buildMcpProtectedResourceMetadata } from '@/lib/mcp/oauth';

const ALLOWED_METHODS = 'GET, HEAD, OPTIONS';

function createDiscoveryHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
}

export async function GET(): Promise<Response> {
  const metadata = buildMcpProtectedResourceMetadata();
  return Response.json(metadata, {
    status: 200,
    headers: createDiscoveryHeaders({ 'Content-Type': 'application/json' }),
  });
}

export async function HEAD(): Promise<Response> {
  return new Response(null, {
    status: 200,
    headers: createDiscoveryHeaders({ 'Content-Type': 'application/json' }),
  });
}

export async function OPTIONS(req: Request): Promise<Response> {
  const requestedHeaders = req.headers.get('access-control-request-headers');
  const headers = createDiscoveryHeaders(
    requestedHeaders
      ? {
          'Access-Control-Allow-Headers': requestedHeaders,
          Vary: 'Access-Control-Request-Headers',
        }
      : {}
  );
  return new Response(null, { status: 204, headers });
}

export async function POST(req: Request): Promise<Response> {
  const err = new OAuthError(
    OAuthErrorCode.MethodNotAllowed,
    `The method ${req.method} is not allowed for this endpoint`
  );
  return Response.json(err.toResponseObject(), {
    status: 405,
    headers: createDiscoveryHeaders({
      Allow: ALLOWED_METHODS,
      'Content-Type': 'application/json',
    }),
  });
}
