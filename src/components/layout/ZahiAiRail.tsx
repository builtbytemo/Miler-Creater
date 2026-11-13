'use client';

import { useCallback, useEffect, useId, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowUpRight,
  KeyRound,
  MailCheck,
  PanelRightClose,
  PanelRightOpen,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { ZahiDiamondMark, ZahiMascot } from '@/components/brand/ZahiBrand';
import {
  AI_RAIL_STORAGE_KEY,
  getSavedAiRailOpen,
  setAiRailOpen,
  toggleAiRailOpen,
  subscribeToAiRailStore,
} from '@/lib/layout/rail-preferences';

export {
  AI_RAIL_STORAGE_KEY,
  getSavedAiRailOpen,
  setAiRailOpen,
  toggleAiRailOpen,
};

function getServerAiRailOpen(): boolean {
  return false;
}

export function useAiRailOpen(): boolean {
  return useSyncExternalStore(
    subscribeToAiRailStore,
    getSavedAiRailOpen,
    getServerAiRailOpen
  );
}

function resolveRouteContextLabel(pathname: string): string {
  if (pathname.startsWith('/tasks')) return 'Tasks & Execution';
  if (pathname.startsWith('/calendar')) return 'Calendar & Timeblocks';
  if (pathname.startsWith('/content')) return 'Content Pipeline';
  if (pathname.startsWith('/notifications')) return 'Notifications Inbox';
  if (pathname.startsWith('/settings/notifications')) return 'Daily Briefing Settings';
  if (pathname.startsWith('/settings/tokens')) return 'CLI, MCP & API Tokens';
  return 'Command Overview';
}

function ZahiAiPanelContent({
  workspaceName,
  userLabel,
  onCollapse,
  isOverlay,
}: {
  workspaceName?: string;
  userLabel?: string;
  onCollapse: () => void;
  isOverlay?: boolean;
}) {
  const pathname = usePathname() || '/dashboard';
  const contextLabel = resolveRouteContextLabel(pathname);

  return (
    <div className="flex h-full flex-col justify-between overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-3 border-b border-[var(--border-subtle)] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--accent-text)]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <span className="heading-section text-[13px] truncate">Zahi Assistant</span>
          <span className="shrink-0 rounded-[4px] border badge-neutral px-1.5 py-0.5 text-[10px] font-mono leading-none">
            Dock Ready
          </span>
        </div>

        <button
          type="button"
          onClick={onCollapse}
          aria-label={isOverlay ? 'Close Zahi assistant dock' : 'Collapse Zahi assistant dock'}
          aria-expanded={true}
          title="Close assistant dock (])"
          data-testid={isOverlay ? 'ai-rail-overlay-close' : 'ai-rail-collapse-toggle'}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
        >
          {isOverlay ? (
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 space-y-4">
        {/* Honest Architectural Phase State — No Fake AI Chat Controls */}
        <section
          aria-label="Workspace assistant status"
          className="surface-card zahi-khatam-accent p-3.5 space-y-2.5"
        >
          <div className="flex items-start gap-2.5">
            <ZahiMascot size={30} className="shrink-0 mt-0.5" />
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-semibold text-[var(--text-primary)] leading-snug">
                Assistant dock architecture prepared
              </p>
              <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
                Model runtime integration is scoped to the dedicated AI phase. No synthetic chat inputs are enabled here.
              </p>
            </div>
          </div>
        </section>

        {/* Active Context Envelope */}
        <section aria-label="Active workspace context" className="space-y-1.5">
          <p className="label-eyebrow px-0.5">Active Context</p>
          <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--text-muted)]">View</span>
              <span className="font-medium text-[var(--text-primary)] truncate">
                {contextLabel}
              </span>
            </div>
            {workspaceName && (
              <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[var(--border-subtle)]">
                <span className="text-[var(--text-muted)]">Workspace</span>
                <span className="font-mono text-[11px] text-[var(--text-secondary)] truncate">
                  {workspaceName}
                </span>
              </div>
            )}
            {userLabel && (
              <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[var(--border-subtle)]">
                <span className="text-[var(--text-muted)]">Operator</span>
                <span className="text-[11px] text-[var(--text-secondary)] truncate">
                  {userLabel}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Real Connected Automation & Agent Channels */}
        <section aria-label="Connected automation channels" className="space-y-1.5">
          <p className="label-eyebrow px-0.5">Available Now</p>
          <div className="space-y-1.5">
            <Link
              href="/settings/tokens"
              onClick={isOverlay ? onCollapse : undefined}
              className="group flex items-center justify-between gap-2.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5 hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-hover)] transition-colors"
            >
              <span className="flex items-start gap-2.5 min-w-0">
                <KeyRound
                  className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent-text)]"
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-[var(--text-primary)] truncate">
                    MCP &amp; CLI Integrations
                  </span>
                  <span className="block text-[11px] text-[var(--text-muted)] truncate">
                    Claude OAuth · scoped API tokens
                  </span>
                </span>
              </span>
              <ArrowUpRight
                className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] opacity-60 group-hover:opacity-100"
                aria-hidden="true"
              />
            </Link>

            <Link
              href="/settings/notifications"
              onClick={isOverlay ? onCollapse : undefined}
              className="group flex items-center justify-between gap-2.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5 hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-hover)] transition-colors"
            >
              <span className="flex items-start gap-2.5 min-w-0">
                <MailCheck
                  className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent-text)]"
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-[var(--text-primary)] truncate">
                    Daily Briefings
                  </span>
                  <span className="block text-[11px] text-[var(--text-muted)] truncate">
                    Email &amp; Telegram schedule
                  </span>
                </span>
              </span>
              <ArrowUpRight
                className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] opacity-60 group-hover:opacity-100"
                aria-hidden="true"
              />
            </Link>
          </div>
        </section>

        {/* Architecture Guarantees */}
        <section aria-label="Assistant architecture safeguards" className="space-y-1.5">
          <p className="label-eyebrow px-0.5">Planned Guardrails</p>
          <ul className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]/75 p-3 space-y-2 text-[11.5px] text-[var(--text-secondary)]">
            <li className="flex items-start gap-2">
              <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
              <span>Workspace-scoped RLS context; no cross-tenant state.</span>
            </li>
            <li className="flex items-start gap-2">
              <ZahiDiamondMark size="xs" tone="accent" className="mt-1.5" />
              <span>Explicit preview confirmation before mutating tasks or posts.</span>
            </li>
            <li className="flex items-start gap-2">
              <ZahiDiamondMark size="xs" tone="muted" className="mt-1.5" />
              <span>Independent dock state alongside left navigation.</span>
            </li>
          </ul>
        </section>
      </div>

      {/* Footer */}
      <div className="px-3.5 py-2.5 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)] shrink-0">
        <span>Side-by-side ready</span>
        <span>] toggle · ⌘K</span>
      </div>
    </div>
  );
}

