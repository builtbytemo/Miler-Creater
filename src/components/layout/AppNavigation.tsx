'use client';

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
  useId,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
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
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
} from 'lucide-react';
import { clsx } from 'clsx';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { ZahiLogoMark, ZahiWordmark } from '@/components/brand/ZahiBrand';
import {
  CommandPalette,
  dispatchOpenCommandPalette,
} from '@/components/ui/CommandPalette';
import { getUnreadNotificationCountAction } from '@/lib/actions/notification-actions';

export const SIDEBAR_STORAGE_KEY = 'zahi:sidebar-collapsed';
const SIDEBAR_CHANGE_EVENT = 'zahi:sidebar-change';

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

export interface AppNavigationProps {
  workspaceName?: string;
  userLabel?: string;
}

function isRouteActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getSavedSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed: boolean): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'true' : 'false');
      window.dispatchEvent(new CustomEvent(SIDEBAR_CHANGE_EVENT));
    }
  } catch {
    // Ignore storage access errors
  }
}

export function toggleSidebarCollapsed(): boolean {
  const next = !getSavedSidebarCollapsed();
  setSidebarCollapsed(next);
  return next;
}

function getServerSidebarCollapsed(): boolean {
  return false;
}

function subscribeToSidebarStore(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const handleStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SIDEBAR_STORAGE_KEY) {
      onStoreChange();
    }
  };
  window.addEventListener('storage', handleStorage);
  window.addEventListener(SIDEBAR_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(SIDEBAR_CHANGE_EVENT, onStoreChange);
  };
}

