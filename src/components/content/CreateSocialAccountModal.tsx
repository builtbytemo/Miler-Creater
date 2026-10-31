'use client';

import { useState } from 'react';
import { X, AtSign, AlertCircle, Loader2 } from 'lucide-react';
import type { SocialPlatform } from '@/types/database';
import type { SocialAccountRow } from '@/lib/services/content-service';
import { createSocialAccountAction } from '@/lib/actions/content-actions';

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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-neutral-950 border border-neutral-800 p-6 space-y-5 shadow-xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-neutral-800/80 pb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center border border-blue-500/20">
              <AtSign className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-neutral-100">Add social account</h2>
              <p className="text-[11px] text-neutral-400 mt-0.5 leading-relaxed">
                Save the social profile you use for each platform so you can associate planned content with the right account. This does not connect your account or enable publishing.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-950/40 border border-red-800 text-red-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Platform Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-medium text-neutral-300">Platform</label>
              <span className="text-[10px] text-neutral-500">Which social network the profile belongs to</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(['x', 'linkedin', 'reddit', 'threads'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlatform(p)}
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium border text-center transition-colors capitalize ${
                    platform === p
                      ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-700'
                  }`}
                >
                  {p === 'x' ? 'X (Twitter)' : p}
                </button>
              ))}
            </div>
          </div>

          {/* Account Handle */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-medium text-neutral-300">
                Handle / username <span className="text-red-400">*</span>
              </label>
              <span className="text-[10px] text-neutral-500">The username or public handle for that profile</span>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 font-mono text-xs">
                @
              </span>
              <input
                type="text"
                value={accountHandle.startsWith('@') ? accountHandle.slice(1) : accountHandle}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  setAccountHandle(val ? (val.startsWith('@') ? val : `@${val}`) : '');
                }}
                placeholder="handle or username"
                required
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs"
              />
            </div>
          </div>

          {/* Account Name */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-medium text-neutral-300">Display name (Optional)</label>
              <span className="text-[10px] text-neutral-500">The name shown to people on that platform; optional</span>
            </div>
            <input
              type="text"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="e.g. Alex Rivera, Company Brand"
              className="w-full px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-900">
            <button
              type="button"
              disabled={isPending}
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors disabled:opacity-50"
            >
              {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isPending ? 'Saving...' : 'Save social account'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
