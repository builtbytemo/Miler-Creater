import {
  OAuthError,
  OAuthErrorCode,
  readRequestBody,
} from '@modelcontextprotocol/server';
import {
  exchangeAuthorizationCode,
  MAX_OAUTH_REQUEST_BODY_BYTES,
  rotateOAuthRefreshToken,
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

function parseTokenRequestParams(
  rawBody: string,
  contentType: string
): Record<string, string> | null {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return null;
  }

  if (contentType.includes('application/json') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') {
          out[k] = v;
        }
      }
      return out;
    } catch {
      return null;
    }
  }

  try {
    const params = new URLSearchParams(trimmed);
    const out: Record<string, string> = {};
    for (const [k, v] of params.entries()) {
      // RFC 6749 §3.2: parameters MUST NOT be included more than once
      if (Object.prototype.hasOwnProperty.call(out, k)) {
        return null;
      }
      out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

export async function handleOAuthTokenRequest(
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

  const contentType = (req.headers.get('content-type') || '').toLowerCase();
  const params = parseTokenRequestParams(bodyResult.text, contentType);
  if (!params) {
    return Response.json(
      {
        error: OAuthErrorCode.InvalidRequest,
        error_description:
          'Malformed token request body or duplicate OAuth parameters',
      },
      { status: 400, headers: createOAuthJsonHeaders() }
    );
  }

  const grantType = params.grant_type;
  if (!grantType) {
    return Response.json(
      {
        error: OAuthErrorCode.InvalidRequest,
        error_description: 'Missing required grant_type parameter',
      },
      { status: 400, headers: createOAuthJsonHeaders() }
    );
  }

  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    null;
  const userAgent = req.headers.get('user-agent') || null;
  const mergedOptions: OAuthServiceOptions = {
    ipAddress,
    userAgent,
    ...serviceOptions,
  };

  try {
    if (grantType === 'authorization_code') {
      const tokenResponse = await exchangeAuthorizationCode(
        {
          code: params.code,
          clientId: params.client_id,
          redirectUri: params.redirect_uri,
          codeVerifier: params.code_verifier,
          resource: params.resource,
          scope: params.scope,
        },
        mergedOptions
      );

      return Response.json(tokenResponse, {
        status: 200,
        headers: createOAuthJsonHeaders(),
      });
    }

    if (grantType === 'refresh_token') {
      const tokenResponse = await rotateOAuthRefreshToken(
        {
          refreshToken: params.refresh_token,
          clientId: params.client_id,
          resource: params.resource,
          scope: params.scope,
        },
        mergedOptions
      );

      return Response.json(tokenResponse, {
        status: 200,
        headers: createOAuthJsonHeaders(),
      });
    }

    return Response.json(
      {
        error: OAuthErrorCode.UnsupportedGrantType,
        error_description: `Unsupported grant_type "${grantType}". Supported values: authorization_code, refresh_token`,
      },
      { status: 400, headers: createOAuthJsonHeaders() }
    );
  } catch (err) {
    if (err instanceof OAuthError) {
      let status = 400;
      if (err.code === OAuthErrorCode.InvalidClient) {
        status = 401;
      } else if (err.code === OAuthErrorCode.TooManyRequests) {
        status = 429;
      } else if (err.code === OAuthErrorCode.ServerError) {
        status = 500;
      }
      return Response.json(err.toResponseObject(), {
        status,
        headers: createOAuthJsonHeaders(),
      });
    }

    return Response.json(
      {
        error: OAuthErrorCode.ServerError,
        error_description: 'An unexpected error occurred during token exchange',
      },
      { status: 500, headers: createOAuthJsonHeaders() }
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  return handleOAuthTokenRequest(req);
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
      error_description: 'Only POST is supported for the OAuth token endpoint',
    },
    {
      status: 405,
      headers: createOAuthJsonHeaders({ Allow: ALLOWED_METHODS }),
    }
  );
}
