'use client';

import { useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Check, Copy, Sparkles } from 'lucide-react';
import { ZahiDiamondMark } from '@/components/brand/ZahiBrand';

const subscribe = () => () => {};
const browserOrigin = () => window.location.origin;
const serverOrigin = () => '';

export function ClaudeConnection() {
  const origin = useSyncExternalStore(subscribe, browserOrigin, serverOrigin);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const endpoint = origin ? `${origin}/api/mcp` : '';
  const isLocal = origin && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);

  return (
    <section
      aria-labelledby="claude-connection-heading"
      className="surface-card p-5 sm:p-6 space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--accent)]">
              <Sparkles className="w-3.5 h-3.5" />
            </span>
            <ZahiDiamondMark size="xs" tone="accent" />
            <span className="font-mono uppercase tracking-[0.08em] text-[10px] font-medium">
              Remote MCP OAuth 2.1
            </span>
          </div>
          <h2 id="claude-connection-heading" className="heading-section text-base sm:text-lg">
            Connect Claude
          </h2>
          <p className="text-xs sm:text-sm leading-relaxed text-[var(--text-secondary)] max-w-2xl">
            Ask Claude to manage tasks, subtasks, content, your calendar, dependencies,
            notifications, and reminder preferences.
          </p>
        </div>
      </div>

      <ol className="list-inside list-decimal space-y-1.5 text-xs sm:text-sm text-[var(--text-secondary)] bg-[var(--bg-surface-muted)]/60 border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-3.5">
        <li>In Claude, open Settings → Connectors → Add custom connector.</li>
        <li>Give it a name and paste this MCP server URL.</li>
        <li>
          Connect, sign in to this app, and authorize the read and write permissions you want Claude
          to have.
        </li>
      </ol>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <input
          aria-label="Claude MCP server URL"
          readOnly
          value={endpoint}
          placeholder="Loading connection URL…"
          className="input-control min-w-0 flex-1 px-3 py-2 font-mono text-xs"
        />
        <button
          type="button"
          disabled={!endpoint}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(endpoint);
              setCopied(true);
              setCopyError(false);
              setTimeout(() => setCopied(false), 3000);
            } catch {
              setCopyError(true);
            }
          }}
          className="btn-accent px-4 py-2 text-xs font-semibold shrink-0 disabled:opacity-50"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied' : 'Copy URL'}</span>
        </button>
      </div>

      {copyError && (
        <p role="status" className="text-xs px-3 py-2 rounded-[var(--radius-sm)] border badge-warning">
          Select the URL above and copy it manually.
        </p>
      )}

      {isLocal && (
        <div className="p-3 rounded-[var(--radius-sm)] border badge-warning text-xs flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            This is a local development URL. Claude’s remote connector needs a publicly reachable
            HTTPS deployment of this app.
          </span>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
        OAuth handles sign-in; no API token needs to be pasted into Claude. The tokens below are for
        clients that use bearer-token authentication. Access stays within your authorized
        workspace. Social accounts are planning profiles; these tools do not publish to social
        platforms.
      </p>
    </section>
  );
}
