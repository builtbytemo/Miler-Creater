import crypto from 'crypto';
import {
  buildOAuthProtectedResourceMetadata,
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
  type OAuthMetadata,
  type OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, WorkspaceRole } from '@/types/database';
import type { ToolScope } from '@/lib/mcp/types';
import { generateAiToken, hashAiToken } from '@/lib/ai/tokens';
import { logAiAuditEvent } from '@/lib/mcp/audit';
import { createAdminClient } from '@/lib/supabase/admin';
import { SUPPORTED_AI_TOKEN_SCOPES } from '@/lib/validation/ai-token';

export const CANONICAL_PRODUCTION_ORIGIN = 'https://miler-creater.vercel.app';
export const CANONICAL_MCP_RESOURCE = 'https://miler-creater.vercel.app/api/mcp';

export const DEFAULT_ALLOWED_CLAUDE_REDIRECT_URIS: readonly string[] = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
] as const;

export const DEFAULT_READ_ONLY_SCOPES: readonly ToolScope[] = [
  'task:read',
  'content:read',
] as const;

export const WRITE_CAPABLE_SCOPES: readonly ToolScope[] = [
  'task:write',
  'content:write',
] as const;

export const DEFAULT_AUTH_CODE_TTL_SECONDS = 300; // 5 minutes
export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 3600; // 1 hour
export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600; // 30 days
export const MAX_OAUTH_REQUEST_BODY_BYTES = 16 * 1024; // 16 KiB
export const MAX_DCR_REGISTRATIONS_PER_IP_PER_MINUTE = 20;
export const MAX_DCR_REGISTRATIONS_GLOBAL_PER_MINUTE = 100;

const PKCE_VERIFIER_REGEX = /^[A-Za-z0-9\-._~]{43,128}$/;
const PKCE_S256_CHALLENGE_REGEX = /^[A-Za-z0-9\-_]{43,128}$/;
const OAUTH_CODE_FORMAT_REGEX = /^ctc_code_[0-9a-f]{64}$/;
const OAUTH_REFRESH_TOKEN_FORMAT_REGEX = /^ctc_rt_[0-9a-f]{64}$/;
const ACCESS_TOKEN_FORMAT_REGEX = /^ctc_live_[0-9a-f]{64}$/;
const SAFE_STATE_REGEX = /^[\x20-\x7E]{1,512}$/;

/**
 * Resolves the canonical public origin for OAuth issuer and metadata URLs.
 * Defaults to https://miler-creater.vercel.app in production.
 */
export function getCanonicalOrigin(): string {
  const configured =
    process.env.MCP_OAUTH_ISSUER_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (configured && !configured.includes('your-project') && !configured.includes('your-domain')) {
    try {
      const parsed = new URL(configured);
      if (
        parsed.protocol === 'https:' ||
        (process.env.NODE_ENV !== 'production' &&
          (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))
      ) {
        return parsed.origin;
      }
    } catch {
      // Fall back to canonical production origin
    }
  }

  return CANONICAL_PRODUCTION_ORIGIN;
}

/**
 * Returns the canonical RFC 8707 MCP resource identifier.
 * Always resolves to https://miler-creater.vercel.app/api/mcp unless overridden
 * by a validated canonical origin in local non-production testing.
 */
export function getCanonicalMcpResource(): string {
  const explicitResource = process.env.MCP_CANONICAL_RESOURCE_URL?.trim();
  if (explicitResource) {
    const normalized = normalizeResourceIndicator(explicitResource);
    if (normalized) {
      return normalized;
    }
  }
  return CANONICAL_MCP_RESOURCE;
}

/**
 * Normalizes and validates an RFC 8707 resource URI.
 * Rejects fragments (#), userinfo, non-HTTP(S) schemes, query strings, and malformed URLs.
 */
export function normalizeResourceIndicator(rawResource: string | null | undefined): string | null {
  if (!rawResource || typeof rawResource !== 'string') {
    return null;
  }

  const trimmed = rawResource.trim();
  if (!trimmed || trimmed.length > 512) {
    return null;
  }

  // RFC 8707 Section 2: Resource URIs MUST NOT include a fragment component
  if (trimmed.includes('#') || trimmed.includes('\\')) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (parsed.username || parsed.password || parsed.hash || parsed.search) {
      return null;
    }
    const cleanPath =
      parsed.pathname.length > 1 && parsed.pathname.endsWith('/')
        ? parsed.pathname.slice(0, -1)
        : parsed.pathname;

    return `${parsed.origin.toLowerCase()}${cleanPath}`;
  } catch {
    return null;
  }
}

/**
 * Validates whether a requested RFC 8707 resource matches the canonical MCP resource.
 */
export function isCanonicalMcpResource(
  requestedResource: string | null | undefined,
  expectedCanonicalResource: string = getCanonicalMcpResource()
): boolean {
  const normalizedRequested = normalizeResourceIndicator(requestedResource);
  const normalizedExpected = normalizeResourceIndicator(expectedCanonicalResource);
  if (!normalizedRequested || !normalizedExpected) {
    return false;
  }
  return normalizedRequested === normalizedExpected;
}

/**
 * Builds the RFC 9728 Protected Resource Metadata URL for the MCP server.
 */
export function getMcpProtectedResourceMetadataUrl(
  origin: string = getCanonicalOrigin()
): string {
  return getOAuthProtectedResourceMetadataUrl(new URL(`${origin}/api/mcp`));
}

/**
 * Builds the RFC 8414 Authorization Server Metadata document.
 * Strictly advertises token_endpoint_auth_methods_supported: ["none"] for public MCP clients.
 */
export function buildMcpAuthorizationServerMetadata(
  origin: string = getCanonicalOrigin()
): OAuthMetadata & Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    scopes_supported: [...SUPPORTED_AI_TOKEN_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    service_documentation: `${origin}/settings/tokens`,
  };
}

/**
 * Builds the RFC 9728 Protected Resource Metadata document.
 */
