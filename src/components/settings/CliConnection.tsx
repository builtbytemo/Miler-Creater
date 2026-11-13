'use client';

import { useState } from 'react';
import { Terminal, Copy, Check, AlertCircle, Sparkles, KeyRound } from 'lucide-react';
import { ZahiDiamondMark } from '@/components/brand/ZahiBrand';
import { createAiTokenAction } from '@/lib/actions/ai-token-actions';

export function CliConnection({ workspaceId }: { workspaceId: string }) {
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function createUsername() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createAiTokenAction(workspaceId, {
        name: 'Zahi CLI',
        scopes: ['task:read', 'task:write', 'content:read', 'content:write'],
        expiresInDays: null,
      });
      if (result.error || !result.data) {
        setError(result.error || 'Could not generate a CLI username.');
      } else {
        setUsername(result.data.token);
        setCopied(false);
      }
    } catch {
      setError('Could not generate a CLI username. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="cli-connection-heading"
      className="surface-card p-5 sm:p-6 space-y-4"
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
            <Terminal className="w-3.5 h-3.5" />
          </span>
          <ZahiDiamondMark size="xs" tone="accent" />
          <span className="font-mono uppercase tracking-[0.08em] text-[10px] font-medium">
            Command Line Interface
          </span>
        </div>
        <h2 id="cli-connection-heading" className="heading-section text-base sm:text-lg">
          Connect the Zahi CLI
        </h2>
        <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed max-w-2xl">
          Generate a private CLI username, then run{' '}
          <code className="px-1.5 py-0.5 rounded-[4px] bg-[var(--bg-surface-muted)] font-mono text-xs border border-[var(--border-subtle)] text-[var(--text-primary)]">
            miler login
          </code>{' '}
          in your terminal (CLI binary name:{' '}
          <code className="px-1.5 py-0.5 rounded-[4px] bg-[var(--bg-surface-muted)] font-mono text-xs border border-[var(--border-subtle)] text-[var(--text-primary)]">
            miler
          </code>
          ) and paste it at the prompt. Your username grants secure access to this workspace.
        </p>
      </div>

      {!username && (
        <div>
          <button
            type="button"
            disabled={busy}
            onClick={createUsername}
            className="btn-accent px-4 py-2 text-xs font-semibold"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{busy ? 'Generating…' : 'Generate CLI username'}</span>
          </button>
        </div>
      )}

      {username && (
        <div className="space-y-3 p-4 rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)]/75 border border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
            <KeyRound className="w-4 h-4 text-[var(--accent)] shrink-0" />
            <span>Private CLI Username (Save now)</span>
          </div>

          <p className="text-xs text-[var(--text-secondary)]">
            Copy this username now. It will not be shown again. Anyone who has it can access this
            workspace.
          </p>

          <input
            aria-label="Private CLI username"
            readOnly
            value={username}
            className="input-control px-3 py-2 font-mono text-xs font-semibold"
          />

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(username);
                  setCopied(true);
                } catch {
                  setError('Select and copy the username manually.');
                }
              }}
              className="btn-accent px-4 py-2 text-xs font-semibold"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy username'}</span>
            </button>
            <button
              type="button"
              onClick={() => setUsername(null)}
              className="btn-secondary px-4 py-2 text-xs font-semibold"
            >
              I saved it
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-3 rounded-[var(--radius-sm)] badge-danger border flex items-center gap-2 text-xs"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
        Each generated username appears as “Zahi CLI” in the API token list below, where it can be
        inspected or revoked at any time. Generating another username does not revoke earlier ones.
      </p>
    </section>
  );
}
