import {
  OAuthError,
  OAuthErrorCode,
  readRequestBody,
} from '@modelcontextprotocol/server';
import {
  MAX_OAUTH_REQUEST_BODY_BYTES,
  registerOAuthClient,
  type OAuthServiceOptions,
} from '@/lib/mcp/oauth';

const ALLOWED_METHODS = 'POST, OPTIONS';

function createOAuthJsonHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Type': 'application/json',
    ...extra,
  });
}

export async function handleOAuthRegisterRequest(
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

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyResult.text);
  } catch {
    return Response.json(
      {
        error: OAuthErrorCode.InvalidRequest,
        error_description: 'Request body must be valid JSON',
      },
      { status: 400, headers: createOAuthJsonHeaders() }
    );
  }

  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    null;
  const userAgent = req.headers.get('user-agent') || null;

  try {
    const clientMetadata = await registerOAuthClient(
      parsedBody as Record<string, unknown>,
      {
        ipAddress,
        userAgent,
        ...serviceOptions,
      }
    );

    return Response.json(clientMetadata, {
      status: 201,
      headers: createOAuthJsonHeaders(),
    });
  } catch (err) {
    if (err instanceof OAuthError) {
      let status = 400;
      if (err.code === OAuthErrorCode.TooManyRequests) {
        status = 429;
      } else if (err.code === OAuthErrorCode.ServerError) {
        status = 500;
      }
      return Response.json(err.toResponseObject(), {
        status,
        headers: createOAuthJsonHeaders(
          status === 429 ? { 'Retry-After': '60' } : {}
        ),
      });
    }

    return Response.json(
      {
        error: OAuthErrorCode.ServerError,
        error_description: 'An unexpected error occurred during client registration',
      },
      { status: 500, headers: createOAuthJsonHeaders() }
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  return handleOAuthRegisterRequest(req);
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
      error_description: 'Only POST is supported for dynamic client registration',
    },
    {
      status: 405,
      headers: createOAuthJsonHeaders({ Allow: ALLOWED_METHODS }),
    }
  );
}