export function buildMcpProtectedResourceMetadata(
  origin: string = getCanonicalOrigin(),
  resourceUrl: string = getCanonicalMcpResource()
): OAuthProtectedResourceMetadata & { bearer_methods_supported: string[] } {
  const oauthMetadata = buildMcpAuthorizationServerMetadata(origin);
  const allowInsecure =
    process.env.NODE_ENV !== 'production' &&
    (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1'));

  const base = buildOAuthProtectedResourceMetadata({
    oauthMetadata,
    resourceServerUrl: new URL(resourceUrl),
    scopesSupported: [...SUPPORTED_AI_TOKEN_SCOPES],
    resourceName: 'Miler Creator MCP Server',
    dangerouslyAllowInsecureIssuerUrl: allowInsecure,
  });

  return {
    ...base,
    bearer_methods_supported: ['header'],
  };
}

/**
 * Formats an RFC 6750 + RFC 9728 WWW-Authenticate header value for 401/403 responses.
 */
export function buildMcpWwwAuthenticateHeader(options?: {
  error?: string;
  errorDescription?: string;
  scopes?: string[];
  resourceMetadataUrl?: string;
}): string {
  const error = options?.error || 'invalid_token';
  const description = (
    options?.errorDescription || 'Missing or invalid Bearer access token'
  ).replace(/["\\]/g, '');
  const resourceMetadataUrl =
    options?.resourceMetadataUrl || getMcpProtectedResourceMetadataUrl();

  let header = `Bearer error="${error}", error_description="${description}"`;
  if (options?.scopes && options.scopes.length > 0) {
    header += `, scope="${options.scopes.join(' ')}"`;
  }
  header += `, resource_metadata="${resourceMetadataUrl}"`;
  return header;
}

/**
 * Resolves the strict allowlist of permitted OAuth redirect URIs.
 * Defaults to Claude's official remote MCP callback endpoints.
 */
export function getAllowedRedirectUris(): Set<string> {
  const allowed = new Set<string>(DEFAULT_ALLOWED_CLAUDE_REDIRECT_URIS);

  const extraRaw = process.env.MCP_OAUTH_ALLOWED_REDIRECT_URIS;
  if (extraRaw) {
    for (const item of extraRaw.split(',')) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      try {
        const parsed = new URL(trimmed);
        if (
          parsed.protocol === 'https:' &&
          !parsed.username &&
          !parsed.password &&
          !parsed.hash &&
          !parsed.search
        ) {
          allowed.add(`${parsed.origin}${parsed.pathname}`);
        }
      } catch {
        // Ignore malformed entries
      }
    }
  }

  return allowed;
}

/**
 * Strictly validates a redirect URI against the allowlist and URL security invariants.
 */
export function validateRedirectUri(rawUri: unknown): {
  valid: boolean;
  normalizedUri?: string;
  reason?: string;
} {
  if (!rawUri || typeof rawUri !== 'string') {
    return { valid: false, reason: 'redirect_uri must be a non-empty string' };
  }

  const trimmed = rawUri.trim();
  if (trimmed.length === 0 || trimmed.length > 512) {
    return { valid: false, reason: 'redirect_uri length is invalid' };
  }

  if (/[\s\x00-\x1F\x7F\\]/.test(trimmed)) {
    return {
      valid: false,
      reason: 'redirect_uri contains forbidden whitespace, control, or backslash characters',
    };
  }

  if (trimmed.includes('#') || trimmed.includes('?')) {
    return {
      valid: false,
      reason: 'redirect_uri must not contain query parameters or fragments',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'redirect_uri is not a valid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'redirect_uri must use the https scheme' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'redirect_uri must not contain userinfo credentials' };
  }

  if (
    parsed.pathname.includes('..') ||
    parsed.pathname.includes('//') ||
    parsed.pathname.includes('/./')
  ) {
    return { valid: false, reason: 'redirect_uri contains forbidden path traversal segments' };
  }

  const normalized = `${parsed.origin}${parsed.pathname}`;
  const allowlist = getAllowedRedirectUris();

  if (!allowlist.has(normalized)) {
    return {
      valid: false,
      reason: `redirect_uri "${normalized}" is not an allowlisted MCP callback URI`,
    };
  }

  return { valid: true, normalizedUri: normalized };
}

/**
 * Computes the RFC 7636 PKCE S256 code_challenge for a given code_verifier.
 */
export function computePkceS256Challenge(codeVerifier: string): string {
  return crypto.createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
}

/**
 * Validates a PKCE code_verifier against a stored S256 code_challenge in constant time.
 */
export function verifyPkceS256(codeVerifier: unknown, expectedChallenge: unknown): boolean {
  if (typeof codeVerifier !== 'string' || typeof expectedChallenge !== 'string') {
    return false;
  }

  if (
    !PKCE_VERIFIER_REGEX.test(codeVerifier) ||
    !PKCE_S256_CHALLENGE_REGEX.test(expectedChallenge)
  ) {
    return false;
  }

  const computed = computePkceS256Challenge(codeVerifier);
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(expectedChallenge, 'utf8');

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

/**
 * Validates and resolves the scope string requested by an OAuth client.
 * - If omitted or empty, defaults strictly to least-privilege read-only scopes:
 *   ['task:read', 'content:read'].
 * - If provided, every scope token must be one of the 4 supported Miler Creator scopes.
 */
export function parseAndValidateOAuthScopes(
  rawScopeParam: string | null | undefined,
  options: { defaultToReadOnlyWhenOmitted?: boolean } = {}
): { valid: true; scopes: ToolScope[]; wasOmitted: boolean } | { valid: false; message: string } {
  const defaultToReadOnly = options.defaultToReadOnlyWhenOmitted ?? true;

  if (rawScopeParam === undefined || rawScopeParam === null || rawScopeParam.trim() === '') {
    if (!defaultToReadOnly) {
      return { valid: true, scopes: [], wasOmitted: true };
    }
    return {
      valid: true,
      scopes: [...DEFAULT_READ_ONLY_SCOPES],
      wasOmitted: true,
    };
  }

  const parts = rawScopeParam
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0 || parts.length > 10) {
    return { valid: false, message: 'Invalid scope parameter format' };
  }

  const validSet = new Set<string>(SUPPORTED_AI_TOKEN_SCOPES);
  const resolved: ToolScope[] = [];

  for (const part of parts) {
    if (!validSet.has(part)) {
      return {
        valid: false,
        message: `Unsupported or unrecognized scope "${part}". Supported scopes: ${SUPPORTED_AI_TOKEN_SCOPES.join(', ')}`,
      };
    }
    if (!resolved.includes(part as ToolScope)) {
      resolved.push(part as ToolScope);
    }
  }

  return { valid: true, scopes: resolved, wasOmitted: false };
}

/**
 * Generates a high-entropy single-use OAuth authorization code.
 */
export function generateOAuthAuthorizationCode(): { rawCode: string; codeHash: string } {
  const randomHex = crypto.randomBytes(32).toString('hex');
  const rawCode = `ctc_code_${randomHex}`;
  const codeHash = hashAiToken(rawCode);
  return { rawCode, codeHash };
}

/**
 * Generates a high-entropy single-use OAuth refresh token.
 */
export function generateOAuthRefreshToken(): { rawRefreshToken: string; refreshTokenHash: string } {
  const randomHex = crypto.randomBytes(32).toString('hex');
  const rawRefreshToken = `ctc_rt_${randomHex}`;
  const refreshTokenHash = hashAiToken(rawRefreshToken);
  return { rawRefreshToken, refreshTokenHash };
}

export interface RegisterClientInput {
  client_name?: unknown;
  redirect_uris?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
  token_endpoint_auth_method?: unknown;
  scope?: unknown;
}

export interface RegisteredClientMetadata {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: 'none';
}

export interface OAuthServiceOptions {
  adminClient?: SupabaseClient<Database>;
  ipAddress?: string | null;
  userAgent?: string | null;
  referenceTime?: Date;
  expectedResource?: string;
}

/**
 * RFC 7591 Dynamic Client Registration for public MCP clients.
 * Strictly validates redirect URIs against the Claude callback allowlist,
 * enforces public client auth ('none'), never generates client secrets,
 * and enforces registration rate limits.
 */
export async function registerOAuthClient(
  input: RegisterClientInput,
  options: OAuthServiceOptions = {}
): Promise<RegisteredClientMetadata> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new OAuthError(
      OAuthErrorCode.InvalidClientMetadata,
      'Client registration payload must be a JSON object'
    );
  }

  // 1. Validate redirect_uris (required, 1..5 items, all allowlisted)
  if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length === 0) {
    throw new OAuthError(
      OAuthErrorCode.InvalidRedirectUri,
      'redirect_uris is required and must be a non-empty array'
    );
  }

  if (input.redirect_uris.length > 5) {
    throw new OAuthError(
      OAuthErrorCode.InvalidRedirectUri,
      'redirect_uris cannot contain more than 5 URIs'
    );
  }

  const normalizedRedirectUris: string[] = [];
  for (const rawUri of input.redirect_uris) {
    const check = validateRedirectUri(rawUri);
    if (!check.valid || !check.normalizedUri) {
      throw new OAuthError(
        OAuthErrorCode.InvalidRedirectUri,
        check.reason || 'Invalid redirect_uri'
      );
    }
    if (!normalizedRedirectUris.includes(check.normalizedUri)) {
      normalizedRedirectUris.push(check.normalizedUri);
    }
  }

  // 2. Enforce public client authentication method ('none' only)
  const authMethod =
    input.token_endpoint_auth_method === undefined
      ? 'none'
      : input.token_endpoint_auth_method;

  if (authMethod !== 'none') {
    throw new OAuthError(
      OAuthErrorCode.InvalidClientMetadata,
      'Only public clients with token_endpoint_auth_method="none" are supported'
    );
  }

  // 3. Validate grant_types
  const allowedGrants = new Set(['authorization_code', 'refresh_token']);
  let grantTypes: string[] = ['authorization_code', 'refresh_token'];
  if (input.grant_types !== undefined) {
    if (
      !Array.isArray(input.grant_types) ||
      input.grant_types.length === 0 ||
      input.grant_types.length > 2 ||
      !input.grant_types.every((g) => typeof g === 'string' && allowedGrants.has(g)) ||
      !input.grant_types.includes('authorization_code')
    ) {
      throw new OAuthError(
        OAuthErrorCode.InvalidClientMetadata,
        'grant_types must only contain "authorization_code" and optionally "refresh_token"'
      );
    }
    grantTypes = Array.from(new Set(input.grant_types as string[]));
  }

  // 4. Validate response_types
  let responseTypes: string[] = ['code'];
  if (input.response_types !== undefined) {
    if (
      !Array.isArray(input.response_types) ||
      input.response_types.length !== 1 ||
      input.response_types[0] !== 'code'
    ) {
      throw new OAuthError(
        OAuthErrorCode.InvalidClientMetadata,
        'response_types must be ["code"]'
      );
    }
    responseTypes = ['code'];
  }

  // 5. Validate and sanitize client_name
  let clientName = 'Claude';
  if (input.client_name !== undefined && input.client_name !== null) {
    if (typeof input.client_name !== 'string') {
      throw new OAuthError(
        OAuthErrorCode.InvalidClientMetadata,
        'client_name must be a string'
      );
    }
    const trimmedName = input.client_name.trim();
    if (
      trimmedName.length < 1 ||
      trimmedName.length > 100 ||
      /[\x00-\x1F\x7F<>]/.test(trimmedName)
    ) {
      throw new OAuthError(
        OAuthErrorCode.InvalidClientMetadata,
        'client_name must be between 1 and 100 safe characters'
      );
    }
    clientName = trimmedName;
  }

  const adminClient = options.adminClient ?? createAdminClient();
  const now = options.referenceTime ?? new Date();
  const oneMinuteAgoIso = new Date(now.getTime() - 60_000).toISOString();

  // 6. Abuse protection: check recent registrations per IP and globally
  if (options.ipAddress) {
    const { count: ipCount, error: ipCountErr } = await adminClient
      .from('oauth_clients')
      .select('id', { count: 'exact', head: true })
      .eq('created_by_ip', options.ipAddress)
      .gte('created_at', oneMinuteAgoIso);

    if (!ipCountErr && typeof ipCount === 'number' && ipCount >= MAX_DCR_REGISTRATIONS_PER_IP_PER_MINUTE) {
      throw new OAuthError(
        OAuthErrorCode.TooManyRequests,
        'Dynamic client registration rate limit exceeded. Please try again later.'
      );
    }
  }

  const { count: globalCount, error: globalCountErr } = await adminClient
    .from('oauth_clients')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', oneMinuteAgoIso);

  if (
    !globalCountErr &&
    typeof globalCount === 'number' &&
    globalCount >= MAX_DCR_REGISTRATIONS_GLOBAL_PER_MINUTE
  ) {
    throw new OAuthError(
      OAuthErrorCode.TooManyRequests,
      'Dynamic client registration rate limit exceeded. Please try again later.'
    );
  }

  const clientId = `ctc_client_${crypto.randomBytes(16).toString('hex')}`;
  const nowIso = now.toISOString();

  const { error: insertErr } = await adminClient.from('oauth_clients').insert({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: normalizedRedirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: 'none',
    created_by_ip: options.ipAddress || null,
    created_at: nowIso,
  });

  if (insertErr) {
    throw new OAuthError(
      OAuthErrorCode.ServerError,
      'Failed to persist dynamic client registration'
    );
  }

  await logAiAuditEvent(adminClient, {
    workspaceId: null,
    actorType: 'ai_client',
    actorId: clientId,
    eventType: 'oauth.client_registered',
    entityType: 'oauth_client',
    details: {
      clientId,
      clientName,
      redirectUris: normalizedRedirectUris,
    },
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
  });

  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: clientName,
    redirect_uris: normalizedRedirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: 'none',
  };
}

