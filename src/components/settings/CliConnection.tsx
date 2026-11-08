'use client';

import { useState } from 'react';
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
        name: 'Miler CLI',
        scopes: ['task:read', 'task:write', 'content:read', 'content:write'],
        expiresInDays: null,
      });
      if (result.error || !result.data) setError(result.error || 'Could not generate a CLI username.');
      else { setUsername(result.data.token); setCopied(false); }
    } catch { setError('Could not generate a CLI username. Please try again.'); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="cli-connection-heading" className="mb-6 rounded-2xl border border-neutral-700 bg-neutral-900 p-5 sm:p-6">
    <h2 id="cli-connection-heading" className="text-xl font-semibold text-neutral-100">Connect the Miler CLI</h2>
    <p className="mt-2 text-sm text-neutral-400">Generate a private CLI username, then run <code>miler login</code> and paste it at the prompt. Your username grants access to this workspace; keep it private.</p>
    {!username && <button type="button" disabled={busy} onClick={createUsername} className="mt-4 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-medium text-white disabled:opacity-50">{busy ? 'Generating…' : 'Generate CLI username'}</button>}
    {username && <div className="mt-4 space-y-3">
      <p className="text-sm text-amber-300">Copy this username now. It will not be shown again. Anyone who has it can access this workspace.</p>
      <input aria-label="Private CLI username" readOnly value={username} className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 font-mono text-xs text-neutral-200" />
      <div className="flex gap-2">
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(username); setCopied(true); } catch { setError('Select and copy the username manually.'); } }} className="rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-medium text-white">{copied ? 'Copied' : 'Copy username'}</button>
        <button type="button" onClick={() => setUsername(null)} className="rounded-lg border border-neutral-600 px-4 py-2.5 text-xs font-medium text-white">I saved it</button>
      </div>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    <p className="mt-3 text-xs text-neutral-500">Each generated username appears as “Miler CLI” in the API token list below, where it can be revoked. Generating another does not revoke earlier usernames.</p>
  </section>;
}
