'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { ToolScope } from '@/lib/mcp/types';
import type { SafeTokenMetadata } from '@/lib/mcp/token-service';
import {
  AI_TOKEN_EXPIRATION_PRESETS,
  AI_TOKEN_SCOPE_DETAILS,
  SUPPORTED_AI_TOKEN_SCOPES,
  getTokenLifecycleStatus,
  type TokenLifecycleStatus,
} from '@/lib/validation/ai-token';
import {
  createAiTokenAction,
  listWorkspaceTokensAction,
  revokeAiTokenAction,
} from '@/lib/actions/ai-token-actions';
import { formatInTimeZone, DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';

export interface RevealedTokenSecret {
  token: string;
  tokenName: string;
  tokenId: string;
  tokenPrefix: string;
}

export interface OneTimeTokenRevealBannerProps {
  revealed: RevealedTokenSecret;
  copied: boolean;
  onCopy: () => void | Promise<void>;
  onDismiss: () => void;
}

/**
 * Displays the newly generated raw bearer token exactly once in ephemeral React state.
 * Never persists the secret to storage, cookies, URLs, or logs.
 */
export function OneTimeTokenRevealBanner({
  revealed,
  copied,
  onCopy,
  onDismiss,
}: OneTimeTokenRevealBannerProps) {
  return (
    <div
      role="region"
      aria-label="New API Token Secret"
      data-testid="one-time-token-reveal"
      className="surface-card zahi-khatam-accent p-5 space-y-4 border-[var(--status-success-border)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="p-2 rounded-[var(--radius-sm)] badge-success border shrink-0 mt-0.5">
            <KeyRound className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Token Created: {revealed.tokenName}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
              Copy your bearer token now. For your security, this raw secret is shown{' '}
              <strong className="font-semibold text-[var(--text-primary)]">only once</strong> and
              cannot be retrieved again after you leave or dismiss this banner.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="btn-ghost p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
          title="Dismiss secret banner"
          aria-label="Dismiss secret banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="flex-1 px-3.5 py-2 rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)] border border-[var(--border-strong)] font-mono text-xs text-[var(--text-primary)] select-all overflow-x-auto whitespace-nowrap">
          <span data-testid="revealed-raw-token">{revealed.token}</span>
        </div>

        <button
          type="button"
          onClick={onCopy}
          data-testid="copy-token-button"
          className="btn-accent px-4 py-2 text-xs font-semibold shrink-0"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Copied to Clipboard</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy Token</span>
            </>
          )}
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-[var(--text-secondary)]">
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-[var(--status-warning-text)] shrink-0" />
          <span>
            Use as{' '}
            <code className="font-mono text-[var(--text-primary)] bg-[var(--bg-surface-muted)] px-1 py-0.5 rounded-[4px]">
              Authorization: Bearer ctc_live_...
            </code>{' '}
            when connecting Claude or MCP clients to{' '}
            <code className="font-mono text-[var(--text-primary)] bg-[var(--bg-surface-muted)] px-1 py-0.5 rounded-[4px]">
              /api/mcp
            </code>
            .
          </span>
        </span>

        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-medium text-[var(--accent-text)] hover:underline shrink-0"
        >
          I&apos;ve saved this token
        </button>
      </div>
    </div>
  );
}

export interface AiTokenRowProps {
  token: SafeTokenMetadata;
  userTimeZone: string;
  isConfirmingRevoke: boolean;
  isRevoking: boolean;
  onRequestRevoke: (tokenId: string) => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: (tokenId: string) => void | Promise<void>;
  referenceTime?: Date;
}

const STATUS_BADGE_STYLES: Record<
  TokenLifecycleStatus,
  { label: string; className: string; dotClassName: string }
> = {
  active: {
    label: 'Active',
    className: 'badge badge-success',
    dotClassName: 'bg-[var(--status-success-text)]',
  },
  revoked: {
    label: 'Revoked',
    className: 'badge badge-danger',
    dotClassName: 'bg-[var(--status-danger-text)]',
  },
  expired: {
    label: 'Expired',
    className: 'badge badge-warning',
    dotClassName: 'bg-[var(--status-warning-text)]',
  },
};

/**
 * Renders a single token entry in the management list using strictly non-sensitive metadata.
 */