export interface AuthorizeRequestValidationInput {
  clientId?: string | null;
  redirectUri?: string | null;
  responseType?: string | null;
  codeChallenge?: string | null;
  codeChallengeMethod?: string | null;
  state?: string | null;
  scope?: string | null;
  resource?: string | null;
}

export interface ValidatedAuthorizeRequest {
  client: {
    clientId: string;
    clientName: string;
    redirectUris: string[];
  };
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  initialScopes: ToolScope[];
  wasScopeOmitted: boolean;
  resource: string;
}

/**
 * Validates incoming GET /oauth/authorize parameters before rendering the consent UI
 * or issuing an authorization code.
 * Never redirects to an unvalidated redirect_uri.
 */
export async function validateOAuthAuthorizeParams(
  input: AuthorizeRequestValidationInput,
  options: OAuthServiceOptions = {}
): Promise<
  | { valid: true; data: ValidatedAuthorizeRequest }
  | {
      valid: false;
      canRedirectToCallback: boolean;
      redirectUri?: string;
      state?: string;
      errorCode: string;
      errorDescription: string;
    }
> {
  const adminClient = options.adminClient ?? createAdminClient();
  const expectedResource = options.expectedResource ?? getCanonicalMcpResource();

  // 1. Validate client_id and redirect_uri first (RFC 6749 §4.1.2.1: NEVER redirect if client_id or redirect_uri is invalid)
  const rawClientId = input.clientId?.trim();
  if (!rawClientId || rawClientId.length > 128) {
    return {
      valid: false,
      canRedirectToCallback: false,
      errorCode: OAuthErrorCode.InvalidRequest,
      errorDescription: 'Missing or invalid client_id parameter',
    };
  }

  const redirectCheck = validateRedirectUri(input.redirectUri);
  if (!redirectCheck.valid || !redirectCheck.normalizedUri) {
    return {
      valid: false,
      canRedirectToCallback: false,
      errorCode: OAuthErrorCode.InvalidRequest,
      errorDescription: redirectCheck.reason || 'Invalid or disallowed redirect_uri',
    };
  }

  const { data: clientRecord, error: clientErr } = await adminClient
    .from('oauth_clients')
    .select('client_id, client_name, redirect_uris')
    .eq('client_id', rawClientId)
    .maybeSingle();

  if (clientErr || !clientRecord) {
    return {
      valid: false,
      canRedirectToCallback: false,
      errorCode: OAuthErrorCode.UnauthorizedClient,
      errorDescription: 'Unknown or unregistered OAuth client_id',
    };
  }

  if (!clientRecord.redirect_uris.includes(redirectCheck.normalizedUri)) {
    return {
      valid: false,
      canRedirectToCallback: false,
      errorCode: OAuthErrorCode.InvalidRequest,
      errorDescription: 'redirect_uri does not match the URIs registered for this client',
    };
  }

  const verifiedRedirectUri = redirectCheck.normalizedUri;
  const rawState = input.state?.trim() || '';
  const hasValidState = SAFE_STATE_REGEX.test(rawState);

  if (!hasValidState) {
    return {
      valid: false,
      canRedirectToCallback: true,
      redirectUri: verifiedRedirectUri,
      errorCode: OAuthErrorCode.InvalidRequest,
      errorDescription: 'Missing or malformed state parameter',
    };
  }

  // 2. Validate response_type === 'code'
  if (input.responseType !== 'code') {
    return {
      valid: false,
      canRedirectToCallback: true,
      redirectUri: verifiedRedirectUri,
      state: rawState,
      errorCode: OAuthErrorCode.UnsupportedResponseType,
      errorDescription: 'Only response_type="code" is supported',
    };
  }

  // 3. Validate PKCE S256 (Mandatory in OAuth 2.1 & MCP Auth Spec)
  if (input.codeChallengeMethod !== 'S256') {
    return {
      valid: false,
      canRedirectToCallback: true,
      redirectUri: verifiedRedirectUri,
      state: rawState,
      errorCode: OAuthErrorCode.InvalidRequest,
      errorDescription: 'PKCE with code_challenge_method="S256" is required',
    };
  }

  const rawChallenge = input.codeChallenge?.trim() || '';
  if (!PKCE_S256_CHALLENGE_REGEX.test(rawChallenge)) {
    return {
      valid: false,
      canRedirectToCallback: true,
      redirectUri: verifiedRedirectUri,
      state: rawState,
      errorCode: OAuthErrorCode.InvalidRequest,
      errorDescription: 'Missing or invalid PKCE code_challenge',
    };
  }

  // 4. Validate RFC 8707 resource parameter if provided
  if (input.resource !== undefined && input.resource !== null && input.resource.trim() !== '') {
    if (!isCanonicalMcpResource(input.resource, expectedResource)) {
      return {
        valid: false,
        canRedirectToCallback: true,
        redirectUri: verifiedRedirectUri,
        state: rawState,
        errorCode: OAuthErrorCode.InvalidTarget,
        errorDescription: `Requested resource does not match canonical MCP resource (${expectedResource})`,
      };
    }
  }

  // 5. Parse and validate requested scopes (defaulting to least-privilege read-only scopes when omitted)
  const scopeCheck = parseAndValidateOAuthScopes(input.scope, {
    defaultToReadOnlyWhenOmitted: true,
  });

  if (!scopeCheck.valid) {
    return {
      valid: false,
      canRedirectToCallback: true,
      redirectUri: verifiedRedirectUri,
      state: rawState,
      errorCode: OAuthErrorCode.InvalidScope,
      errorDescription: scopeCheck.message,
    };
  }

  return {
    valid: true,
    data: {
      client: {
        clientId: clientRecord.client_id,
        clientName: clientRecord.client_name,
        redirectUris: clientRecord.redirect_uris,
      },
      redirectUri: verifiedRedirectUri,
      state: rawState,
      codeChallenge: rawChallenge,
      codeChallengeMethod: 'S256',
      initialScopes: scopeCheck.scopes,
      wasScopeOmitted: scopeCheck.wasOmitted,
      resource: expectedResource,
    },
  };
}

