import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceShell } from '../src/components/layout/WorkspaceShell';
import { ZahiAiRail } from '../src/components/layout/ZahiAiRail';
import { Modal } from '../src/components/ui/Modal';
import { ConfirmDialog } from '../src/components/ui/ConfirmDialog';
import { Select } from '../src/components/ui/Select';
import { Textarea } from '../src/components/ui/Textarea';
import { COMMAND_PALETTE_ITEMS, filterCommandPaletteItems } from '../src/components/ui/CommandPalette';
import {
  AI_RAIL_STORAGE_KEY,
  SIDEBAR_STORAGE_KEY,
  getSavedAiRailOpen,
  getSavedSidebarCollapsed,
  setAiRailOpen,
  setSidebarCollapsed,
  toggleAiRailOpen,
  toggleSidebarCollapsed,
} from '../src/lib/layout/rail-preferences';

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

describe('Zahi Dual-Sidebar Workspace Shell & Primitives', () => {
  it('renders unified WorkspaceShell with left navigation, main content, and collapsed right AI dock by default', () => {
    const html = renderToStaticMarkup(
      <WorkspaceShell workspaceName="Zahi Studio" userLabel="Amira Hassan">
        <div>Workspace Content</div>
      </WorkspaceShell>
    );

    expect(html).toContain('data-workspace-shell="v2"');
    expect(html).toContain('aria-label="Workspace sidebar"');
    expect(html).toContain('data-sidebar-state="expanded"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('Workspace Content');
    expect(html).toContain('aria-label="Zahi assistant dock"');
    expect(html).toContain('data-ai-rail-state="collapsed"');
    expect(html).toContain('data-testid="ai-rail-expand-toggle"');
    expect(html).toContain('data-testid="mobile-ai-rail-trigger"');
  });

  it('persists Left Sidebar and Right AI Rail preferences independently without crosstalk', () => {
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
      expect(getSavedAiRailOpen()).toBe(false);

      // Opening Right AI Rail leaves Left Sidebar untouched
      setAiRailOpen(true);
      expect(store.get(AI_RAIL_STORAGE_KEY)).toBe('true');
      expect(getSavedAiRailOpen()).toBe(true);
      expect(getSavedSidebarCollapsed()).toBe(false);

      // Collapsing Left Sidebar leaves Right AI Rail open
      setSidebarCollapsed(true);
      expect(store.get(SIDEBAR_STORAGE_KEY)).toBe('true');
      expect(getSavedSidebarCollapsed()).toBe(true);
      expect(getSavedAiRailOpen()).toBe(true);

      // Toggling both independently
      expect(toggleAiRailOpen()).toBe(false);
      expect(getSavedSidebarCollapsed()).toBe(true);
      expect(toggleSidebarCollapsed()).toBe(false);
      expect(getSavedAiRailOpen()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('prepares honest Zahi AI dock architecture with zero synthetic chat controls', () => {
    const railSource = readFileSync(
      join(process.cwd(), 'src/components/layout/ZahiAiRail.tsx'),
      'utf8'
    );

    // Must not render fake message composer inputs or fake response buttons
    expect(railSource).not.toContain('<textarea');
    expect(railSource).not.toContain('placeholder="Ask');
    expect(railSource).toContain('Assistant dock architecture prepared');
    expect(railSource).toContain('/settings/tokens');
    expect(railSource).toContain('/settings/notifications');

    const ssrHtml = renderToStaticMarkup(<ZahiAiRail workspaceName="Zahi Studio" />);
    expect(ssrHtml).toContain('data-ai-rail="true"');
  });

  it('exposes sidebar and assistant dock toggles inside CommandPalette', () => {
    const dockCommands = filterCommandPaletteItems('assistant');
    expect(dockCommands.some((item) => item.id === 'workspace-toggle-ai-rail')).toBe(true);

    const sidebarCommands = filterCommandPaletteItems('sidebar');
    expect(sidebarCommands.some((item) => item.id === 'workspace-toggle-left-sidebar')).toBe(true);

    expect(COMMAND_PALETTE_ITEMS.some((item) => item.shortcut === '[')).toBe(true);
    expect(COMMAND_PALETTE_ITEMS.some((item) => item.shortcut === ']')).toBe(true);
  });

  it('renders accessible Select, Textarea, Modal, and ConfirmDialog primitives', () => {
    const controlsHtml = renderToStaticMarkup(
      <div>
        <Select aria-label="Priority" defaultValue="high">
          <option value="high">High</option>
        </Select>
        <Textarea aria-label="Notes" defaultValue="Launch checklist" />
        <Modal isOpen onClose={vi.fn()} title="Edit Task" subtitle="Update priority and due date">
          <p>Modal content</p>
        </Modal>
        <ConfirmDialog
          isOpen
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
          title="Delete item"
          description="This action cannot be undone."
          confirmLabel="Delete"
        />
      </div>
    );

    expect(controlsHtml).toContain('<select');
    expect(controlsHtml).toContain('<textarea');
    expect(controlsHtml).toContain('Edit Task');
    expect(controlsHtml).toContain('Delete item');
    expect(controlsHtml).toContain('This action cannot be undone.');
  });
});
