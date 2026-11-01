'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  Lock,
  Loader2,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import type { ToolScope } from '@/lib/mcp/types';
import type { WorkspaceRole } from '@/types/database';
import { AI_TOKEN_SCOPE_DETAILS } from '@/lib/validation/ai-token';
import { submitOAuthDecisionAction } from '@/lib/actions/oauth-actions';

export interface AuthorizableWorkspaceOption {
  id: string;
  name: string;
  role: WorkspaceRole;
}

export interface OAuthConsentFormProps {
  userEmail: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  responseType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  requestedScopeRaw: string | null;
  resource: string;
  initialScopes: ToolScope[];
  wasScopeOmitted: boolean;
  workspaces: AuthorizableWorkspaceOption[];
}

export function OAuthConsentForm({
  userEmail,
  clientId,
  clientName,
  redirectUri,
  responseType,
  codeChallenge,
  codeChallengeMethod,
  state,
  requestedScopeRaw,
  resource,
  initialScopes,
  wasScopeOmitted,
  workspaces,
}: OAuthConsentFormProps) {
  const eligibleWorkspaces = workspaces.filter((w) => w.role !== 'viewer');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(
    eligibleWorkspaces[0]?.id || workspaces[0]?.id || ''
  );
  const [selectedScopes, setSelectedScopes] = useState<ToolScope[]>(initialScopes);
  const [submitting, setSubmitting] = useState<'approve' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);
  const isSelectedWorkspaceViewer = selectedWorkspace?.role === 'viewer';

  const callbackHost = (() => {
    try {
      return new URL(redirectUri).host;
    } catch {
      return redirectUri;
    }
  })();

  const toggleScope = (scope: ToolScope) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const handleDecision = async (decision: 'approve' | 'deny') => {
    setError(null);

    if (decision === 'approve') {
      if (!selectedWorkspaceId) {
        setError('Please select a workspace to authorize.');
        return;
      }
      if (isSelectedWorkspaceViewer) {
        setError(
          'Your role in the selected workspace is Viewer. Viewers cannot authorize MCP access tokens.'
        );
        return;
      }
      if (selectedScopes.length === 0) {
        setError('Please select at least one permission scope to approve.');
        return;
      }
    }

    setSubmitting(decision);
    try {
      const result = await submitOAuthDecisionAction({
        decision,
        clientId,
        redirectUri,
        responseType,
        codeChallenge,
        codeChallengeMethod,
        state,
        scope: requestedScopeRaw,
        resource,
        workspaceId: selectedWorkspaceId,
        approvedScopes: selectedScopes,
      });

      if (!result.success || !result.redirectUrl) {
        setError(result.error || 'Failed to complete authorization request.');
        setSubmitting(null);
        return;
      }

      window.location.assign(result.redirectUrl);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'An unexpected error occurred during authorization.'
      );
      setSubmitting(null);
    }
  };

  return (
    <div
      data-testid="oauth-consent-card"
      className="w-full max-w-xl mx-auto rounded-2xl bg-neutral-900 border border-neutral-800 shadow-2xl overflow-hidden text-neutral-100"
    >
      {/* Header */}
      <div className="p-6 border-b border-neutral-800 bg-neutral-950/60">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2.5 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider font-semibold text-blue-400">
              MCP Remote Connector Authorization
            </p>
            <h1 className="text-lg font-bold text-white">
              Authorize <span data-testid="oauth-client-name">{clientName}</span>
            </h1>
          </div>
        </div>

        <p className="text-xs text-neutral-400 leading-relaxed">
          <strong className="text-neutral-200">{clientName}</strong> (via{' '}
          <code className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-200 font-mono">
            {callbackHost}
          </code>
          ) is requesting access to your Miler Creator workspace over the Model Context Protocol.
        </p>

        <div className="mt-3 pt-3 border-t border-neutral-800/80 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
          <span>
            Signed in as <strong className="text-neutral-200">{userEmail}</strong>
          </span>
          <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
            <Lock className="w-3.5 h-3.5" />
            PKCE S256 Verified
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 space-y-6">
        {error && (
          <div
            role="alert"
            data-testid="oauth-consent-error"
            className="p-3.5 rounded-xl bg-red-950/50 border border-red-800/80 text-red-200 text-xs flex items-start gap-2.5"
          >
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Workspace Selection */}
        <div className="space-y-2">
          <label
            htmlFor="oauth-workspace-select"
            className="flex items-center gap-1.5 text-xs font-semibold text-neutral-200"
          >
            <Building2 className="w-3.5 h-3.5 text-neutral-400" />
            <span>1. Select Workspace to Connect</span>
          </label>

          {workspaces.length === 0 ? (
            <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/70 text-amber-200 text-xs">
              You do not belong to any active workspaces yet. Create or join a workspace first to
              connect an AI assistant.
            </div>
          ) : (
            <select
              id="oauth-workspace-select"
              data-testid="oauth-workspace-select"
              value={selectedWorkspaceId}
              onChange={(e) => setSelectedWorkspaceId(e.target.value)}
              disabled={submitting !== null}
              className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-neutral-950 border border-neutral-700 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name} ({ws.role.toUpperCase()}
                  {ws.role === 'viewer' ? ' — Read-only role cannot authorize tokens' : ''})
                </option>
              ))}
            </select>
          )}

          {isSelectedWorkspaceViewer && (
            <p
              data-testid="oauth-viewer-warning"
              className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/60 rounded-lg px-3 py-2"
            >
              You hold a <strong>Viewer</strong> role in this workspace. Only Owners, Admins, and
              Members can authorize MCP access.
            </p>
          )}
        </div>

        {/* Scope Consent */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-200">
              <ShieldCheck className="w-3.5 h-3.5 text-neutral-400" />
              <span>2. Approve Permission Scopes</span>
            </span>
            <span className="text-[11px] text-neutral-400">
              {selectedScopes.length} of {AI_TOKEN_SCOPE_DETAILS.length} selected
            </span>
          </div>

          {wasScopeOmitted && (
            <p
              data-testid="least-privilege-notice"
              className="text-xs text-blue-200/90 bg-blue-950/40 border border-blue-800/60 rounded-lg px-3 py-2"
            >
              <strong>Least-privilege default applied:</strong> Only read-only permissions are
              pre-selected. Check <strong>Write Tasks</strong> or <strong>Write Content</strong>{' '}
              below if you want {clientName} to create or update items in your workspace.
            </p>
          )}

          <div className="grid grid-cols-1 gap-2.5">
            {AI_TOKEN_SCOPE_DETAILS.map((item) => {
              const checked = selectedScopes.includes(item.scope);
              const isWrite = item.category === 'write';
              return (
                <label
                  key={item.scope}
                  data-testid={`scope-option-${item.scope}`}
                  className={clsx(
                    'flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all',
                    checked
                      ? 'bg-neutral-950 border-blue-500/70 ring-1 ring-blue-500/30'
                      : 'bg-neutral-950/50 border-neutral-800 hover:border-neutral-700'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={submitting !== null}
                    onChange={() => toggleScope(item.scope)}
                    className="mt-0.5 rounded border-neutral-600 bg-neutral-900 text-blue-500 focus:ring-blue-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-neutral-100">
                        {item.label}{' '}
                        <code className="text-[11px] font-mono text-neutral-400">
                          ({item.scope})
                        </code>
                      </span>
                      <span
                        className={clsx(
                          'px-2 py-0.5 text-[10px] font-semibold uppercase rounded-full border',
                          isWrite
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                            : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        )}
                      >
                        {isWrite ? 'Write Access' : 'Read-Only'}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Target Resource Disclosure */}
        <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800/80 text-[11px] text-neutral-400 flex items-center justify-between gap-2">
          <span>Bound MCP Resource (RFC 8707):</span>
          <code
            data-testid="bound-mcp-resource"
            className="font-mono text-neutral-200 truncate"
          >
            {resource}
          </code>
        </div>

        {/* Actions */}
        <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
          <button
            type="button"
            data-testid="oauth-deny-button"
            disabled={submitting !== null}
            onClick={() => handleDecision('deny')}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-neutral-700 bg-neutral-800/70 hover:bg-neutral-800 text-neutral-200 text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {submitting === 'deny' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <XCircle className="w-4 h-4 text-neutral-400" />
            )}
            <span>Deny</span>
          </button>

          <button
            type="button"
            data-testid="oauth-approve-button"
            disabled={
              submitting !== null ||
              workspaces.length === 0 ||
              isSelectedWorkspaceViewer ||
              selectedScopes.length === 0
            }
            onClick={() => handleDecision('approve')}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors shadow-lg shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting === 'approve' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            <span>Approve Access</span>
          </button>
        </div>
      </div>
    </div>
  );
}
