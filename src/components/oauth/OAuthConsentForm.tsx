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
import type { ToolScope } from '@/lib/mcp/types';
import type { WorkspaceRole } from '@/types/database';
import { AI_TOKEN_SCOPE_DETAILS } from '@/lib/validation/ai-token';
import { ZahiDiamondMark } from '@/components/brand/ZahiBrand';
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
      className="surface-card zahi-khatam-accent w-full max-w-xl mx-auto overflow-hidden"
    >
      {/* Header */}
      <div className="p-6 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/45 space-y-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] border border-[var(--accent)]/25 text-[var(--accent)]">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.08em] text-[var(--accent-text)] font-medium">
              <ZahiDiamondMark size="xs" tone="accent" />
              <span>MCP Remote Connector Authorization</span>
            </div>
            <h1 className="heading-display text-lg sm:text-xl mt-0.5 truncate">
              Authorize <span data-testid="oauth-client-name">{clientName}</span>
            </h1>
          </div>
        </div>

        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          <strong className="font-semibold text-[var(--text-primary)]">{clientName}</strong> (via{' '}
          <code className="px-1.5 py-0.5 rounded-[4px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono">
            {callbackHost}
          </code>
          ) is requesting access to your Zahi workspace over the Model Context Protocol.
        </p>

        <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
          <span>
            Signed in as{' '}
            <strong className="font-semibold text-[var(--text-primary)]">{userEmail}</strong>
          </span>
          <span className="badge badge-success font-medium">
            <Lock className="w-3 h-3" />
            <span>PKCE S256 Verified</span>
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 space-y-5">
        {error && (
          <div
            role="alert"
            data-testid="oauth-consent-error"
            className="p-3.5 rounded-[var(--radius-sm)] border badge-danger text-xs flex items-start gap-2.5"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Workspace Selection */}
        <div className="space-y-2">
          <label
            htmlFor="oauth-workspace-select"
            className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]"
          >
            <Building2 className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <span>1. Select Workspace to Connect</span>
          </label>

          {workspaces.length === 0 ? (
            <div className="p-3.5 rounded-[var(--radius-sm)] border badge-warning text-xs">
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
              className="input-control py-2 px-3 min-h-10 text-sm leading-tight appearance-auto"
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
              className="text-xs border badge-warning rounded-[var(--radius-sm)] px-3 py-2"
            >
              You hold a <strong>Viewer</strong> role in this workspace. Only Owners, Admins, and
              Members can authorize MCP access.
            </p>
          )}
        </div>

        {/* Scope Consent */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
              <ShieldCheck className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              <span>2. Approve Permission Scopes</span>
            </span>
            <span className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">
              {selectedScopes.length} of {AI_TOKEN_SCOPE_DETAILS.length} selected
            </span>
          </div>

          {wasScopeOmitted && (
            <p
              data-testid="least-privilege-notice"
              className="text-xs border badge-info rounded-[var(--radius-sm)] px-3 py-2 leading-relaxed"
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
                  className={`flex items-start gap-3 p-3.5 rounded-[var(--radius-sm)] border cursor-pointer transition-colors ${
                    checked
                      ? 'bg-[var(--accent-soft)] border-[var(--accent)]/45'
                      : 'bg-[var(--bg-surface-muted)]/45 border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={submitting !== null}
                    onChange={() => toggleScope(item.scope)}
                    className="mt-0.5 h-4 w-4 rounded accent-[var(--accent)] shrink-0 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">
                        {item.label}{' '}
                        <code className="text-[11px] font-mono text-[var(--text-muted)] font-normal">
                          ({item.scope})
                        </code>
                      </span>
                      <span
                        className={`badge text-[10px] uppercase ${
                          isWrite ? 'badge-warning' : 'badge-success'
                        }`}
                      >
                        {isWrite ? 'Write Access' : 'Read-Only'}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Target Resource Disclosure */}
        <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)]/70 border border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)] flex flex-wrap items-center justify-between gap-2">
          <span>Bound MCP Resource (RFC 8707):</span>
          <code
            data-testid="bound-mcp-resource"
            className="font-mono text-[var(--text-primary)] truncate max-w-full"
          >
            {resource}
          </code>
        </div>

        {/* Actions */}
        <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
          <button
            type="button"
            data-testid="oauth-deny-button"
            disabled={submitting !== null}
            onClick={() => handleDecision('deny')}
            className="btn-secondary px-4 py-2 text-xs font-semibold disabled:opacity-50"
          >
            {submitting === 'deny' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <XCircle className="w-4 h-4 text-[var(--text-muted)]" />
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
            className="btn-accent px-5 py-2 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
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
