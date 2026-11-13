'use client';

import { useState, useId } from 'react';
import { X, AtSign, AlertCircle, Loader2 } from 'lucide-react';
import type { SocialPlatform } from '@/types/database';
import type { SocialAccountRow } from '@/lib/services/content-service';
import { createSocialAccountAction } from '@/lib/actions/content-actions';
import { useDialog } from '@/lib/hooks/use-dialog';

interface CreateSocialAccountModalProps {
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
  onAccountCreated: (account: SocialAccountRow) => void;
}

export function CreateSocialAccountModal({
  workspaceId,
  isOpen,
  onClose,
  onAccountCreated,
}: CreateSocialAccountModalProps) {
  const [platform, setPlatform] = useState<SocialPlatform>('x');
  const [accountHandle, setAccountHandle] = useState('');
  const [accountName, setAccountName] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useDialog(isOpen, onClose, isPending);
  const titleId = useId();

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountHandle.trim()) {
      setError('Account handle is required');
      return;
    }

    try {
      setIsPending(true);
      setError(null);

      const res = await createSocialAccountAction(workspaceId, {
        platform,
        account_handle: accountHandle.trim(),
        account_name: accountName.trim() || null,
        status: 'draft',
      });

      if (res.error) {
        setError(res.error);
        return;
      }

      if (res.data) {
        onAccountCreated(res.data);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create social account');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/55 dark:bg-black/75 backdrop-blur-xs z-50 flex items-center justify-center p-4"
      onClick={() => {
        if (!isPending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md surface-elevated rounded-[var(--radius-lg)] p-5 sm:p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150 focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-[var(--radius-sm)] badge-accent border flex items-center justify-center shrink-0 mt-0.5">
              <AtSign className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id={titleId} className="heading-section text-sm text-[var(--text-primary)]">
                Add social account
              </h2>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                Save a profile reference so planned content maps to the right account. This stores metadata only and does not connect OAuth publishing.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Close dialog"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3 rounded-[var(--radius-sm)] badge-danger border text-xs flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Platform Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="font-medium text-[var(--text-secondary)]">Platform</label>
              <span className="text-[10.5px] text-[var(--text-muted)]">Target social network</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {(['x', 'linkedin', 'reddit', 'threads'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlatform(p)}
                  aria-pressed={platform === p}
                  className={`py-1.5 px-2 rounded-[var(--radius-sm)] text-xs font-medium border text-center transition-colors capitalize ${
                    platform === p
                      ? 'bg-[var(--text-primary)] border-[var(--text-primary)] text-[var(--bg-canvas)] font-semibold'
                      : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  {p === 'x' ? 'X' : p}
                </button>
              ))}
            </div>
          </div>

          {/* Account Handle */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="social-handle-input" className="font-medium text-[var(--text-secondary)]">
                Handle / username <span className="text-[var(--accent-text)]">*</span>
              </label>
              <span className="text-[10.5px] text-[var(--text-muted)]">Public username</span>
            </div>
            <div className="relative">
              <span
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] font-mono text-xs pointer-events-none"
                aria-hidden="true"
              >
                @
              </span>
              <input
                id="social-handle-input"
                type="text"
                value={accountHandle.startsWith('@') ? accountHandle.slice(1) : accountHandle}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  setAccountHandle(val ? (val.startsWith('@') ? val : `@${val}`) : '');
                }}
                placeholder="handle or username"
                required
                className="input-control w-full pl-8 pr-3 py-2 text-xs font-mono"
              />
            </div>
          </div>

          {/* Account Name */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="social-display-input" className="font-medium text-[var(--text-secondary)]">
                Display name (Optional)
              </label>
              <span className="text-[10.5px] text-[var(--text-muted)]">Shown on profile</span>
            </div>
            <input
              id="social-display-input"
              type="text"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="e.g. Alex Rivera, Zahi Studio"
              className="input-control w-full px-3 py-2 text-xs"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              disabled={isPending}
              onClick={onClose}
              className="btn-secondary px-3.5 py-2 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="btn-accent px-4 py-2 text-xs font-semibold disabled:opacity-50"
            >
              {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
              <span>{isPending ? 'Saving...' : 'Save social account'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
