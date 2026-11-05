'use client';

import { useState, useSyncExternalStore } from 'react';
const subscribe = () => () => {};
const browserOrigin = () => window.location.origin;
const serverOrigin = () => '';

export function ClaudeConnection() {
  const origin = useSyncExternalStore(subscribe, browserOrigin, serverOrigin);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const endpoint = origin ? `${origin}/api/mcp` : '';
  const isLocal = origin && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
  return <section aria-labelledby="claude-connection-heading" className="mb-6 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5 sm:p-6">
    <h1 id="claude-connection-heading" className="text-xl font-semibold text-neutral-100">Connect Claude</h1>
    <p className="mt-2 text-sm leading-relaxed text-neutral-400">Ask Claude to manage tasks, subtasks, content, your calendar, dependencies, notifications, and reminder preferences.</p>
    <ol className="mt-4 list-inside list-decimal space-y-2 text-sm text-neutral-300">
      <li>In Claude, open Settings → Connectors → Add custom connector.</li>
      <li>Give it a name and paste this MCP server URL.</li>
      <li>Connect, sign in to this app, and authorize the read and write permissions you want Claude to have.</li>
    </ol>
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <input aria-label="Claude MCP server URL" readOnly value={endpoint} placeholder="Loading connection URL…" className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 font-mono text-xs text-neutral-200" />
      <button type="button" disabled={!endpoint} onClick={async () => { try { await navigator.clipboard.writeText(endpoint); setCopied(true); setCopyError(false); } catch { setCopyError(true); } }} className="rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-blue-500">{copied ? 'Copied' : 'Copy URL'}</button>
    </div>
    {copyError && <p role="status" className="mt-2 text-xs text-amber-300">Select the URL above and copy it manually.</p>}
    {isLocal && <p className="mt-3 text-sm text-amber-300">This is a local development URL. Claude’s remote connector needs a publicly reachable HTTPS deployment of this app.</p>}
    <p className="mt-4 text-xs leading-relaxed text-neutral-500">OAuth handles sign-in; no API token needs to be pasted into Claude. The tokens below are for clients that use bearer-token authentication. Access stays within your authorized workspace. Social accounts are planning profiles; these tools do not publish to social platforms.</p>
  </section>;
}
