import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  NotificationPanel,
  computeNotificationPanelLayout,
} from '../src/components/notifications/NotificationPanel';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/actions/notification-actions', () => ({
  getNotificationsAction: vi.fn(),
  markNotificationAsReadAction: vi.fn(),
  markNotificationAsUnreadAction: vi.fn(),
  markAllNotificationsAsReadAction: vi.fn(),
  dismissNotificationAction: vi.fn(),
}));

describe('Notification Popover Layering & Responsive Coordinates', () => {
  it('renders via createPortal to document.body to escape sidebar/header stacking contexts', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/components/notifications/NotificationPanel.tsx'),
      'utf8'
    );
    expect(panelSource).toContain("from 'react-dom'");
    expect(panelSource).toContain('createPortal(');
    expect(panelSource).toContain('document.body');
  });

  it('keeps accessible dialog markup in SSR output and computes clamped portal coordinates', () => {
    const html = renderToStaticMarkup(
      <NotificationPanel
        isOpen
        onClose={vi.fn()}
        workspaceId="11111111-1111-4111-a111-111111111111"
      />
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Notifications Panel"');

    const mobile = computeNotificationPanelLayout({
      triggerRect: { top: 8, bottom: 40, left: 300, right: 332 },
      viewportWidth: 390,
      viewportHeight: 844,
      align: 'right',
    });
    expect(mobile.isMobile).toBe(true);
    expect(mobile.left).toBe(12);
    expect(mobile.width).toBe(366);
    expect(mobile.top).toBe(52);

    const expandedDesktop = computeNotificationPanelLayout({
      triggerRect: { top: 14, bottom: 46, left: 178, right: 210 },
      viewportWidth: 1280,
      viewportHeight: 800,
      align: 'responsive',
    });
    expect(expandedDesktop.isMobile).toBe(false);
    expect(expandedDesktop.left).toBe(178);
    expect(expandedDesktop.top).toBe(54);
    expect(expandedDesktop.width).toBe(416);

    const collapsedDesktop = computeNotificationPanelLayout({
      triggerRect: { top: 52, bottom: 84, left: 16, right: 48 },
      viewportWidth: 1280,
      viewportHeight: 800,
      align: 'responsive',
    });
    expect(collapsedDesktop.isMobile).toBe(false);
    expect(collapsedDesktop.left).toBe(60);
    expect(collapsedDesktop.top).toBe(52);

    const rightAlignedShort = computeNotificationPanelLayout({
      triggerRect: { top: 10, bottom: 42, left: 1200, right: 1232 },
      viewportWidth: 1280,
      viewportHeight: 500,
      align: 'right',
    });
    expect(rightAlignedShort.left + rightAlignedShort.width).toBeLessThanOrEqual(1268);
    expect(rightAlignedShort.top + rightAlignedShort.maxHeight).toBeLessThanOrEqual(500);
  });
});