export interface IssueAuthorizationCodeInput extends AuthorizeRequestValidationInput {
  userId: string;
  workspaceId: string;
  approvedScopes: ToolScope[];
}

export interface IssueAuthorizationCodeResult {
  code: string;
  redirectUrl: string;
  scopes: ToolScope[];
  resource: string;
}

/**
 * Issues a single-use PKCE S256 authorization code after explicit user consent.
 * Enforces active workspace membership, rejects viewer role, and binds the code
 * to the canonical MCP resource and consented scopes.
 */
export async function issueOAuthAuthorizationCode(
  input: IssueAuthorizationCodeInput,
  options: OAuthServiceOptions = {}
): Promise<IssueAuthorizationCodeResult> {
  const validation = await validateOAuthAuthorizeParams(input, options);
  if (!validation.valid) {
    throw new OAuthError(validation.errorCode, validation.errorDescription);
  }

  const { data: authReq } = validation;

  // Validate approved scopes from user consent
  if (!Array.isArray(input.approvedScopes) || input.approvedScopes.length === 0) {
    throw new OAuthError(
      OAuthErrorCode.AccessDenied,
      'At least one permission scope must be approved'
    );
  }

  const validScopeSet = new Set<string>(SUPPORTED_AI_TOKEN_SCOPES);
  const dedupedScopes: ToolScope[] = [];
  for (const s of input.approvedScopes) {
    if (!validScopeSet.has(s)) {
      throw new OAuthError(OAuthErrorCode.InvalidScope, `Invalid scope "${s}"`);
    }
    if (!dedupedScopes.includes(s)) {
      dedupedScopes.push(s);
    }
  }

  const adminClient = options.adminClient ?? createAdminClient();
  const now = options.referenceTime ?? new Date();

  // Verify active workspace membership and role
  const { data: memberRecord, error: memberErr } = await adminClient
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', input.workspaceId)
    .eq('user_id', input.userId)
    .maybeSingle();

  if (memberErr || !memberRecord) {
    throw new OAuthError(
      OAuthErrorCode.AccessDenied,
      'Unauthorized: You are not an active member of the selected workspace'
    );
  }

  const role = memberRecord.role as WorkspaceRole;
  if (role === 'viewer') {
    const hasWriteScope = dedupedScopes.some((s) =>
      (WRITE_CAPABLE_SCOPES as readonly string[]).includes(s)
    );
    throw new OAuthError(
      OAuthErrorCode.AccessDenied,
      hasWriteScope
        ? 'Forbidden: Workspace viewers cannot authorize write-capable OAuth permissions'
        : 'Forbidden: Workspace viewers are not permitted to authorize AI MCP tokens'
    );
  }

  const { rawCode, codeHash } = generateOAuthAuthorizationCode();
  const expiresAtIso = new Date(
    now.getTime() + DEFAULT_AUTH_CODE_TTL_SECONDS * 1000
  ).toISOString();

  const { error: insertErr } = await adminClient.from('oauth_authorization_codes').insert({
    code_hash: codeHash,
    client_id: authReq.client.clientId,
    user_id: input.userId,
    workspace_id: input.workspaceId,
    redirect_uri: authReq.redirectUri,
    scopes: dedupedScopes,
    code_challenge: authReq.codeChallenge,
    code_challenge_method: 'S256',
    resource: authReq.resource,
    expires_at: expiresAtIso,
    created_at: now.toISOString(),
  });

  if (insertErr) {
    throw new OAuthError(
      OAuthErrorCode.ServerError,
      'Failed to create OAuth authorization code'
    );
  }

  await logAiAuditEvent(adminClient, {
    workspaceId: input.workspaceId,
    actorType: 'user',
    actorId: input.userId,
    eventType: 'oauth.code_issued',
    entityType: 'oauth_grant',
    details: {
      clientId: authReq.client.clientId,
      clientName: authReq.client.clientName,
      scopes: dedupedScopes,
      resource: authReq.resource,
      expiresAt: expiresAtIso,
    },
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
  });

  const callbackUrl = new URL(authReq.redirectUri);
  callbackUrl.searchParams.set('code', rawCode);
  callbackUrl.searchParams.set('state', authReq.state);

  return {
    code: rawCode,
    redirectUrl: callbackUrl.toString(),
    scopes: dedupedScopes,
    resource: authReq.resource,
  };
}

