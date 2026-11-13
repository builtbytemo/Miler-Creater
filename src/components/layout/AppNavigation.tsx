'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CheckSquare,
  LayoutDashboard,
  Calendar,
  Share2,
  KeyRound,
  Bell,
  SlidersHorizontal,
  Menu,
  X,
  Search,
} from 'lucide-react';
import { clsx } from 'clsx';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { ZahiLogoMark, ZahiWordmark } from '@/components/brand/ZahiBrand';
import {
  CommandPalette,
  dispatchOpenCommandPalette,
} from '@/components/ui/CommandPalette';

export const primaryLinks = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
  { href: '/calendar', label: 'Calendar', icon: Calendar },
  { href: '/content', label: 'Content', icon: Share2 },
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/settings/tokens', label: 'API Tokens', icon: KeyRound },
] as const;

const operationLinks = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
  { href: '/calendar', label: 'Calendar', icon: Calendar },
  { href: '/content', label: 'Content', icon: Share2 },
  { href: '/notifications', label: 'Notifications', icon: Bell },
] as const;

const workspaceLinks = [
  { href: '/settings/notifications', label: 'Daily Briefing', icon: SlidersHorizontal },
  { href: '/settings/tokens', label: 'API Tokens', icon: KeyRound },
] as const;

const mobileQuickLinks = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/content', label: 'Content' },
  { href: '/settings/tokens', label: 'API Tokens' },
] as const;

function isRouteActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function MobileMenuSheet({ pathname }: { pathname: string }) {
  const [openPathname, setOpenPathname] = useState<string | null>(null);
  const open = openPathname === pathname;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPathname(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpenPathname((prev) => (prev === pathname ? null : pathname))}
        aria-expanded={open}
        aria-controls="mobile-navigation-drawer"
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        data-testid="mobile-menu-trigger"
        className={clsx(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border transition-colors',
          'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
          'hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]',
          open && 'border-[var(--border-strong)] bg-[var(--bg-surface-hover)] text-[var(--text-primary)]'
        )}
      >
        {open ? (
          <X className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Menu className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      {open && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setOpenPathname(null)}
            className="fixed inset-0 top-12 z-40 bg-black/30 backdrop-blur-[2px]"
          />
          <div
            id="mobile-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile workspace navigation"
            className="fixed inset-x-3 top-14 z-50 rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--bg-surface-elevated)] p-3 shadow-[var(--shadow-elevated)] space-y-3"
          >
            <button
              type="button"
              onClick={() => {
                setOpenPathname(null);
                dispatchOpenCommandPalette();
              }}
              className="flex w-full items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            >
              <span className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                <span>Jump to page or action…</span>
              </span>
              <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)]">
                ⌘K
              </kbd>
            </button>

            <div className="space-y-0.5">
              {primaryLinks.map((link) => {
                const Icon = link.icon;
                const isActive = isRouteActive(pathname, link.href);
                return (
                  <Link
                    key={`drawer-${link.href}`}
                    href={link.href}
                    onClick={() => setOpenPathname(null)}
                    aria-current={isActive ? 'page' : undefined}
                    className={clsx(
                      'relative flex items-center justify-between rounded-[var(--radius-sm)] px-2.5 py-2 text-[13px] transition-colors',
                      isActive
                        ? 'bg-[var(--bg-surface-muted)] text-[var(--text-primary)] font-semibold'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon className="h-4 w-4 shrink-0 opacity-75" aria-hidden="true" />
                      <span className="truncate">{link.label}</span>
                    </span>
                    {isActive && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]"
                        aria-hidden="true"
                      />
                    )}
                  </Link>
                );
              })}
            </div>

            <div className="pt-2.5 border-t border-[var(--border-subtle)] space-y-2.5">
              <div className="flex items-center justify-between gap-2 px-1 text-xs text-[var(--text-muted)]">
                <span>Theme</span>
                <ThemeToggle />
              </div>
              <Link
                href="/settings/notifications"
                onClick={() => setOpenPathname(null)}
                className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Daily Briefing &amp; Alert Settings</span>
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DesktopSidebar() {
  const pathname = usePathname() || '/dashboard';

  return (
    <aside
      aria-label="Workspace sidebar"
      className="hidden md:flex md:w-[228px] md:shrink-0 md:flex-col md:justify-between md:sticky md:top-0 md:h-screen border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] px-3 py-3.5 select-none"
    >
      <div className="space-y-4 min-w-0">
        {/* Brand Row + Notification Bell */}
        <div className="flex items-center justify-between gap-2 px-1 min-w-0">
          <Link
            href="/dashboard"
            aria-label="Zahi home"
            className="flex min-w-0 items-center gap-2 hover:opacity-85 transition-opacity"
          >
            <ZahiLogoMark size="sm" />
            <ZahiWordmark className="text-[15px] leading-none" />
          </Link>
          <NotificationBell />
        </div>

        {/* Raycast/Linear-style Command Jump Trigger */}
        <button
          type="button"
          onClick={dispatchOpenCommandPalette}
          aria-label="Open command palette"
          className="flex h-8 w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-xs text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)] transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">Search or jump…</span>
          </span>
          <kbd className="font-mono text-[10px] shrink-0 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[var(--text-muted)]">
            ⌘K
          </kbd>
        </button>

        {/* Primary Operations Navigation */}
        <div className="space-y-4 min-w-0">
          <div className="space-y-0.5 min-w-0">
            <p className="px-2.5 pb-1 text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Operations
            </p>
            {operationLinks.map((link) => {
              const Icon = link.icon;
              const isActive = isRouteActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={clsx(
                    'group relative flex h-8 min-w-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-[13px] transition-colors',
                    isActive
                      ? 'bg-[var(--bg-surface-muted)] text-[var(--text-primary)] font-semibold'
                      : 'text-[var(--text-secondary)] font-normal hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
                  )}
                >
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r-full bg-[var(--accent)]"
                    />
                  )}
                  <Icon
                    aria-hidden="true"
                    className={clsx(
                      'h-3.5 w-3.5 shrink-0 transition-opacity',
                      isActive
                        ? 'text-[var(--accent-text)]'
                        : 'text-[var(--text-muted)] group-hover:text-[var(--text-primary)]'
                    )}
                  />
                  <span className="truncate">{link.label}</span>
                </Link>
              );
            })}
          </div>

          <div className="space-y-0.5 pt-3 border-t border-[var(--border-subtle)] min-w-0">
            <p className="px-2.5 pb-1 text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Workspace
            </p>
            {workspaceLinks.map((link) => {
              const Icon = link.icon;
              const isActive = isRouteActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={clsx(
                    'group relative flex h-8 min-w-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-[13px] transition-colors',
                    isActive
                      ? 'bg-[var(--bg-surface-muted)] text-[var(--text-primary)] font-semibold'
                      : 'text-[var(--text-secondary)] font-normal hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
                  )}
                >
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r-full bg-[var(--accent)]"
                    />
                  )}
                  <Icon
                    aria-hidden="true"
                    className={clsx(
                      'h-3.5 w-3.5 shrink-0 transition-opacity',
                      isActive
                        ? 'text-[var(--accent-text)]'
                        : 'text-[var(--text-muted)] group-hover:text-[var(--text-primary)]'
                    )}
                  />
                  <span className="truncate">{link.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Quiet Footer: Theme Control + Quick Shortcut Hint */}
      <div className="space-y-2.5 pt-3 border-t border-[var(--border-subtle)] min-w-0">
        <ThemeToggle className="w-full" />
        <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-[var(--text-muted)]">
          <span className="truncate font-mono">Zahi Workspace</span>
          <button
            type="button"
            onClick={dispatchOpenCommandPalette}
            className="font-mono text-[10px] hover:text-[var(--text-primary)] transition-colors"
            title="Command Palette (⌘K)"
          >
            ⌘K
          </button>
        </div>
      </div>
    </aside>
  );
}

