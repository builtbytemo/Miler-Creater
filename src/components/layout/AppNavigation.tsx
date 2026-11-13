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
  MailCheck,
  Search,
  Menu,
  X,
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

const workspaceMainLinks = primaryLinks.slice(0, 5);

const settingsLinks = [
  { href: '/settings/notifications', label: 'Daily Briefing', icon: MailCheck },
  { href: '/settings/tokens', label: 'API Tokens', icon: KeyRound },
] as const;

const mobileQuickLinks = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/content', label: 'Content' },
  { href: '/settings/notifications', label: 'Briefing' },
  { href: '/settings/tokens', label: 'Tokens' },
] as const;

function isRouteActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function MobileMenuSheet({
  pathname,
  onOpenCommandPalette,
}: {
  pathname: string;
  onOpenCommandPalette: () => void;
}) {
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
        onClick={() =>
          setOpenPathname((prev) => (prev === pathname ? null : pathname))
        }
        aria-expanded={open}
        aria-controls="mobile-navigation-drawer"
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        data-testid="mobile-menu-trigger"
        className={clsx(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border transition-colors',
          'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
          'hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]',
          open &&
            'border-[var(--border-strong)] bg-[var(--bg-surface-hover)] text-[var(--text-primary)]'
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
            className="fixed inset-0 top-13 z-40 bg-black/30 backdrop-blur-xs"
          />
          <div
            id="mobile-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile workspace navigation"
            className="fixed inset-x-3 top-14 z-50 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-4 shadow-[var(--shadow-elevated)] space-y-4"
          >
            <button
              type="button"
              onClick={() => {
                setOpenPathname(null);
                onOpenCommandPalette();
              }}
              className="w-full flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface-subtle)] px-3 py-2 text-xs text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Jump to page or theme...</span>
              </span>
              <span className="font-mono text-[10px]">⌘K</span>
            </button>

            <div className="space-y-0.5">
              <p className="px-2 pb-1 text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                Workspace
              </p>
              {workspaceMainLinks.map((link) => {
                const Icon = link.icon;
                const isActive = isRouteActive(pathname, link.href);
                return (
                  <Link
                    key={`drawer-${link.href}`}
                    href={link.href}
                    onClick={() => setOpenPathname(null)}
                    aria-current={isActive ? 'page' : undefined}
                    className={clsx(
                      'flex items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-[var(--bg-surface-muted)] text-[var(--text-primary)] font-semibold'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        className={clsx(
                          'h-4 w-4 shrink-0',
                          isActive ? 'text-[var(--accent-text)]' : 'opacity-75'
                        )}
                        aria-hidden="true"
                      />
                      <span className="truncate">{link.label}</span>
                    </span>
                    {isActive && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rotate-45 bg-[var(--accent)]"
                        aria-hidden="true"
                      />
                    )}
                  </Link>
                );
              })}
            </div>

            <div className="space-y-0.5 border-t border-[var(--border-subtle)] pt-3">
              <p className="px-2 pb-1 text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                Settings &amp; CLI
              </p>
              {settingsLinks.map((link) => {
                const Icon = link.icon;
                const isActive = isRouteActive(pathname, link.href);
                return (
                  <Link
                    key={`drawer-settings-${link.href}`}
                    href={link.href}
                    onClick={() => setOpenPathname(null)}
                    aria-current={isActive ? 'page' : undefined}
                    className={clsx(
                      'flex items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-[var(--bg-surface-muted)] text-[var(--text-primary)] font-semibold'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        className={clsx(
                          'h-4 w-4 shrink-0',
                          isActive ? 'text-[var(--accent-text)]' : 'opacity-75'
                        )}
                        aria-hidden="true"
                      />
                      <span className="truncate">{link.label}</span>
                    </span>
                    {isActive && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rotate-45 bg-[var(--accent)]"
                        aria-hidden="true"
                      />
                    )}
                  </Link>
                );
              })}
            </div>

            <div className="border-t border-[var(--border-subtle)] pt-3 space-y-2">
              <span className="block px-1 text-[11px] font-mono text-[var(--text-muted)]">
                Appearance
              </span>
              <ThemeToggle className="w-full" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SidebarNavItem({
  href,
  label,
  icon: Icon,
  isActive,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={clsx(
        'group relative flex min-h-8.5 min-w-0 items-center justify-between gap-2.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-[13px] transition-all',
        isActive
          ? 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-[var(--shadow-card)] text-[var(--text-primary)] font-semibold'
          : 'border border-transparent text-[var(--text-secondary)] font-medium hover:bg-[var(--bg-surface)]/65 hover:text-[var(--text-primary)]'
      )}
    >
      <span className="flex items-center gap-2.5 min-w-0">
        <Icon
          aria-hidden="true"
          className={clsx(
            'h-[15px] w-[15px] shrink-0 transition-colors',
            isActive
              ? 'text-[var(--accent-text)]'
              : 'text-[var(--text-muted)] group-hover:text-[var(--text-primary)]'
          )}
        />
        <span className="truncate">{label}</span>
      </span>
      {isActive && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rotate-45 bg-[var(--accent)]"
        />
      )}
    </Link>
  );
}

/**
 * Primary application shell providing persistent desktop sidebar, responsive mobile drawer,
 * quick command access (`Cmd/Ctrl + K`), theme switching, and workspace notifications.
 */
export function AppNavigation() {
  const pathname = usePathname() || '/dashboard';

  return (
    <nav
      aria-label="Main navigation"
      data-app-nav="true"
      className="z-30 md:w-[var(--sidebar-width)] md:shrink-0"
    >
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      {/* Desktop Left Sidebar (md and up) */}
      <aside
        aria-label="Workspace sidebar"
        className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-[var(--sidebar-width)] md:flex-col md:justify-between border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] px-3.5 py-5 select-none"
      >
        <div className="space-y-5 min-w-0">
          {/* Zahi Brand Header + Notification Bell */}
          <div className="flex items-center justify-between gap-2 min-w-0 px-1">
            <Link
              href="/dashboard"
              aria-label="Zahi home"
              className="group inline-flex min-w-0 items-center gap-2.5 text-[var(--text-primary)]"
            >
              <ZahiLogoMark size="md" />
              <span className="flex flex-col min-w-0 leading-none">
                <ZahiWordmark className="text-[19px] leading-none" />
              </span>
            </Link>

            <NotificationBell panelAlign="left" className="shrink-0" />
          </div>

          {/* Quick Command Trigger */}
          <button
            type="button"
            onClick={dispatchOpenCommandPalette}
            aria-label="Open quick command palette"
            className="w-full flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] shadow-2xs hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
          >
            <span className="inline-flex items-center gap-2 min-w-0">
              <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Quick jump...</span>
            </span>
            <kbd className="shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-subtle)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--text-muted)]">
              ⌘K
            </kbd>
          </button>

          {/* Primary Workspace Navigation */}
          <div className="space-y-1 min-w-0">
            <p className="px-2 pb-0.5 text-[10px] font-mono uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Workspace
            </p>
            <div className="space-y-0.5">
              {workspaceMainLinks.map((link) => (
                <SidebarNavItem
                  key={link.href}
                  href={link.href}
                  label={link.label}
                  icon={link.icon}
                  isActive={isRouteActive(pathname, link.href)}
                />
              ))}
            </div>
          </div>

          {/* Settings & Briefing Access */}
          <div className="space-y-1 min-w-0 pt-1">
            <p className="px-2 pb-0.5 text-[10px] font-mono uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Automation &amp; Keys
            </p>
            <div className="space-y-0.5">
              {settingsLinks.map((link) => (
                <SidebarNavItem
                  key={link.href}
                  href={link.href}
                  label={link.label}
                  icon={link.icon}
                  isActive={isRouteActive(pathname, link.href)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Quiet Sidebar Footer: Theme Switcher */}
        <div className="space-y-2.5 pt-4 border-t border-[var(--border-subtle)] min-w-0">
          <ThemeToggle className="w-full" />
          <div className="flex items-center justify-between gap-2 px-1 text-[11px] font-mono text-[var(--text-muted)] min-w-0">
            <span className="truncate">Zahi Command</span>
            <button
              type="button"
              onClick={dispatchOpenCommandPalette}
              className="shrink-0 hover:text-[var(--text-primary)] transition-colors"
            >
              ⌘K
            </button>
          </div>
        </div>
      </aside>

      {/* Compact Mobile Navigation Bar (< md) */}
      <div className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-glass)] backdrop-blur-xl md:hidden">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex h-13 items-center justify-between gap-2 min-w-0">
            <Link
              href="/dashboard"
              aria-label="Zahi home"
              className="inline-flex min-w-0 items-center gap-2 text-[var(--text-primary)]"
            >
              <ZahiLogoMark size="sm" />
              <ZahiWordmark className="text-[18px] leading-none" />
            </Link>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={dispatchOpenCommandPalette}
                aria-label="Open quick jump"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <ThemeToggle variant="compact" />
              <NotificationBell panelAlign="right" />
              <MobileMenuSheet
                pathname={pathname}
                onOpenCommandPalette={dispatchOpenCommandPalette}
              />
            </div>
          </div>

          <div
            aria-label="Quick destinations"
            className="flex flex-wrap items-center gap-1 pb-2.5"
          >
            {mobileQuickLinks.map((link) => {
              const isActive = isRouteActive(pathname, link.href);
              return (
                <Link
                  key={`mobile-${link.href}`}
                  href={link.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={clsx(
                    'inline-flex min-h-7 items-center rounded-[var(--radius-sm)] px-2.5 py-1 text-xs whitespace-nowrap transition-colors',
                    isActive
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] font-medium'
                  )}
                >
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <CommandPalette />
    </nav>
  );
}