export interface TokenExchangeResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface ExchangeAuthorizationCodeInput {
  code?: string | null;
  clientId?: string | null;
  redirectUri?: string | null;
  codeVerifier?: string | null;
  resource?: string | null;
  scope?: string | null;
}

function formatOAuthExchangeError(errorCode: string, errorReason: string): string {
  switch (errorReason) {
    case 'code_reused':
      return `Authorization code has already been used (${errorReason})`;
    case 'code_expired':
      return `Authorization code has expired (${errorReason})`;
    case 'client_mismatch':
      return `client_id mismatch (${errorReason})`;
    case 'redirect_uri_mismatch':
      return `redirect_uri mismatch (${errorReason})`;
    case 'pkce_verification_failed':
      return `PKCE S256 verification failed (${errorReason})`;
    case 'resource_mismatch':
      return `Resource binding mismatch (${errorReason})`;
    case 'scope_escalation':
      return `Requested scope exceeds user-consented permissions (${errorReason})`;
    case 'membership_revoked':
      return `User is no longer an active member of the workspace (${errorReason})`;
    case 'viewer_role_forbidden':
      return `Forbidden: Workspace viewers cannot obtain OAuth tokens (${errorReason})`;
    default:
      return `Authorization code exchange failed: ${errorReason}`;
  }
}