/**
 * Compact mobile header button to open/close the Right Assistant Dock sheet.
 */
export function ZahiAiMobileTrigger() {
  const isOpen = useAiRailOpen();

  return (
    <button
      type="button"
      onClick={() => toggleAiRailOpen()}
      aria-expanded={isOpen}
      aria-label={isOpen ? 'Close Zahi assistant dock' : 'Open Zahi assistant dock'}
      data-testid="mobile-ai-rail-trigger"
      className={clsx(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border transition-colors',
        isOpen
          ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent-text)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
      )}
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

function ZahiAiRailInner({
  workspaceName,
  userLabel,
}: {
  workspaceName?: string;
  userLabel?: string;
}) {
  const isOpen = useAiRailOpen();
  const dialogId = useId();

  const handleToggle = useCallback(() => {
    toggleAiRailOpen();
  }, []);

  const handleClose = useCallback(() => {
    setAiRailOpen(false);
  }, []);

  // Conflict-free `]` shortcut to toggle assistant dock; Esc closes narrow-viewport overlay sheet
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && typeof window !== 'undefined' && window.innerWidth < 1024) {
        e.preventDefault();
        setAiRailOpen(false);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.key !== ']') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const openDialog = document.querySelector('[role="dialog"]');
      if (openDialog && openDialog.id !== dialogId) return;
      e.preventDefault();
      toggleAiRailOpen();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, dialogId]);

  return (
    <>
      {/* Desktop (>=1024px) & Tablet Collapsed Edge Rail (>=768px) */}
      <aside
        aria-label="Zahi assistant dock"
        data-ai-rail="true"
        data-ai-rail-state={isOpen ? 'expanded' : 'collapsed'}
        className={clsx(
          'hidden md:flex md:shrink-0 md:flex-col md:sticky md:top-0 md:h-screen',
          'border-l border-[var(--border-subtle)] bg-[var(--bg-sidebar)] select-none',
          'transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          isOpen
            ? 'md:w-[42px] lg:w-[308px] xl:w-[340px]'
            : 'md:w-[42px]'
        )}
      >
        {/* Collapsed Edge Handle: shown on md always (since tablet opens overlay) and on lg+ when closed */}
        <div
          className={clsx(
            'h-full flex-col items-center justify-between py-3 px-1.5',
            isOpen ? 'flex lg:hidden' : 'flex'
          )}
        >
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={handleToggle}
              aria-label={isOpen ? 'Close Zahi assistant dock' : 'Open Zahi assistant dock'}
              aria-expanded={isOpen}
              title="Toggle Zahi assistant dock (])"
              data-testid="ai-rail-expand-toggle"
              className={clsx(
                'inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border transition-colors',
                isOpen
                  ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent-text)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
              )}
            >
              <PanelRightOpen className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <ZahiDiamondMark size="sm" tone={isOpen ? 'accent' : 'muted'} />
          </div>

          <kbd
            aria-hidden="true"
            className="font-mono text-[10px] rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[var(--text-muted)]"
          >
            ]
          </kbd>
        </div>

        {/* Desktop Expanded Assistant Dock (lg+) */}
        {isOpen && (
          <div className="hidden lg:flex lg:flex-col h-full min-h-0">
            <ZahiAiPanelContent
              workspaceName={workspaceName}
              userLabel={userLabel}
              onCollapse={handleClose}
            />
          </div>
        )}
      </aside>

      {/* Tablet & Mobile Overlay Sheet (<1024px when expanded) */}
      {isOpen && (
        <div className="lg:hidden">
          <div
            aria-hidden="true"
            onClick={handleClose}
            className="fixed inset-0 z-[55] bg-black/35 backdrop-blur-[2px]"
          />
          <div
            id={dialogId}
            role="dialog"
            aria-modal="true"
            aria-label="Zahi assistant dock"
            className="fixed inset-y-0 right-0 z-[60] w-[min(340px,92vw)] border-l border-[var(--border-strong)] bg-[var(--bg-surface-elevated)] shadow-[var(--shadow-elevated)]"
          >
            <ZahiAiPanelContent
              workspaceName={workspaceName}
              userLabel={userLabel}
              onCollapse={handleClose}
              isOverlay
            />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Hook-free wrapper for Zahi's right assistant rail so Server Component unit tests
 * run without React client dispatcher assumptions.
 */
export function ZahiAiRail({
  workspaceName,
  userLabel,
}: {
  workspaceName?: string;
  userLabel?: string;
} = {}) {
  return <ZahiAiRailInner workspaceName={workspaceName} userLabel={userLabel} />;
}
