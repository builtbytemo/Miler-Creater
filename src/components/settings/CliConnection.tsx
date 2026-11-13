'use client';

import { useState } from 'react';
import { Terminal, Copy, Check, AlertCircle, Sparkles, KeyRound } from 'lucide-react';
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
      className="surface-card mb-6 rounded-3xl border border-[var(--border-subtle)] p-5 sm:p-6 space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-xl bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
              <Terminal className="w-4 h-4" />
            </span>
            <h2 id="cli-connection-heading" className="heading-section text-lg sm:text-xl text-[var(--text-primary)]">
              Connect the Zahi CLI
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed max-w-2xl">
            Generate a private CLI username, then run <code className="px-1.5 py-0.5 rounded-md bg-[var(--bg-subtle)] font-mono text-xs border border-[var(--border-subtle)]">miler login</code> in your terminal (CLI binary name: <code className="px-1.5 py-0.5 rounded-md bg-[var(--bg-subtle)] font-mono text-xs border border-[var(--border-subtle)]">miler</code>) and paste it at the prompt. Your username grants secure access to this workspace.
          </p>
        </div>
      </div>

      {!username && (
        <div>
          <button
            type="button"
            disabled={busy}
            onClick={createUsername}
            className="btn-accent px-4 py-2.5 text-xs font-semibold inline-flex items-center gap-2"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{busy ? 'Generating…' : 'Generate CLI username'}</span>
          </button>
        </div>
      )}

      {username && (
        <div className="space-y-3 p-4 rounded-2xl bg-[var(--bg-subtle)]/75 border border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
            <KeyRound className="w-4 h-4 text-[var(--accent)] shrink-0" />
            <span>Private CLI Username (Save now)</span>
          </div>

          <p className="text-xs text-[var(--text-secondary)]">
            Copy this username now. It will not be shown again. Anyone who has it can access this workspace.
          </p>

          <input
            aria-label="Private CLI username"
            readOnly
            value={username}
            className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 py-2.5 font-mono text-xs font-semibold text-[var(--text-primary)] shadow-2xs focus:outline-none"
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
              className="btn-accent px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5"
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
        <div role="alert" className="p-3.5 rounded-2xl badge-danger border flex items-center gap-2 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
        Each generated username appears as “Zahi CLI” in the API token list below, where it can be inspected or revoked at any time. Generating another username does not revoke earlier ones.
      </p>
    </section>
  );
}
