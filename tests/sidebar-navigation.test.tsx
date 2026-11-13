import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AppNavigation,
  SIDEBAR_STORAGE_KEY,
  getSavedSidebarCollapsed,
  setSidebarCollapsed,
  toggleSidebarCollapsed,
} from '../src/components/layout/AppNavigation';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
}));

vi.mock('@/lib/actions/notification-actions', () => ({
  getUnreadNotificationCountAction: vi.fn().mockResolvedValue({ success: true, data: 0 }),
  getNotificationsAction: vi.fn(),
  markNotificationAsReadAction: vi.fn(),
  markNotificationAsUnreadAction: vi.fn(),
  markAllNotificationsAsReadAction: vi.fn(),
  dismissNotificationAction: vi.fn(),
}));

describe('Zahi Collapsible Sidebar & Navigation Architecture', () => {
  it('renders expanded desktop sidebar by default for hydration consistency with collapse toggle, groups, and sign-out form', () => {
    const html = renderToStaticMarkup(
      <AppNavigation workspaceName="Zahi Ops HQ" userLabel="Tariq Al-Harbi" />
    );

    expect(html).toContain('data-sidebar-state="expanded"');
    expect(html).toContain('data-testid="sidebar-collapse-toggle"');
    expect(html).toContain('aria-label="Collapse sidebar"');
    expect(html).toContain('Operations');
    expect(html).toContain('Settings &amp; CLI');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/tasks"');
    expect(html).toContain('href="/calendar"');
    expect(html).toContain('href="/content"');
    expect(html).toContain('href="/notifications"');
    expect(html).toContain('href="/settings/notifications"');
    expect(html).toContain('href="/settings/tokens"');
    expect(html).toContain('action="/auth/sign-out" method="post"');
    expect(html).toContain('Zahi Ops HQ');
  });

  it('persists and toggles sidebar collapsed preference cleanly in localStorage', () => {
    const store = new Map<string, string>();
    const dispatchEvent = vi.fn();

    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
      dispatchEvent,
    });

    try {
      expect(getSavedSidebarCollapsed()).toBe(false);

      setSidebarCollapsed(true);
      expect(store.get(SIDEBAR_STORAGE_KEY)).toBe('true');
      expect(getSavedSidebarCollapsed()).toBe(true);
      expect(dispatchEvent).toHaveBeenCalledTimes(1);

      const next = toggleSidebarCollapsed();
      expect(next).toBe(false);
      expect(store.get(SIDEBAR_STORAGE_KEY)).toBe('false');
      expect(getSavedSidebarCollapsed()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