function formatOAuthRefreshError(errorCode: string, errorReason: string): string {
  switch (errorReason) {
    case 'refresh_token_replayed':
    case 'refresh_token_replayed_grant_revoked':
      return `Refresh token replay detected; grant family has been revoked (${errorReason})`;
    case 'refresh_token_revoked':
      return `Refresh token has been revoked (${errorReason})`;
    case 'refresh_token_expired':
      return `Refresh token has expired (${errorReason})`;
    case 'linked_access_token_revoked':
      return `Linked access token has been revoked (${errorReason})`;
    case 'client_mismatch':
      return `client_id mismatch (${errorReason})`;
    case 'resource_mismatch':
      return `Resource binding mismatch (${errorReason})`;
    case 'scope_escalation':
      return `Requested scope exceeds originally granted permissions (${errorReason})`;
    case 'membership_revoked':
      return `User is no longer an active workspace member (${errorReason})`;
    case 'viewer_role_forbidden':
      return `Forbidden: Workspace viewers cannot refresh OAuth credentials (${errorReason})`;
    default:
      return `Refresh token exchange failed: ${errorReason}`;
  }
}

/**
 * Exchanges a single-use authorization code + PKCE S256 code_verifier for an
 * access token (ctc_live_...) and refresh token (ctc_rt_...) via atomic PostgreSQL RPC.
 *
 * Strict Fail-Closed Security:
 * The atomic PostgreSQL RPC exchange_oauth_authorization_code is the ONLY production mechanism.
 * If the RPC is unavailable (e.g. PGRST202 or schema cache missing), execution fails closed with
 * an OAuth server_error and never falls back to non-transactional database operations.
 */
export async function exchangeAuthorizationCode(
  input: ExchangeAuthorizationCodeInput,
  options: OAuthServiceOptions = {}
): Promise<TokenExchangeResponse> {
  const rawCode = input.code?.trim() || '';
  const rawClientId = input.clientId?.trim() || '';
  const rawRedirectUri = input.redirectUri?.trim() || '';
  const rawVerifier = input.codeVerifier?.trim() || '';
  const expectedResource = options.expectedResource ?? getCanonicalMcpResource();

  if (!rawCode || !OAUTH_CODE_FORMAT_REGEX.test(rawCode)) {
    throw new OAuthError(OAuthErrorCode.InvalidGrant, 'Missing or malformed authorization code');
  }

  if (!rawClientId) {
    throw new OAuthError(OAuthErrorCode.InvalidRequest, 'Missing client_id parameter');
  }

  const redirectCheck = validateRedirectUri(rawRedirectUri);
  if (!redirectCheck.valid || !redirectCheck.normalizedUri) {
    throw new OAuthError(OAuthErrorCode.InvalidGrant, 'Invalid redirect_uri parameter');
  }

  if (!rawVerifier || !PKCE_VERIFIER_REGEX.test(rawVerifier)) {
    throw new OAuthError(
      OAuthErrorCode.InvalidGrant,
      'Missing or invalid PKCE code_verifier parameter'
    );
  }

  // Validate RFC 8707 resource parameter if provided
  if (input.resource !== undefined && input.resource !== null && input.resource.trim() !== '') {
    if (!isCanonicalMcpResource(input.resource, expectedResource)) {
      throw new OAuthError(
        OAuthErrorCode.InvalidTarget,
        `Requested resource does not match canonical MCP resource (${expectedResource})`
      );
    }
  }

  // Validate optional scope subset request
  let requestedScopes: ToolScope[] | null = null;
  if (input.scope !== undefined && input.scope !== null && input.scope.trim() !== '') {
    const scopeCheck = parseAndValidateOAuthScopes(input.scope, {
      defaultToReadOnlyWhenOmitted: false,
    });
    if (!scopeCheck.valid) {
      throw new OAuthError(OAuthErrorCode.InvalidScope, scopeCheck.message);
    }
    requestedScopes = scopeCheck.scopes;
  }

  const adminClient = options.adminClient ?? createAdminClient();
  const now = options.referenceTime ?? new Date();
  const nowIso = now.toISOString();

  const codeHash = hashAiToken(rawCode);
  const computedChallenge = computePkceS256Challenge(rawVerifier);

  const accessBundle = generateAiToken();
  const refreshBundle = generateOAuthRefreshToken();
  const accessExpiresAtIso = new Date(
    now.getTime() + DEFAULT_ACCESS_TOKEN_TTL_SECONDS * 1000
  ).toISOString();
  const refreshExpiresAtIso = new Date(
    now.getTime() + DEFAULT_REFRESH_TOKEN_TTL_SECONDS * 1000
  ).toISOString();
  const tokenName = 'Claude Web (OAuth)';

  // Atomic PostgreSQL RPC is the ONLY production mechanism for authorization-code exchange
  if (typeof adminClient.rpc !== 'function') {
    console.error(
      '[OAuth Server Error] adminClient.rpc is unavailable; PostgreSQL RPC is required for atomic code exchange. Failing closed.',
      { clientId: rawClientId }
    );
    throw new OAuthError(
      OAuthErrorCode.ServerError,
      'Database error during authorization code exchange'
    );
  }

  const { data: rpcData, error: rpcErr } = await adminClient.rpc(
    'exchange_oauth_authorization_code',
    {
      p_code_hash: codeHash,
      p_client_id: rawClientId,
      p_redirect_uri: redirectCheck.normalizedUri,
      p_computed_code_challenge: computedChallenge,
      p_expected_resource: expectedResource,
      p_requested_scopes: requestedScopes,
      p_new_access_token_hash: accessBundle.tokenHash,
      p_new_access_token_prefix: accessBundle.tokenPrefix,
      p_new_refresh_token_hash: refreshBundle.refreshTokenHash,
      p_token_name: tokenName,
      p_access_expires_at: accessExpiresAtIso,
      p_refresh_expires_at: refreshExpiresAtIso,
      p_now: nowIso,
    }
  );

  if (rpcErr) {
    const isFunctionMissing =
      rpcErr.message?.includes('does not exist') ||
      rpcErr.code === 'PGRST202' ||
      rpcErr.message?.includes('could not find the function');

    if (isFunctionMissing) {
      console.error(
        '[OAuth Server Error] Required PostgreSQL RPC "exchange_oauth_authorization_code" is unavailable in Supabase schema cache (e.g. migration M11 pending or PGRST202). Failing closed.',
        {
          code: rpcErr.code,
          message: rpcErr.message,
          clientId: rawClientId,
        }
      );
    } else {
      console.error(
        '[OAuth Server Error] Database error during "exchange_oauth_authorization_code" RPC',
        {
          code: rpcErr.code,
          message: rpcErr.message,
          clientId: rawClientId,
        }
      );
    }

    throw new OAuthError(
      OAuthErrorCode.ServerError,
      'Database error during authorization code exchange'
    );
  }

  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (!row) {
    console.error(
      '[OAuth Server Error] exchange_oauth_authorization_code returned empty result. Failing closed.',
      { clientId: rawClientId }
    );
    throw new OAuthError(
      OAuthErrorCode.ServerError,
      'Database error during authorization code exchange'
    );
  }

  if (!row.allowed) {
    await logAiAuditEvent(adminClient, {
      workspaceId: row.workspace_id || null,
      actorType: 'ai_client',
      actorId: rawClientId,
      eventType: 'oauth.auth_failed',
      entityType: 'oauth_grant',
      details: {
        stage: 'code_exchange',
        reason: row.error_reason || 'exchange_rejected',
      },
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
    });
    throw new OAuthError(
      row.error_code || OAuthErrorCode.InvalidGrant,
      formatOAuthExchangeError(row.error_code || 'invalid_grant', row.error_reason || 'invalid_grant')
    );
  }

  const grantedScopes = (row.granted_scopes as ToolScope[]) || [];
  await logAiAuditEvent(adminClient, {
    workspaceId: row.workspace_id,
    actorType: 'user',
    actorId: row.user_id || rawClientId,
    eventType: 'oauth.token_exchanged',
    entityType: 'ai_api_token',
    entityId: row.access_token_id,
    details: {
      clientId: rawClientId,
      tokenPrefix: accessBundle.tokenPrefix,
      scopes: grantedScopes,
      resource: row.resource,
    },
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
  });

  return {
    access_token: accessBundle.rawToken,
    token_type: 'Bearer',
    expires_in: DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshBundle.rawRefreshToken,
    scope: grantedScopes.join(' '),
  };
}

