import {
  OAuthErrorCode,
  readRequestBody,
} from '@modelcontextprotocol/server';
import {
  MAX_OAUTH_REQUEST_BODY_BYTES,
  revokeOAuthToken,
  type OAuthServiceOptions,
} from '@/lib/mcp/oauth';

const ALLOWED_METHODS = 'POST, OPTIONS';

function createOAuthJsonHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Type': 'application/json',
    ...extra,
  });
}

export async function handleOAuthRevokeRequest(
  req: Request,
  serviceOptions?: OAuthServiceOptions
): Promise<Response> {
  const bodyResult = await readRequestBody(req, MAX_OAUTH_REQUEST_BODY_BYTES);
  if (bodyResult.tooLarge) {
    return Response.json(
      {
        error: OAuthErrorCode.InvalidRequest,
        error_description: `Request body exceeds maximum size of ${MAX_OAUTH_REQUEST_BODY_BYTES} bytes`,
      },
      { status: 413, headers: createOAuthJsonHeaders() }
    );
  }

  let rawToken: string | null = null;
  const trimmed = bodyResult.text.trim();
  const contentType = (req.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('application/json') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && typeof parsed.token === 'string') {
        rawToken = parsed.token;
      }
    } catch {
      return Response.json(
        {
          error: OAuthErrorCode.InvalidRequest,
          error_description: 'Malformed JSON body',
        },
        { status: 400, headers: createOAuthJsonHeaders() }
      );
    }
  } else {
    const params = new URLSearchParams(trimmed);
    rawToken = params.get('token');
  }

  if (!rawToken || !rawToken.trim()) {
    return Response.json(
      {
        error: OAuthErrorCode.InvalidRequest,
        error_description: 'Missing required token parameter',
      },
      { status: 400, headers: createOAuthJsonHeaders() }
    );
  }

  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    null;
  const userAgent = req.headers.get('user-agent') || null;

  await revokeOAuthToken(rawToken, {
    ipAddress,
    userAgent,
    ...serviceOptions,
  });

  // RFC 7009 §2.2: The authorization server responds with HTTP status code 200
  // if the token has been revoked successfully or if the client submitted an invalid token.
  return Response.json(
    {},
    {
      status: 200,
      headers: createOAuthJsonHeaders(),
    }
  );
}

export async function POST(req: Request): Promise<Response> {
  return handleOAuthRevokeRequest(req);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: createOAuthJsonHeaders(),
  });
}

export async function GET(): Promise<Response> {
  return Response.json(
    {
      error: OAuthErrorCode.MethodNotAllowed,
      error_description: 'Only POST is supported for the OAuth revocation endpoint',
    },
    {
      status: 405,
      headers: createOAuthJsonHeaders({ Allow: ALLOWED_METHODS }),
    }
  );
}