function MobileNavigationBar() {
  const pathname = usePathname() || '/dashboard';

  return (
    <div className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-glass)] backdrop-blur-md md:hidden">
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex h-12 items-center justify-between gap-2 min-w-0">
          <Link
            href="/dashboard"
            aria-label="Zahi home"
            className="inline-flex min-w-0 items-center gap-2 hover:opacity-85 transition-opacity"
          >
            <ZahiLogoMark size="xs" />
            <ZahiWordmark className="text-sm leading-none" />
          </Link>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={dispatchOpenCommandPalette}
              aria-label="Open command palette"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <ThemeToggle variant="compact" />
            <NotificationBell panelAlign="right" />
            <MobileMenuSheet pathname={pathname} />
          </div>
        </div>

        <div
          aria-label="Quick destinations"
          className="flex flex-wrap items-center gap-1 pb-2"
        >
          {mobileQuickLinks.map((link) => {
            const isActive = isRouteActive(pathname, link.href);
            return (
              <Link
                key={`mobile-${link.href}`}
                href={link.href}
                aria-current={isActive ? 'page' : undefined}
                className={clsx(
                  'inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[11.5px] whitespace-nowrap border transition-colors',
                  isActive
                    ? 'border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-semibold'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] font-medium'
                )}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]"
                  />
                )}
                <span>{link.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Shared Navigation Shell (`AppNavigation`).
 * Root stays hook-free so server tests and static unit invocations run cleanly without React dispatcher errors.
 */
export function AppNavigation() {
  return (
    <nav data-app-nav="true" className="contents md:block">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <CommandPalette />
      <DesktopSidebar />
      <MobileNavigationBar />
    </nav>
  );
}