export interface RotateRefreshTokenInput {
  refreshToken?: string | null;
  clientId?: string | null;
  resource?: string | null;
  scope?: string | null;
}

/**
 * Atomically rotates an OAuth refresh token, enforces single-use replay detection,
 * checks linked access token revocation and active workspace membership/role,
 * and issues a fresh access token + refresh token pair via atomic PostgreSQL RPC.
 *
 * Strict Fail-Closed Security:
 * The atomic PostgreSQL RPC rotate_oauth_refresh_token is the ONLY production mechanism.
 * If the RPC is unavailable (e.g. PGRST202 or schema cache missing), execution fails closed with
 * an OAuth server_error and never falls back to non-transactional database operations.
 */
export async function rotateOAuthRefreshToken(
  input: RotateRefreshTokenInput,
  options: OAuthServiceOptions = {}
): Promise<TokenExchangeResponse> {
  const rawRefreshToken = input.refreshToken?.trim() || '';
  const rawClientId = input.clientId?.trim() || '';
  const expectedResource = options.expectedResource ?? getCanonicalMcpResource();

  if (!rawRefreshToken || !OAUTH_REFRESH_TOKEN_FORMAT_REGEX.test(rawRefreshToken)) {
    throw new OAuthError(OAuthErrorCode.InvalidGrant, 'Missing or malformed refresh_token');
  }

  if (!rawClientId) {
    throw new OAuthError(OAuthErrorCode.InvalidRequest, 'Missing client_id parameter');
  }

  if (input.resource !== undefined && input.resource !== null && input.resource.trim() !== '') {
    if (!isCanonicalMcpResource(input.resource, expectedResource)) {
      throw new OAuthError(
        OAuthErrorCode.InvalidTarget,
        `Requested resource does not match canonical MCP resource (${expectedResource})`
      );
    }
  }

  let requestedScopes: ToolScope[] | null = null;
  if (input.scope !== undefined && input.scope !== null && input.scope.trim() !== '') {
    const scopeCheck = parseAndValidateOAuthScopes(input.scope, {
      defaultToReadOnlyWhenOmitted: false,
    });
    if (!scopeCheck.valid) {
      throw new OAuthError(OAuthErrorCode.InvalidScope, scopeCheck.message);
    }
    requestedScopes = scopeCheck.scopes;
  }

  const adminClient = options.adminClient ?? createAdminClient();
  const now = options.referenceTime ?? new Date();
  const nowIso = now.toISOString();

  const oldRefreshHash = hashAiToken(rawRefreshToken);
  const accessBundle = generateAiToken();
  const refreshBundle = generateOAuthRefreshToken();
  const accessExpiresAtIso = new Date(
    now.getTime() + DEFAULT_ACCESS_TOKEN_TTL_SECONDS * 1000
  ).toISOString();
  const refreshExpiresAtIso = new Date(
    now.getTime() + DEFAULT_REFRESH_TOKEN_TTL_SECONDS * 1000
  ).toISOString();
  const tokenName = 'Claude Web (OAuth)';

  // Atomic PostgreSQL RPC is the ONLY production mechanism for refresh-token rotation
  if (typeof adminClient.rpc !== 'function') {
    console.error(
      '[OAuth Server Error] adminClient.rpc is unavailable; PostgreSQL RPC is required for atomic refresh rotation. Failing closed.',
      { clientId: rawClientId }
    );
    throw new OAuthError(
      OAuthErrorCode.ServerError,
      'Database error during refresh token rotation'
    );
  }

  const { data: rpcData, error: rpcErr } = await adminClient.rpc(
    'rotate_oauth_refresh_token',
    {
      p_old_refresh_token_hash: oldRefreshHash,
      p_client_id: rawClientId,
      p_expected_resource: expectedResource,
      p_requested_scopes: requestedScopes,
      p_new_access_token_hash: accessBundle.tokenHash,
      p_new_access_token_prefix: accessBundle.tokenPrefix,
      p_new_refresh_token_hash: refreshBundle.refreshTokenHash,
      p_token_name: tokenName,
      p_access_expires_at: accessExpiresAtIso,
      p_refresh_expires_at: refreshExpiresAtIso,
      p_now: nowIso,
    }
  );

  if (rpcErr) {
    const isFunctionMissing =
      rpcErr.message?.includes('does not exist') ||
      rpcErr.code === 'PGRST202' ||
      rpcErr.message?.includes('could not find the function');

    if (isFunctionMissing) {
      console.error(
        '[OAuth Server Error] Required PostgreSQL RPC "rotate_oauth_refresh_token" is unavailable in Supabase schema cache (e.g. migration M11 pending or PGRST202). Failing closed.',
        {
          code: rpcErr.code,
          message: rpcErr.message,
          clientId: rawClientId,
        }
      );
    } else {
      console.error(
        '[OAuth Server Error] Database error during "rotate_oauth_refresh_token" RPC',
        {
          code: rpcErr.code,
          message: rpcErr.message,
          clientId: rawClientId,
        }
      );
    }

    throw new OAuthError(
      OAuthErrorCode.ServerError,
      'Database error during refresh token rotation'
    );
  }

  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (!row) {
    console.error(
      '[OAuth Server Error] rotate_oauth_refresh_token returned empty result. Failing closed.',
      { clientId: rawClientId }
    );
    throw new OAuthError(
      OAuthErrorCode.ServerError,
      'Database error during refresh token rotation'
    );
  }

  if (!row.allowed) {
    await logAiAuditEvent(adminClient, {
      workspaceId: row.workspace_id || null,
      actorType: 'ai_client',
      actorId: rawClientId,
      eventType: 'oauth.auth_failed',
      entityType: 'oauth_grant',
      details: {
        stage: 'refresh_rotation',
        reason: row.error_reason || 'refresh_rejected',
      },
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
    });
    throw new OAuthError(
      row.error_code || OAuthErrorCode.InvalidGrant,
      formatOAuthRefreshError(row.error_code || 'invalid_grant', row.error_reason || 'invalid_grant')
    );
  }

  const grantedScopes = (row.granted_scopes as ToolScope[]) || [];
  await logAiAuditEvent(adminClient, {
    workspaceId: row.workspace_id,
    actorType: 'user',
    actorId: row.user_id || rawClientId,
    eventType: 'oauth.token_refreshed',
    entityType: 'ai_api_token',
    entityId: row.new_access_token_id,
    details: {
      clientId: rawClientId,
      oldAccessTokenId: row.old_access_token_id,
      newTokenPrefix: accessBundle.tokenPrefix,
      scopes: grantedScopes,
    },
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
  });

  return {
    access_token: accessBundle.rawToken,
    token_type: 'Bearer',
    expires_in: DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshBundle.rawRefreshToken,
    scope: grantedScopes.join(' '),
  };
}

