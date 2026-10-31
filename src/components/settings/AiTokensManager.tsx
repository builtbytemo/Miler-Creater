'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Bell,
  Check,
  ChevronLeft,
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
import clsx from 'clsx';

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
      className="p-5 rounded-xl bg-emerald-950/30 border border-emerald-700/70 text-emerald-100 space-y-4 shadow-lg animate-in fade-in duration-200"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 shrink-0 mt-0.5">
            <KeyRound className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-emerald-100">
              Token Created: {revealed.tokenName}
            </h3>
            <p className="text-xs text-emerald-200/90 mt-0.5">
              Copy your bearer token now. For your security, this raw secret is shown{' '}
              <strong className="font-semibold text-white">only once</strong> and cannot be
              retrieved again after you leave or dismiss this banner.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="p-1.5 rounded-lg text-emerald-300/80 hover:text-white hover:bg-emerald-900/50 transition-colors shrink-0"
          title="Dismiss secret banner"
          aria-label="Dismiss secret banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="flex-1 px-3.5 py-2.5 rounded-lg bg-neutral-950 border border-emerald-800/80 font-mono text-xs text-emerald-300 select-all overflow-x-auto whitespace-nowrap">
          <span data-testid="revealed-raw-token">{revealed.token}</span>
        </div>

        <button
          type="button"
          onClick={onCopy}
          data-testid="copy-token-button"
          className={clsx(
            'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all shrink-0',
            copied
              ? 'bg-emerald-600 text-white'
              : 'bg-emerald-500 hover:bg-emerald-400 text-neutral-950'
          )}
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

      <div className="flex items-center justify-between pt-1 text-[11px] text-emerald-300/80">
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>
            Use as <code className="font-mono text-emerald-200">Authorization: Bearer ctc_live_...</code> when connecting Claude or MCP clients to <code className="font-mono text-emerald-200">/api/mcp</code>.
          </span>
        </span>

        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-medium text-emerald-300 hover:text-white underline shrink-0 ml-4"
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
    className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
    dotClassName: 'bg-emerald-400',
  },
  revoked: {
    label: 'Revoked',
    className: 'bg-rose-500/10 text-rose-400 border-rose-500/25',
    dotClassName: 'bg-rose-400',
  },
  expired: {
    label: 'Expired',
    className: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
    dotClassName: 'bg-amber-400',
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
      className={clsx(
        'p-4 rounded-xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4',
        status === 'active'
          ? 'bg-neutral-950 border-neutral-800'
          : 'bg-neutral-950/60 border-neutral-800/60 opacity-80'
      )}
    >
      <div className="space-y-2 min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-neutral-100 truncate">
            {token.name}
          </span>

          <span
            data-testid={`ai-token-status-${token.id}`}
            className={clsx(
              'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border',
              badge.className
            )}
          >
            <span className={clsx('w-1.5 h-1.5 rounded-full', badge.dotClassName)} />
            <span>{badge.label}</span>
          </span>

          <code
            data-testid={`ai-token-prefix-${token.id}`}
            className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 font-mono text-[11px] text-neutral-300"
            title="Token identifier prefix (secret hidden)"
          >
            {token.tokenPrefix}...
          </code>
        </div>

        {/* Granted Scopes */}
        <div className="flex flex-wrap items-center gap-1.5">
          {token.scopes.map((scope) => (
            <span
              key={scope}
              className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20"
            >
              {scope}
            </span>
          ))}
        </div>

        {/* Timestamps */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-400">
          <span>Created: {createdFormatted}</span>
          <span>
            Expires:{' '}
            <strong
              className={clsx(
                'font-normal',
                status === 'expired' ? 'text-amber-400 font-medium' : 'text-neutral-300'
              )}
            >
              {expiresFormatted}
            </strong>
          </span>
          <span>Last used: {lastUsedFormatted}</span>
          {token.isRevoked && token.revokedAt && (
            <span className="text-rose-400">
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
              className="flex items-center gap-2 bg-rose-950/40 border border-rose-800/70 rounded-lg p-1.5"
            >
              <span className="text-[11px] text-rose-200 px-1.5 font-medium">
                Revoke permanently?
              </span>
              <button
                type="button"
                disabled={isRevoking}
                onClick={() => onConfirmRevoke(token.id)}
                data-testid={`confirm-revoke-btn-${token.id}`}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors disabled:opacity-50"
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
                className="px-2 py-1 rounded-md text-xs text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onRequestRevoke(token.id)}
              data-testid={`revoke-token-btn-${token.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-900 hover:bg-rose-950/60 text-neutral-300 hover:text-rose-300 border border-neutral-800 hover:border-rose-800/70 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Revoke</span>
            </button>
          )
        ) : (
          <span className="text-xs text-neutral-500 italic px-2">Revoked</span>
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

  // Token Creation Form State
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

  // Ephemeral One-Time Secret State (never persisted to storage)
  const [revealedSecret, setRevealedSecret] = useState<RevealedTokenSecret | null>(
    initialRevealedSecret
  );
  const [copied, setCopied] = useState<boolean>(false);

  // Revocation Confirmation State
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
        // Store raw token strictly in ephemeral React state for one-time reveal
        setRevealedSecret({
          token: res.data.token,
          tokenName: res.data.tokenMetadata.name,
          tokenId: res.data.tokenMetadata.id,
          tokenPrefix: res.data.tokenMetadata.tokenPrefix,
        });
        setCopied(false);
        setName('');

        // Prepend safe metadata to token list and refresh from server
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
      // Clipboard API unavailable or blocked; user can still select-all from the monospace box
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
        // If the revoked token was currently displayed in the one-time banner, clear it
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
    <div className="space-y-8 max-w-4xl">
      {/* Settings Navigation & Page Header */}
      <div className="pb-4 border-b border-neutral-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Back to Overview</span>
          </Link>

          {/* Settings Sub-Navigation */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-neutral-950 border border-neutral-800 text-xs">
            <Link
              href="/settings/notifications"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Notifications</span>
            </Link>
            <Link
              href="/settings/tokens"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-neutral-800 text-neutral-100 font-medium shadow-xs"
            >
              <KeyRound className="w-3.5 h-3.5 text-blue-400" />
              <span>AI &amp; API Tokens</span>
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-100">
              AI &amp; MCP API Tokens
            </h1>
            <p className="text-xs text-neutral-400">
              Generate scoped bearer tokens to connect Claude or Model Context Protocol (MCP)
              clients to {workspaceName ? <strong className="text-neutral-200">{workspaceName}</strong> : 'your workspace'}.
            </p>
          </div>
        </div>
      </div>

      {/* One-Time Secret Reveal Banner */}
      {revealedSecret && (
        <OneTimeTokenRevealBanner
          revealed={revealedSecret}
          copied={copied}
          onCopy={handleCopyToken}
          onDismiss={handleDismissSecret}
        />
      )}

      {/* Global Success Banner */}
      {successMessage && (
        <div
          role="status"
          className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-200 text-xs flex items-center gap-2.5"
        >
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Global Error Banner */}
      {error && (
        <div
          role="alert"
          data-testid="ai-tokens-error-banner"
          className="p-4 rounded-xl bg-rose-950/40 border border-rose-900/60 text-rose-200 text-xs flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={loadTokens}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-900/50 hover:bg-rose-900 text-rose-100 shrink-0"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Section 1: Create New API Token */}
      <form
        onSubmit={handleCreateToken}
        className="p-5 rounded-xl bg-neutral-950 border border-neutral-800 space-y-5"
      >
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-400" />
              <span>Create New API Token</span>
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              Tokens inherit your workspace membership permissions and are restricted to the scopes
              selected below.
            </p>
          </div>
        </div>

        {formError && (
          <div
            role="alert"
            data-testid="create-token-form-error"
            className="p-3 rounded-lg bg-rose-950/40 border border-rose-900/60 text-rose-200 text-xs"
          >
            {formError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Token Name Input */}
          <div className="md:col-span-2 space-y-1.5">
            <label
              htmlFor="token-name-input"
              className="block text-xs font-medium text-neutral-300"
            >
              Token Name <span className="text-rose-400">*</span>
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
              className="w-full px-3 py-2 text-xs rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            <p className="text-[11px] text-neutral-500">
              A recognizable label to identify which AI client or device uses this token (1–100
              characters).
            </p>
          </div>

          {/* Expiration Preset Selector */}
          <div className="space-y-1.5">
            <label
              htmlFor="token-expiration-select"
              className="block text-xs font-medium text-neutral-300 flex items-center gap-1.5"
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>Expiration</span>
            </label>
            <select
              id="token-expiration-select"
              name="expiresInDays"
              value={expirationDays === null ? 'never' : expirationDays.toString()}
              onChange={(e) => handleExpirationChange(e.target.value)}
              disabled={creating}
              className="w-full px-3 py-2 text-xs rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
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
            <p className="text-[11px] text-neutral-500">
              Expired tokens are automatically rejected by the MCP gateway.
            </p>
          </div>
        </div>

        {/* Permission Scopes */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-neutral-300 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Permission Scopes</span>
            </span>

            <div className="flex items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={selectReadOnlyScopes}
                disabled={creating}
                className="text-blue-400 hover:text-blue-300 hover:underline"
              >
                Read-only
              </button>
              <span className="text-neutral-700">|</span>
              <button
                type="button"
                onClick={selectAllScopes}
                disabled={creating}
                className="text-blue-400 hover:text-blue-300 hover:underline"
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
                  className={clsx(
                    'p-3 rounded-lg border cursor-pointer transition-colors flex items-start gap-3',
                    isChecked
                      ? 'bg-blue-950/20 border-blue-500/40'
                      : 'bg-neutral-900/50 border-neutral-800 hover:border-neutral-700'
                  )}
                >
                  <input
                    id={`scope-${item.scope}`}
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleScope(item.scope)}
                    disabled={creating}
                    className="w-4 h-4 rounded text-blue-600 bg-neutral-900 border-neutral-700 focus:ring-blue-500 mt-0.5 cursor-pointer"
                  />
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-neutral-100">{item.label}</span>
                      <code className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-neutral-900 text-blue-300 border border-neutral-800">
                        {item.scope}
                      </code>
                    </div>
                    <p className="text-[11px] text-neutral-400 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex items-center justify-between pt-3 border-t border-neutral-800">
          <span className="text-[11px] text-neutral-500">
            Destructive delete operations are never exposed to AI tokens.
          </span>

          <button
            type="submit"
            disabled={creating || selectedScopes.length === 0}
            data-testid="generate-token-submit-btn"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* Section 2: Existing Workspace Tokens List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-neutral-100">Issued Workspace Tokens</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-neutral-900 text-neutral-400 border border-neutral-800">
              {activeCount} active / {tokens.length} total
            </span>
          </div>

          <button
            type="button"
            onClick={loadTokens}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 transition-colors disabled:opacity-50"
            title="Refresh token list"
          >
            <RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
            <span>Refresh</span>
          </button>
        </div>

        {loading ? (
          <div
            data-testid="ai-tokens-loading-state"
            className="flex flex-col items-center justify-center py-16 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-500 gap-2.5"
          >
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            <span className="text-xs">Loading workspace API tokens...</span>
          </div>
        ) : tokens.length === 0 ? (
          <div
            data-testid="ai-tokens-empty-state"
            className="flex flex-col items-center justify-center py-14 px-4 rounded-xl bg-neutral-950 border border-neutral-800 text-center space-y-2"
          >
            <div className="w-10 h-10 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-400">
              <KeyRound className="w-5 h-5" />
            </div>
            <h3 className="text-xs font-semibold text-neutral-200">No API tokens created yet</h3>
            <p className="text-[11px] text-neutral-400 max-w-sm">
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
      </div>
    </div>
  );
}