function useSyncedUnreadCount(): number {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void getUnreadNotificationCountAction()
        .then((res) => {
          if (!cancelled && res.success && typeof res.data === 'number') {
            setUnreadCount(Math.max(0, res.data));
          }
        })
        .catch(() => {
          // Non-blocking background refresh
        });
    };

    refresh();
    window.addEventListener('cc:notifications-updated', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('cc:notifications-updated', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return unreadCount;
}

function RailTooltip({
  label,
  shortcut,
  enabled,
  children,
}: {
  label: string;
  shortcut?: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerWrapRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  const show = () => {
    if (!enabled || !triggerWrapRef.current) return;
    const rect = triggerWrapRef.current.getBoundingClientRect();
    setCoords({
      top: Math.round(rect.top + rect.height / 2),
      left: Math.round(rect.right + 10),
    });
  };

  const hide = () => setCoords(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const handleScrollOrResize = () => setCoords(null);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [enabled]);

  return (
    <div
      ref={triggerWrapRef}
      className="relative flex justify-center w-full"
      aria-describedby={enabled && coords ? tooltipId : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {enabled &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            style={{ top: `${coords.top}px`, left: `${coords.left}px` }}
            className="fixed z-[95] -translate-y-1/2 pointer-events-none flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--bg-surface-elevated)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] shadow-[var(--shadow-elevated)] whitespace-nowrap"
          >
            <span>{label}</span>
            {shortcut && (
              <kbd className="font-mono text-[10px] rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-1 py-0.5 text-[var(--text-muted)] leading-none">
                {shortcut}
              </kbd>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

function MobileMenuSheet({
  pathname,
  unreadCount,
  workspaceName,
}: {
  pathname: string;
  unreadCount: number;
  workspaceName?: string;
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
            className="fixed inset-x-3 top-14 z-50 rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--bg-surface-elevated)] p-3 shadow-[var(--shadow-elevated)] space-y-3 max-h-[82vh] overflow-y-auto"
          >
            {workspaceName && (
              <div className="px-2 py-1 text-[11px] font-mono text-[var(--text-muted)] truncate border-b border-[var(--border-subtle)] pb-2">
                {workspaceName}
              </div>
            )}

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
              <p className="px-2.5 pb-1 text-[10px] font-mono uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Operations
              </p>
              {operationLinks.map((link) => {
                const Icon = link.icon;
                const isActive = isRouteActive(pathname, link.href);
                const showUnread = link.href === '/notifications' && unreadCount > 0;
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
                      <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
                      <span className="truncate">{link.label}</span>
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {showUnread && (
                        <span className="rounded-[4px] border badge-accent px-1.5 py-0.5 text-[10px] font-mono font-semibold leading-none">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                      {isActive && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                  </Link>
                );
              })}
            </div>

            <div className="space-y-0.5 pt-2.5 border-t border-[var(--border-subtle)]">
              <p className="px-2.5 pb-1 text-[10px] font-mono uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Settings &amp; CLI
              </p>
              {workspaceLinks.map((link) => {
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
                      <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
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
              <form action="/auth/sign-out" method="post">
                <button
                  type="submit"
                  className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Sign out</span>
                </button>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DesktopSidebar({
  workspaceName,
  userLabel,
  unreadCount,
}: {
  workspaceName?: string;
  userLabel?: string;
  unreadCount: number;
}) {
  const pathname = usePathname() || '/dashboard';
  const collapsed = useSyncExternalStore(
    subscribeToSidebarStore,
    getSavedSidebarCollapsed,
    getServerSidebarCollapsed
  );

  const handleToggleCollapse = useCallback(() => {
    toggleSidebarCollapsed();
  }, []);

  // Conflict-free keyboard shortcut `[` on desktop outside inputs/modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key !== '[') return;
      if (typeof window !== 'undefined' && window.innerWidth < 768) return;
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
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      toggleSidebarCollapsed();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <aside
      aria-label="Workspace sidebar"
      data-sidebar-state={collapsed ? 'collapsed' : 'expanded'}
      className={clsx(
        'hidden md:flex md:shrink-0 md:flex-col md:justify-between md:sticky md:top-0 md:h-screen',
        'border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] select-none',
        'transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        collapsed ? 'md:w-[68px] px-2 py-3' : 'md:w-[240px] px-3 py-3.5'
      )}
    >
      {/* Top Section: Brand + Quick Controls */}
      <div className="flex flex-col min-h-0 flex-1 space-y-3">
        {collapsed ? (
          <div className="flex flex-col items-center gap-1.5">
            <RailTooltip label="Zahi Overview" enabled>
              <Link
                href="/dashboard"
                aria-label="Zahi home"
                className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] hover:opacity-85 transition-opacity"
              >
                <ZahiLogoMark size="sm" />
              </Link>
            </RailTooltip>

            <RailTooltip label="Expand sidebar" shortcut="[" enabled>
              <button
                type="button"
                onClick={handleToggleCollapse}
                aria-label="Expand sidebar"
                aria-expanded={false}
                data-testid="sidebar-collapse-toggle"
                className="inline-flex h-8 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
              >
                <PanelLeftOpen className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </RailTooltip>

            <RailTooltip
              label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
              enabled
            >
              <NotificationBell className="justify-center" />
            </RailTooltip>

            <RailTooltip label="Search or jump" shortcut="⌘K" enabled>
              <button
                type="button"
                onClick={dispatchOpenCommandPalette}
                aria-label="Open command palette"
                className="inline-flex h-8 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </RailTooltip>
          </div>
        ) : (
          <div className="space-y-3 min-w-0">
            <div className="flex items-center justify-between gap-2 px-0.5 min-w-0">
              <Link
                href="/dashboard"
                aria-label="Zahi home"
                className="flex min-w-0 items-center gap-2 hover:opacity-85 transition-opacity"
              >
                <ZahiLogoMark size="sm" />
                <ZahiWordmark className="text-[15px] leading-none" />
              </Link>

              <div className="flex items-center gap-1 shrink-0">
                <NotificationBell />
                <button
                  type="button"
                  onClick={handleToggleCollapse}
                  aria-label="Collapse sidebar"
                  aria-expanded={true}
                  title="Collapse sidebar ([)"
                  data-testid="sidebar-collapse-toggle"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <PanelLeftClose className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            {workspaceName && (
              <div className="px-2 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]/75 min-w-0">
                <p className="text-[11px] font-medium text-[var(--text-primary)] truncate">
                  {workspaceName}
                </p>
                {userLabel && (
                  <p className="text-[10px] font-mono text-[var(--text-muted)] truncate">
                    {userLabel}
                  </p>
                )}
              </div>
            )}

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
          </div>
        )}

        {/* Middle Scrollable Navigation Architecture */}
        <div
          className={clsx(
            'flex-1 overflow-y-auto overflow-x-hidden min-h-0 pr-0.5',
            collapsed ? 'space-y-2.5 pt-2 border-t border-[var(--border-subtle)]' : 'space-y-4 pt-1'
          )}
        >
          {/* Operations Group */}
          <div className="space-y-0.5 min-w-0">
            {!collapsed && (
              <p className="px-2.5 pb-1 text-[10.5px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                Operations
              </p>
            )}
            {operationLinks.map((link) => {
              const Icon = link.icon;
              const isActive = isRouteActive(pathname, link.href);
              const isNotificationsLink = link.href === '/notifications';
              const showUnread = isNotificationsLink && unreadCount > 0;
              const linkAriaLabel = showUnread
                ? `${link.label} (${unreadCount} unread)`
                : link.label;

              const itemNode = (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-label={collapsed ? linkAriaLabel : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className={clsx(
                    'group relative flex items-center rounded-[var(--radius-sm)] transition-colors',
                    collapsed
                      ? 'h-9 w-9 justify-center mx-auto'
                      : 'h-8 w-full min-w-0 justify-between gap-2 px-2.5 text-[13px]',
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
                  <span
                    className={clsx(
                      'flex items-center min-w-0',
                      collapsed ? 'justify-center' : 'gap-2.5'
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      className={clsx(
                        'shrink-0 transition-colors',
                        collapsed ? 'h-4 w-4' : 'h-3.5 w-3.5',
                        isActive
                          ? 'text-[var(--accent-text)]'
                          : 'text-[var(--text-muted)] group-hover:text-[var(--text-primary)]'
                      )}
                    />
                    {!collapsed && <span className="truncate">{link.label}</span>}
                  </span>

                  {!collapsed && showUnread && (
                    <span className="shrink-0 rounded-[4px] border badge-accent px-1.5 py-0.5 text-[10px] font-mono font-semibold leading-none tabular-nums">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}

                  {collapsed && showUnread && (
                    <span
                      aria-hidden="true"
                      className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[var(--accent)] ring-2 ring-[var(--bg-sidebar)]"
                    />
                  )}
                </Link>
              );

              return collapsed ? (
                <RailTooltip
                  key={link.href}
                  label={linkAriaLabel}
                  enabled
                >
                  {itemNode}
                </RailTooltip>
              ) : (
                itemNode
              );
            })}
          </div>

          {/* Settings & Integrations Group */}
          <div className="space-y-0.5 pt-2.5 border-t border-[var(--border-subtle)] min-w-0">
            {!collapsed && (
              <p className="px-2.5 pb-1 text-[10.5px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                Settings &amp; CLI
              </p>
            )}
            {workspaceLinks.map((link) => {
              const Icon = link.icon;
              const isActive = isRouteActive(pathname, link.href);

              const itemNode = (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-label={collapsed ? link.label : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className={clsx(
                    'group relative flex items-center rounded-[var(--radius-sm)] transition-colors',
                    collapsed
                      ? 'h-9 w-9 justify-center mx-auto'
                      : 'h-8 w-full min-w-0 gap-2.5 px-2.5 text-[13px]',
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
                      'shrink-0 transition-colors',
                      collapsed ? 'h-4 w-4' : 'h-3.5 w-3.5',
                      isActive
                        ? 'text-[var(--accent-text)]'
                        : 'text-[var(--text-muted)] group-hover:text-[var(--text-primary)]'
                    )}
                  />
                  {!collapsed && <span className="truncate">{link.label}</span>}
                </Link>
              );

              return collapsed ? (
                <RailTooltip key={link.href} label={link.label} enabled>
                  {itemNode}
                </RailTooltip>
              ) : (
                itemNode
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Zone: Theme + Session & Controls */}
      <div className="space-y-2 pt-2.5 border-t border-[var(--border-subtle)] min-w-0 shrink-0">
        {collapsed ? (
          <div className="flex flex-col items-center gap-1.5">
            <RailTooltip label="Toggle Light / Dark theme" enabled>
              <ThemeToggle variant="compact" className="h-9 w-9" />
            </RailTooltip>
            <RailTooltip label="Sign out" enabled>
              <form action="/auth/sign-out" method="post">
                <button
                  type="submit"
                  aria-label="Sign out"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </form>
            </RailTooltip>
          </div>
        ) : (
          <>
            <ThemeToggle className="w-full" />
            <div className="flex items-center justify-between gap-2 px-1 pt-0.5 text-[11px] text-[var(--text-muted)]">
              <div className="flex items-center gap-2 min-w-0">
                <form action="/auth/sign-out" method="post">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <LogOut className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>Sign out</span>
                  </button>
                </form>
              </div>
              <button
                type="button"
                onClick={dispatchOpenCommandPalette}
                className="font-mono text-[10px] hover:text-[var(--text-primary)] transition-colors"
                title="Command Palette (⌘K) · Toggle sidebar ([)"
              >
                [ · ⌘K
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function MobileNavigationBar({
  unreadCount,
  workspaceName,
}: {
  unreadCount: number;
  workspaceName?: string;
}) {
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
            <MobileMenuSheet
              pathname={pathname}
              unreadCount={unreadCount}
              workspaceName={workspaceName}
            />
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

function AppNavigationInner({ workspaceName, userLabel }: AppNavigationProps) {
  const unreadCount = useSyncedUnreadCount();
  return (
    <>
      <DesktopSidebar
        workspaceName={workspaceName}
        userLabel={userLabel}
        unreadCount={unreadCount}
      />
      <MobileNavigationBar
        workspaceName={workspaceName}
        unreadCount={unreadCount}
      />
    </>
  );
}

/**
 * Shared Navigation Shell (`AppNavigation`).
 * Root stays hook-free so server tests and static unit invocations run cleanly without React dispatcher errors.
 */
export function AppNavigation({ workspaceName, userLabel }: AppNavigationProps = {}) {
  return (
    <nav data-app-nav="true" className="contents md:block">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <CommandPalette />
      <AppNavigationInner workspaceName={workspaceName} userLabel={userLabel} />
    </nav>
  );
}