export function AiTokenRow({
  token,
  userTimeZone,
  isConfirmingRevoke,
  isRevoking,
  onRequestRevoke,
  onCancelRevoke,
  onConfirmRevoke,
  referenceTime,
}: AiTokenRowProps) {
  const status = getTokenLifecycleStatus(token, referenceTime);
  const badge = STATUS_BADGE_STYLES[status];

  const createdFormatted = formatInTimeZone(token.createdAt, userTimeZone, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const expiresFormatted = token.expiresAt
    ? formatInTimeZone(token.expiresAt, userTimeZone, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'Never expires';

  const lastUsedFormatted = token.lastUsedAt
    ? formatInTimeZone(token.lastUsedAt, userTimeZone, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Never used';

  return (
    <div
      data-testid={`ai-token-row-${token.id}`}
      className={`surface-card p-4 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
        status === 'active' ? '' : 'opacity-75'
      }`}
    >
      <div className="space-y-2 min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
            {token.name}
          </span>

          <span data-testid={`ai-token-status-${token.id}`} className={badge.className}>
            <span className={`w-1.5 h-1.5 rounded-full ${badge.dotClassName}`} />
            <span>{badge.label}</span>
          </span>

          <code
            data-testid={`ai-token-prefix-${token.id}`}
            className="px-2 py-0.5 rounded-[4px] bg-[var(--bg-surface-muted)] border border-[var(--border-subtle)] font-mono text-[11px] text-[var(--text-secondary)]"
            title="Token identifier prefix (secret hidden)"
          >
            {token.tokenPrefix}...
          </code>
        </div>

        {/* Granted Scopes */}
        <div className="flex flex-wrap items-center gap-1.5">
          {token.scopes.map((scope) => (
            <span key={scope} className="badge badge-info font-mono text-[10px]">
              {scope}
            </span>
          ))}
        </div>

        {/* Timestamps */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-[var(--text-muted)]">
          <span>Created: {createdFormatted}</span>
          <span>
            Expires:{' '}
            <strong
              className={
                status === 'expired'
                  ? 'text-[var(--status-warning-text)] font-semibold'
                  : 'text-[var(--text-secondary)] font-normal'
              }
            >
              {expiresFormatted}
            </strong>
          </span>
          <span>Last used: {lastUsedFormatted}</span>
          {token.isRevoked && token.revokedAt && (
            <span className="text-[var(--status-danger-text)]">
              Revoked:{' '}
              {formatInTimeZone(token.revokedAt, userTimeZone, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
      </div>

      {/* Revocation Action Controls */}
      <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
        {!token.isRevoked ? (
          isConfirmingRevoke ? (
            <div
              data-testid={`revoke-confirm-controls-${token.id}`}
              className="flex flex-wrap items-center gap-2 badge-danger border rounded-[var(--radius-sm)] p-1.5"
            >
              <span className="text-[11px] px-1.5 font-semibold">Revoke permanently?</span>
              <button
                type="button"
                disabled={isRevoking}
                onClick={() => onConfirmRevoke(token.id)}
                data-testid={`confirm-revoke-btn-${token.id}`}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[5px] text-xs font-semibold bg-[var(--status-danger-text)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isRevoking ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Revoking...</span>
                  </>
                ) : (
                  <span>Confirm Revoke</span>
                )}
              </button>
              <button
                type="button"
                disabled={isRevoking}
                onClick={onCancelRevoke}
                data-testid={`cancel-revoke-btn-${token.id}`}
                className="btn-secondary px-2 py-1 text-xs disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onRequestRevoke(token.id)}
              data-testid={`revoke-token-btn-${token.id}`}
              className="btn-secondary px-3 py-1.5 text-xs font-medium hover:text-[var(--status-danger-text)] hover:border-[var(--status-danger-border)]"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Revoke</span>
            </button>
          )
        ) : (
          <span className="text-xs text-[var(--text-muted)] italic px-2">Revoked</span>
        )}
      </div>
    </div>
  );
}

export interface AiTokensManagerProps {
  workspaceId: string;
  workspaceName?: string;
  userTimeZone?: string;
  initialTokens?: SafeTokenMetadata[];
  initialLoading?: boolean;
  initialError?: string | null;
  initialRevealedSecret?: RevealedTokenSecret | null;
  initialConfirmRevokeId?: string | null;
}

export function AiTokensManager({
  workspaceId,
  workspaceName,
  userTimeZone = DEFAULT_TIMEZONE,
  initialTokens,
  initialLoading,
  initialError = null,
  initialRevealedSecret = null,
  initialConfirmRevokeId = null,
}: AiTokensManagerProps) {
  const [tokens, setTokens] = useState<SafeTokenMetadata[]>(initialTokens ?? []);
  const [loading, setLoading] = useState<boolean>(
    initialLoading !== undefined ? initialLoading : initialTokens === undefined
  );
  const [error, setError] = useState<string | null>(initialError);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [name, setName] = useState<string>('');
  const [selectedScopes, setSelectedScopes] = useState<ToolScope[]>([
    'task:read',
    'task:write',
    'content:read',
    'content:write',
  ]);
  const [expirationDays, setExpirationDays] = useState<number | null>(30);
  const [creating, setCreating] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [revealedSecret, setRevealedSecret] = useState<RevealedTokenSecret | null>(
    initialRevealedSecret
  );
  const [copied, setCopied] = useState<boolean>(false);

  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(initialConfirmRevokeId);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listWorkspaceTokensAction(workspaceId);
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setTokens(res.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AI API tokens');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (initialTokens !== undefined || initialLoading !== undefined) {
      return;
    }

    let cancelled = false;

    listWorkspaceTokensAction(workspaceId)
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setError(res.error);
        } else if (res.data) {
          setTokens(res.data);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load AI API tokens');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialTokens, initialLoading, workspaceId]);

  const toggleScope = (scope: ToolScope) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const selectReadOnlyScopes = () => {
    setSelectedScopes(['task:read', 'content:read']);
  };

  const selectAllScopes = () => {
    setSelectedScopes([...SUPPORTED_AI_TOKEN_SCOPES]);
  };

  const handleExpirationChange = (value: string) => {
    if (value === 'never') {
      setExpirationDays(null);
    } else {
      const parsed = parseInt(value, 10);
      setExpirationDays(Number.isNaN(parsed) ? 30 : parsed);
    }
  };

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;

    setFormError(null);
    setError(null);
    setSuccessMessage(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Please provide a recognizable name for this token.');
      return;
    }
    if (trimmedName.length > 100) {
      setFormError('Token name cannot exceed 100 characters.');
      return;
    }
    if (selectedScopes.length === 0) {
      setFormError('Please select at least one permission scope.');
      return;
    }

    setCreating(true);
    try {
      const res = await createAiTokenAction(workspaceId, {
        name: trimmedName,
        scopes: selectedScopes,
        expiresInDays: expirationDays,
      });

      if (res.error) {
        setFormError(res.error);
      } else if (res.data) {
        setRevealedSecret({
          token: res.data.token,
          tokenName: res.data.tokenMetadata.name,
          tokenId: res.data.tokenMetadata.id,
          tokenPrefix: res.data.tokenMetadata.tokenPrefix,
        });
        setCopied(false);
        setName('');

        setTokens((prev) => [
          res.data!.tokenMetadata,
          ...prev.filter((t) => t.id !== res.data!.tokenMetadata.id),
        ]);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create token');
    } finally {
      setCreating(false);
    }
  };

  const handleCopyToken = async () => {
    if (!revealedSecret?.token) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(revealedSecret.token);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      }
    } catch {
      // Clipboard API unavailable or blocked; user can select-all from the monospace box
    }
  };

  const handleDismissSecret = () => {
    setRevealedSecret(null);
    setCopied(false);
  };

  const handleConfirmRevoke = async (tokenId: string) => {
    if (revokingId) return;
    setRevokingId(tokenId);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await revokeAiTokenAction(workspaceId, tokenId);
      if (res.error) {
        setError(res.error);
      } else {
        setConfirmRevokeId(null);
        if (revealedSecret?.tokenId === tokenId) {
          setRevealedSecret(null);
        }
        setSuccessMessage('API token revoked immediately.');
        await loadTokens();
        setTimeout(() => setSuccessMessage(null), 4000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke token');
    } finally {
      setRevokingId(null);
    }
  };

  const activeCount = tokens.filter((t) => getTokenLifecycleStatus(t) === 'active').length;

  return (
    <div className="space-y-6">
      {revealedSecret && (
        <OneTimeTokenRevealBanner
          revealed={revealedSecret}
          copied={copied}
          onCopy={handleCopyToken}
          onDismiss={handleDismissSecret}
        />
      )}

      {successMessage && (
        <div
          role="status"
          className="p-3.5 rounded-[var(--radius-sm)] border badge-success text-xs flex items-center gap-2.5"
        >
          <Check className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          data-testid="ai-tokens-error-banner"
          className="p-3.5 rounded-[var(--radius-sm)] border badge-danger text-xs flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={loadTokens}
            className="btn-secondary px-2.5 py-1 text-xs shrink-0"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Create New API Token */}
      <form onSubmit={handleCreateToken} className="surface-card p-5 sm:p-6 space-y-5">
        <div className="border-b border-[var(--border-subtle)] pb-3.5">
          <h2 className="heading-section text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--accent)]" />
            <span>Create New API Token</span>
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Bearer tokens for scripts or MCP clients connecting to{' '}
            {workspaceName ? (
              <strong className="font-semibold text-[var(--text-primary)]">{workspaceName}</strong>
            ) : (
              'your workspace'
            )}
            , restricted to the scopes selected below.
          </p>
        </div>

        {formError && (
          <div
            role="alert"
            data-testid="create-token-form-error"
            className="p-3 rounded-[var(--radius-sm)] border badge-danger text-xs"
          >
            {formError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-1.5">
            <label
              htmlFor="token-name-input"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              Token Name <span className="text-[var(--status-danger-text)]">*</span>
            </label>
            <input
              id="token-name-input"
              name="name"
              type="text"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={creating}
              placeholder="e.g., Claude Desktop — MacBook Pro"
              className="input-control px-3 py-2 text-xs disabled:opacity-50"
            />
            <p className="text-[11px] text-[var(--text-muted)]">
              A recognizable label to identify which AI client or script uses this token (1–100
              characters).
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="token-expiration-select"
              className="text-xs font-medium text-[var(--text-secondary)] flex items-center gap-1.5"
            >
              <Clock className="w-3.5 h-3.5 text-[var(--status-warning-text)]" />
              <span>Expiration</span>
            </label>
            <select
              id="token-expiration-select"
              name="expiresInDays"
              value={expirationDays === null ? 'never' : expirationDays.toString()}
              onChange={(e) => handleExpirationChange(e.target.value)}
              disabled={creating}
              className="input-control py-1.5 px-3 min-h-9 text-xs leading-tight appearance-auto disabled:opacity-50"
            >
              {AI_TOKEN_EXPIRATION_PRESETS.map((preset) => (
                <option
                  key={preset.days === null ? 'never' : preset.days}
                  value={preset.days === null ? 'never' : preset.days.toString()}
                >
                  {preset.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-[var(--text-muted)]">
              Expired tokens are rejected by the MCP gateway.
            </p>
          </div>
        </div>

        {/* Permission Scopes */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--text-secondary)] flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[var(--status-success-text)]" />
              <span>Permission Scopes</span>
            </span>

            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={selectReadOnlyScopes}
                disabled={creating}
                className="text-[var(--accent-text)] hover:underline font-medium"
              >
                Read-only
              </button>
              <span className="text-[var(--border-strong)]">|</span>
              <button
                type="button"
                onClick={selectAllScopes}
                disabled={creating}
                className="text-[var(--accent-text)] hover:underline font-medium"
              >
                Select all
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {AI_TOKEN_SCOPE_DETAILS.map((item) => {
              const isChecked = selectedScopes.includes(item.scope);
              return (
                <label
                  key={item.scope}
                  htmlFor={`scope-${item.scope}`}
                  className={`p-3 rounded-[var(--radius-sm)] border cursor-pointer transition-colors flex items-start gap-3 ${
                    isChecked
                      ? 'bg-[var(--accent-soft)] border-[var(--accent)]/40'
                      : 'bg-[var(--bg-surface-muted)]/50 border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <input
                    id={`scope-${item.scope}`}
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleScope(item.scope)}
                    disabled={creating}
                    className="w-4 h-4 rounded accent-[var(--accent)] mt-0.5 cursor-pointer shrink-0"
                  />
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">
                        {item.label}
                      </span>
                      <code className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-mono bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                        {item.scope}
                      </code>
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[var(--border-subtle)]">
          <span className="text-[11px] text-[var(--text-muted)]">
            Destructive delete operations are never exposed to AI tokens.
          </span>

          <button
            type="submit"
            disabled={creating || selectedScopes.length === 0}
            data-testid="generate-token-submit-btn"
            className="btn-accent px-4 py-2 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Generating Token...</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>Generate API Token</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Existing Workspace Tokens List */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="heading-section text-sm sm:text-base">Issued Workspace Tokens</h2>
            <span className="badge badge-neutral font-mono tabular-nums text-[10px]">
              {activeCount} active / {tokens.length} total
            </span>
          </div>

          <button
            type="button"
            onClick={loadTokens}
            disabled={loading}
            className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-50"
            title="Refresh token list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {loading ? (
          <div
            data-testid="ai-tokens-loading-state"
            className="surface-card flex flex-col items-center justify-center py-16 text-[var(--text-muted)] gap-2.5"
          >
            <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
            <span className="text-xs font-medium">Loading workspace API tokens...</span>
          </div>
        ) : tokens.length === 0 ? (
          <div
            data-testid="ai-tokens-empty-state"
            className="surface-card flex flex-col items-center justify-center py-12 px-4 text-center space-y-2"
          >
            <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--bg-surface-muted)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)]">
              <KeyRound className="w-5 h-5" />
            </div>
            <h3 className="text-xs font-semibold text-[var(--text-primary)]">
              No API tokens created yet
            </h3>
            <p className="text-xs text-[var(--text-secondary)] max-w-sm">
              Generate an API token above to connect Claude or another Model Context Protocol (MCP)
              client to your workspace.
            </p>
          </div>
        ) : (
          <div data-testid="ai-tokens-list" className="space-y-2.5">
            {tokens.map((token) => (
              <AiTokenRow
                key={token.id}
                token={token}
                userTimeZone={userTimeZone}
                isConfirmingRevoke={confirmRevokeId === token.id}
                isRevoking={revokingId === token.id}
                onRequestRevoke={(id) => setConfirmRevokeId(id)}
                onCancelRevoke={() => setConfirmRevokeId(null)}
                onConfirmRevoke={handleConfirmRevoke}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
