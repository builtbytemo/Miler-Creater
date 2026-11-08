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
} from 'lucide-react';
import { clsx } from 'clsx';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

export const primaryLinks = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
  { href: '/calendar', label: 'Calendar', icon: Calendar },
  { href: '/content', label: 'Content', icon: Share2 },
  { href: '/notifications', label: 'Notifications', icon: Bell },
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
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors',
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
            className="fixed inset-0 top-13 z-40 bg-black/25 backdrop-blur-xs"
          />
          <div
            id="mobile-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile workspace navigation"
            className="fixed inset-x-3 top-15 z-50 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-4 shadow-[var(--shadow-elevated)] space-y-4"
          >
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
                      'flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors',
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
                        className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent)] ring-1 ring-[var(--accent-border)]"
                        aria-hidden="true"
                      />
                    )}
                  </Link>
                );
              })}
            </div>

            <div className="border-t border-[var(--border-subtle)] pt-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-xs text-[var(--text-muted)]">Theme</span>
                <Link
                  href="/settings/notifications"
                  onClick={() => setOpenPathname(null)}
                  className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <SlidersHorizontal className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>Notification settings</span>
                </Link>
              </div>
              <ThemeToggle className="w-full" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function AppNavigation() {
  const pathname = usePathname() || '/dashboard';

  return (
    <nav
      aria-label="Main navigation"
      data-app-nav="true"
      className="z-30 md:w-60 md:shrink-0"
    >
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      {/* ====================================================================
          Desktop Left Sidebar (md and up) — Quiet, Minimal, Integrated
          ==================================================================== */}
      <aside
        aria-label="Workspace sidebar"
        className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-60 md:flex-col md:justify-between border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] px-4 py-6 select-none"
      >
        <div className="space-y-7 min-w-0">
          {/* Minimal Brand Header + Notification Bell */}
          <div className="flex items-center justify-between gap-2 min-w-0 px-1">
            <Link
              href="/dashboard"
              aria-label="Command Center home"
              className="group inline-flex min-w-0 items-center gap-2.5 text-sm font-semibold tracking-tight text-[var(--text-primary)]"
            >
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--text-primary)] text-[var(--bg-canvas)] text-[11px] font-bold tracking-tighter"
              >
                C
              </span>
              <span className="truncate">Command Center</span>
            </Link>

            <NotificationBell panelAlign="left" className="shrink-0" />
          </div>

          {/* Quiet Navigation Stack — Typography & Subtle Weight First */}
          <div className="space-y-0.5 min-w-0">
            {primaryLinks.map((link) => {
              const Icon = link.icon;
              const isActive = isRouteActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={clsx(
                    'group flex min-h-9 min-w-0 items-center justify-between gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] transition-colors',
                    isActive
                      ? 'bg-[var(--bg-surface-muted)] text-[var(--text-primary)] font-semibold'
                      : 'text-[var(--text-secondary)] font-normal hover:bg-[var(--bg-surface-muted)]/60 hover:text-[var(--text-primary)]'
                  )}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      aria-hidden="true"
                      className={clsx(
                        'h-4 w-4 shrink-0 transition-opacity',
                        isActive
                          ? 'text-[var(--text-primary)] opacity-100'
                          : 'text-[var(--text-muted)] opacity-75 group-hover:opacity-100 group-hover:text-[var(--text-primary)]'
                      )}
                    />
                    <span className="truncate">{link.label}</span>
                  </span>
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)] ring-1 ring-[var(--accent-border)]"
                    />
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Quiet Sidebar Footer: Theme & Alert Preferences */}
        <div className="space-y-3 pt-4 border-t border-[var(--border-subtle)] min-w-0">
          <ThemeToggle className="w-full" />
          <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-[var(--text-muted)] min-w-0">
            <span className="truncate">Workspace shell</span>
            <Link
              href="/settings/notifications"
              className="inline-flex shrink-0 items-center gap-1 hover:text-[var(--text-primary)] transition-colors"
              title="Notification preferences"
            >
              <SlidersHorizontal className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>Alerts</span>
            </Link>
          </div>
        </div>
      </aside>

      {/* ====================================================================
          Compact Mobile Navigation Bar (< md)
          ==================================================================== */}
      <div className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-glass)] backdrop-blur-xl md:hidden">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex h-13 items-center justify-between gap-2 min-w-0">
            <Link
              href="/dashboard"
              aria-label="Command Center home"
              className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight text-[var(--text-primary)]"
            >
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--text-primary)] text-[var(--bg-canvas)] text-[11px] font-bold"
              >
                C
              </span>
              <span className="truncate">Command Center</span>
            </Link>

            <div className="flex shrink-0 items-center gap-1.5">
              <ThemeToggle variant="compact" />
              <NotificationBell panelAlign="right" />
              <MobileMenuSheet pathname={pathname} />
            </div>
          </div>

          <div
            aria-label="Quick destinations"
            className="flex flex-wrap items-center gap-1.5 pb-2.5"
          >
            {mobileQuickLinks.map((link) => {
              const isActive = isRouteActive(pathname, link.href);
              return (
                <Link
                  key={`mobile-${link.href}`}
                  href={link.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={clsx(
                    'inline-flex min-h-7 items-center rounded-full px-3 py-1 text-xs whitespace-nowrap transition-colors',
                    isActive
                      ? 'bg-[var(--text-primary)] text-[var(--bg-canvas)] font-semibold'
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
    </nav>
  );
}