/**
 * RFC 7009 OAuth 2.0 Token Revocation.
 * Supports revoking either an access token (ctc_live_...) or a refresh token (ctc_rt_...),
 * cascading revocation to linked credentials.
 */
export async function revokeOAuthToken(
  rawToken: string | null | undefined,
  options: OAuthServiceOptions = {}
): Promise<void> {
  if (!rawToken || typeof rawToken !== 'string') {
    return;
  }

  const trimmed = rawToken.trim();
  const adminClient = options.adminClient ?? createAdminClient();
  const nowIso = (options.referenceTime ?? new Date()).toISOString();

  if (ACCESS_TOKEN_FORMAT_REGEX.test(trimmed)) {
    const tokenHash = hashAiToken(trimmed);
    const { data: tokenRecord } = await adminClient
      .from('ai_api_tokens')
      .select('id, workspace_id, created_by')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (tokenRecord) {
      await adminClient
        .from('ai_api_tokens')
        .update({ is_revoked: true, revoked_at: nowIso })
        .eq('id', tokenRecord.id);

      await adminClient
        .from('oauth_refresh_tokens')
        .update({ is_revoked: true, revoked_at: nowIso })
        .eq('access_token_id', tokenRecord.id);

      await logAiAuditEvent(adminClient, {
        workspaceId: tokenRecord.workspace_id,
        actorType: 'ai_client',
        actorId: tokenRecord.id,
        eventType: 'oauth.token_revoked',
        entityType: 'ai_api_token',
        entityId: tokenRecord.id,
        details: { revokedVia: 'oauth_revoke_endpoint', tokenType: 'access_token' },
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });
    }
    return;
  }

  if (OAUTH_REFRESH_TOKEN_FORMAT_REGEX.test(trimmed)) {
    const rtHash = hashAiToken(trimmed);
    const { data: rtRecord } = await adminClient
      .from('oauth_refresh_tokens')
      .select('id, grant_id, access_token_id, workspace_id')
      .eq('token_hash', rtHash)
      .maybeSingle();

    if (rtRecord) {
      await adminClient
        .from('oauth_refresh_tokens')
        .update({ is_revoked: true, revoked_at: nowIso })
        .eq('grant_id', rtRecord.grant_id);

      await adminClient
        .from('ai_api_tokens')
        .update({ is_revoked: true, revoked_at: nowIso })
        .eq('id', rtRecord.access_token_id);

      await logAiAuditEvent(adminClient, {
        workspaceId: rtRecord.workspace_id,
        actorType: 'ai_client',
        actorId: rtRecord.access_token_id,
        eventType: 'oauth.token_revoked',
        entityType: 'oauth_grant',
        entityId: rtRecord.access_token_id,
        details: { revokedVia: 'oauth_revoke_endpoint', tokenType: 'refresh_token' },
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });
    }
  }
}
