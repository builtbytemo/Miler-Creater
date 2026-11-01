'use server';

import { headers } from 'next/headers';
import { OAuthError } from '@modelcontextprotocol/server';
import { createClient } from '@/lib/supabase/server';
import type { ToolScope } from '@/lib/mcp/types';
import {
  issueOAuthAuthorizationCode,
  validateOAuthAuthorizeParams,
  type OAuthServiceOptions,
} from '@/lib/mcp/oauth';
import { SUPPORTED_AI_TOKEN_SCOPES } from '@/lib/validation/ai-token';

export interface SubmitOAuthDecisionInput {
  decision: 'approve' | 'deny';
  clientId: string;
  redirectUri: string;
  responseType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  scope?: string | null;
  resource?: string | null;
  workspaceId?: string;
  approvedScopes?: string[];
}

export interface SubmitOAuthDecisionResult {
  success: boolean;
  redirectUrl?: string;
  error?: string;
}

/**
 * Server action that processes the authenticated user's explicit OAuth consent
 * decision (Approve or Deny).
 *
 * Security guarantees:
 * 1. Verifies the authenticated user via supabase.auth.getUser() against Supabase Auth.
 * 2. Re-validates client_id, allowlisted redirect_uri, PKCE S256, state, and RFC 8707 resource.
 * 3. On denial, redirects back to the verified callback URI with error=access_denied.
 * 4. On approval, verifies active workspace membership, rejects viewer role, binds
 *    only the user-consented scopes, and issues a single-use authorization code.
 */
export async function submitOAuthDecisionAction(
  input: SubmitOAuthDecisionInput,
  serviceOptions?: OAuthServiceOptions
): Promise<SubmitOAuthDecisionResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return {
        success: false,
        error: 'Your authentication session has expired. Please sign in again.',
      };
    }

    const validation = await validateOAuthAuthorizeParams(
      {
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        responseType: input.responseType,
        codeChallenge: input.codeChallenge,
        codeChallengeMethod: input.codeChallengeMethod,
        state: input.state,
        scope: input.scope,
        resource: input.resource,
      },
      serviceOptions
    );

    if (!validation.valid) {
      return {
        success: false,
        error: validation.errorDescription,
      };
    }

    const { data: authReq } = validation;

    if (input.decision === 'deny') {
      const denyUrl = new URL(authReq.redirectUri);
      denyUrl.searchParams.set('error', 'access_denied');
      denyUrl.searchParams.set(
        'error_description',
        'The user denied the OAuth authorization request'
      );
      denyUrl.searchParams.set('state', authReq.state);

      return {
        success: true,
        redirectUrl: denyUrl.toString(),
      };
    }

    if (input.decision !== 'approve') {
      return {
        success: false,
        error: 'Invalid authorization decision',
      };
    }

    if (!input.workspaceId || typeof input.workspaceId !== 'string') {
      return {
        success: false,
        error: 'Please select a workspace to authorize.',
      };
    }

    if (!Array.isArray(input.approvedScopes) || input.approvedScopes.length === 0) {
      return {
        success: false,
        error: 'Please select at least one permission scope to approve access.',
      };
    }

    const validSet = new Set<string>(SUPPORTED_AI_TOKEN_SCOPES);
    const cleanScopes: ToolScope[] = [];
    for (const rawScope of input.approvedScopes) {
      if (typeof rawScope !== 'string' || !validSet.has(rawScope)) {
        return {
          success: false,
          error: `Invalid permission scope: "${String(rawScope)}"`,
        };
      }
      if (!cleanScopes.includes(rawScope as ToolScope)) {
        cleanScopes.push(rawScope as ToolScope);
      }
    }

    let ipAddress: string | null = null;
    let userAgent: string | null = null;
    try {
      const reqHeaders = await headers();
      ipAddress =
        reqHeaders.get('x-forwarded-for')?.split(',')[0].trim() ||
        reqHeaders.get('x-real-ip') ||
        null;
      userAgent = reqHeaders.get('user-agent') || null;
    } catch {
      // Non-request test environment fallback
    }

    const issued = await issueOAuthAuthorizationCode(
      {
        userId: user.id,
        workspaceId: input.workspaceId,
        approvedScopes: cleanScopes,
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        responseType: input.responseType,
        codeChallenge: input.codeChallenge,
        codeChallengeMethod: input.codeChallengeMethod,
        state: input.state,
        scope: input.scope,
        resource: input.resource,
      },
      {
        ipAddress,
        userAgent,
        ...serviceOptions,
      }
    );

    return {
      success: true,
      redirectUrl: issued.redirectUrl,
    };
  } catch (err) {
    if (err instanceof OAuthError) {
      return {
        success: false,
        error: err.message,
      };
    }
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred while processing your authorization decision.',
    };
  }
}
