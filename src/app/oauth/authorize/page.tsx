import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { ShieldAlert } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getSafeRedirectPath } from '@/lib/auth/redirects';
import { validateOAuthAuthorizeParams } from '@/lib/mcp/oauth';
import {
  OAuthConsentForm,
  type AuthorizableWorkspaceOption,
} from '@/components/oauth/OAuthConsentForm';
import type { WorkspaceRole } from '@/types/database';

export const instant = false;

interface OAuthAuthorizePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getSingleParam(
  params: Record<string, string | string[] | undefined>,
  key: string
): string | null {
  const val = params[key];
  if (typeof val === 'string') {
    return val;
  }
  return null;
}

export default async function OAuthAuthorizePage({
  searchParams,
}: OAuthAuthorizePageProps) {
  await connection();
  const resolvedParams = await searchParams;

  const clientId = getSingleParam(resolvedParams, 'client_id');
  const redirectUri = getSingleParam(resolvedParams, 'redirect_uri');
  const responseType = getSingleParam(resolvedParams, 'response_type');
  const codeChallenge = getSingleParam(resolvedParams, 'code_challenge');
  const codeChallengeMethod = getSingleParam(resolvedParams, 'code_challenge_method');
  const state = getSingleParam(resolvedParams, 'state');
  const scope = getSingleParam(resolvedParams, 'scope');
  const resource = getSingleParam(resolvedParams, 'resource');

  // 1. Validate OAuth 2.1 authorization request parameters before anything else
  const validation = await validateOAuthAuthorizeParams({
    clientId,
    redirectUri,
    responseType,
    codeChallenge,
    codeChallengeMethod,
    state,
    scope,
    resource,
  });

  if (!validation.valid) {
    let returnErrorHref: string | null = null;
    if (validation.canRedirectToCallback && validation.redirectUri) {
      const errUrl = new URL(validation.redirectUri);
      errUrl.searchParams.set('error', validation.errorCode);
      errUrl.searchParams.set('error_description', validation.errorDescription);
      if (validation.state) {
        errUrl.searchParams.set('state', validation.state);
      }
      returnErrorHref = errUrl.toString();
    }

    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-6 font-sans">
        <div
          data-testid="oauth-authorize-error"
          className="w-full max-w-md rounded-2xl bg-neutral-900 border border-red-900/60 p-6 space-y-4 shadow-2xl"
        >
          <div className="flex items-center gap-3 text-red-400">
            <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/30">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-red-400">
                OAuth 2.1 Authorization Error
              </p>
              <h1 className="text-base font-bold text-white">{validation.errorCode}</h1>
            </div>
          </div>

          <p className="text-xs text-neutral-300 leading-relaxed">
            {validation.errorDescription}
          </p>

          <div className="pt-2 flex items-center justify-between gap-3">
            <Link
              href="/dashboard"
              className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold text-neutral-200 transition-colors"
            >
              Back to Dashboard
            </Link>

            {returnErrorHref && (
              <a
                href={returnErrorHref}
                className="px-4 py-2 rounded-xl bg-red-600/20 border border-red-500/40 hover:bg-red-600/30 text-xs font-semibold text-red-200 transition-colors"
              >
                Return to Client
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 2. Verify authenticated Supabase user session; if unauthenticated, preserve full OAuth request across sign-in
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(resolvedParams)) {
      if (typeof v === 'string') {
        query.set(k, v);
      }
    }
    const rawTarget = `/oauth/authorize?${query.toString()}`;
    const safeTarget = getSafeRedirectPath(rawTarget, '/dashboard');
    redirect(`/auth/sign-in?redirectTo=${encodeURIComponent(safeTarget)}`);
  }

  // 3. Load the authenticated user's workspace memberships
  const { data: memberships } = await supabase
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', user.id);

  const workspaceIds = (memberships || []).map((m) => m.workspace_id);
  const roleByWorkspace = new Map<string, WorkspaceRole>(
    (memberships || []).map((m) => [m.workspace_id, m.role as WorkspaceRole])
  );

  let workspaces: AuthorizableWorkspaceOption[] = [];
  if (workspaceIds.length > 0) {
    const { data: wsRows } = await supabase
      .from('workspaces')
      .select('id, name')
      .in('id', workspaceIds)
      .order('created_at', { ascending: true });

    workspaces = (wsRows || []).map((ws) => ({
      id: ws.id,
      name: ws.name,
      role: roleByWorkspace.get(ws.id) || 'member',
    }));
  }

  const { data: authReq } = validation;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-6 font-sans">
      <OAuthConsentForm
        userEmail={user.email || 'Authenticated User'}
        clientId={authReq.client.clientId}
        clientName={authReq.client.clientName}
        redirectUri={authReq.redirectUri}
        responseType="code"
        codeChallenge={authReq.codeChallenge}
        codeChallengeMethod={authReq.codeChallengeMethod}
        state={authReq.state}
        requestedScopeRaw={scope}
        resource={authReq.resource}
        initialScopes={authReq.initialScopes}
        wasScopeOmitted={authReq.wasScopeOmitted}
        workspaces={workspaces}
      />
    </div>
  );
}
