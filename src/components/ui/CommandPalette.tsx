'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  CheckSquare,
  Calendar,
  Share2,
  Bell,
  MailCheck,
  KeyRound,
  Sun,
  Moon,
  Monitor,
  Search,
  CornerDownLeft,
  X,
} from 'lucide-react';
import { setThemePreference } from '@/components/layout/ThemeToggle';

export interface CommandPaletteItem {
  id: string;
  label: string;
  group: 'Navigate' | 'Settings' | 'Appearance';
  keywords: string;
  shortcut?: string;
  href?: string;
  action?: () => void;
  icon: typeof LayoutDashboard;
}

export const COMMAND_PALETTE_ITEMS: readonly CommandPaletteItem[] = [
  {
    id: 'nav-overview',
    label: 'Go to Overview',
    group: 'Navigate',
    keywords: 'dashboard home glance metrics',
    shortcut: 'G O',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    id: 'nav-tasks',
    label: 'Go to Tasks',
    group: 'Navigate',
    keywords: 'todo subtasks dependencies blocked overdue',
    shortcut: 'G T',
    href: '/tasks',
    icon: CheckSquare,
  },
  {
    id: 'nav-calendar',
    label: 'Go to Calendar',
    group: 'Navigate',
    keywords: 'schedule time blocks day week month',
    shortcut: 'G C',
    href: '/calendar',
    icon: Calendar,
  },
  {
    id: 'nav-content',
    label: 'Go to Content Pipeline',
    group: 'Navigate',
    keywords: 'posts drafts social linkedin reddit threads x',
    shortcut: 'G P',
    href: '/content',
    icon: Share2,
  },
  {
    id: 'nav-notifications',
    label: 'Go to Notifications',
    group: 'Navigate',
    keywords: 'alerts inbox unread mentions',
    shortcut: 'G N',
    href: '/notifications',
    icon: Bell,
  },
  {
    id: 'settings-briefing',
    label: 'Daily Briefing & Notification Settings',
    group: 'Settings',
    keywords: 'email telegram morning digest schedule alerts',
    href: '/settings/notifications',
    icon: MailCheck,
  },
  {
    id: 'settings-tokens',
    label: 'CLI, MCP & AI API Tokens',
    group: 'Settings',
    keywords: 'cli miler oauth claude ai integrations api keys',
    href: '/settings/tokens',
    icon: KeyRound,
  },
  {
    id: 'theme-light',
    label: 'Switch Theme to Warm Ivory (Light)',
    group: 'Appearance',
    keywords: 'appearance color light mode ivory',
    action: () => setThemePreference('light'),
    icon: Sun,
  },
  {
    id: 'theme-dark',
    label: 'Switch Theme to Obsidian (Dark)',
    group: 'Appearance',
    keywords: 'appearance color dark mode night',
    action: () => setThemePreference('dark'),
    icon: Moon,
  },
  {
    id: 'theme-system',
    label: 'Switch Theme to System Auto',
    group: 'Appearance',
    keywords: 'appearance color auto os match',
    action: () => setThemePreference('system'),
    icon: Monitor,
  },
] as const;

export const OPEN_COMMAND_PALETTE_EVENT = 'zahi:open-command-palette';

export function dispatchOpenCommandPalette() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
  }
}

export function filterCommandPaletteItems(
  query: string
): CommandPaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...COMMAND_PALETTE_ITEMS];
  return COMMAND_PALETTE_ITEMS.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      item.group.toLowerCase().includes(q) ||
      item.keywords.toLowerCase().includes(q)
  );
}

function CommandPaletteDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredItems = useMemo(
    () => filterCommandPaletteItems(query),
    [query]
  );

  const executeItem = useCallback(
    (item: CommandPaletteItem) => {
      onClose();
      if (item.action) {
        item.action();
      } else if (item.href) {
        router.push(item.href);
      }
    },
    [onClose, router]
  );

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const clampedIndex =
    filteredItems.length > 0 ? Math.min(activeIndex, filteredItems.length - 1) : 0;

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredItems.length > 0) {
        setActiveIndex((prev) => (prev + 1) % filteredItems.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredItems.length > 0) {
        setActiveIndex(
          (prev) => (prev - 1 + filteredItems.length) % filteredItems.length
        );
      }
    } else if (e.key === 'Enter' && filteredItems[clampedIndex]) {
      e.preventDefault();
      executeItem(filteredItems[clampedIndex]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] px-4 bg-black/45 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick command palette"
        className="w-full max-w-lg surface-elevated overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] focus-within:border-[var(--border-strong)] px-4 py-3 transition-colors">
          <Search
            className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Jump to workspace, settings, or theme..."
            aria-label="Search Zahi commands and routes"
            className="w-full bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <div
          role="listbox"
          aria-label="Available commands"
          className="max-h-80 overflow-y-auto p-2 space-y-1"
        >
          {filteredItems.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-[var(--text-muted)]">
              No matching routes or actions for &ldquo;{query}&rdquo;.
            </p>
          ) : (
            filteredItems.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === clampedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => executeItem(item)}
                  className={`w-full flex items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left text-[13px] transition-colors ${
                    isSelected
                      ? 'bg-[var(--accent-subtle)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        isSelected
                          ? 'text-[var(--accent-text)]'
                          : 'text-[var(--text-muted)]'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium">{item.label}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                      {item.group}
                    </span>
                    {isSelected && (
                      <CornerDownLeft
                        className="h-3 w-3 text-[var(--accent-text)]"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-surface-subtle)] px-4 py-2 text-[11px] font-mono text-[var(--text-muted)]">
          <span>↑↓ navigate · ↵ select</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Keyboard-driven command palette (`Cmd+K` / `Ctrl+K`) for rapid navigation
 * across Zahi routes, settings, and theme modes. Supports controlled or uncontrolled mode
 * and defers router hooks until opened.
 */
export function CommandPalette({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
} = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange]
  );

  const closePalette = useCallback(() => {
    setOpen(false);
    previousFocusRef.current?.focus();
  }, [setOpen]);

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) {
          closePalette();
        } else {
          previousFocusRef.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          setOpen(true);
        }
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        closePalette();
      }
    };

    const handleOpenEvent = () => {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setOpen(true);
    };

    window.addEventListener('keydown', handleGlobalKey);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpenEvent);
    return () => {
      window.removeEventListener('keydown', handleGlobalKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpenEvent);
    };
  }, [open, setOpen, closePalette]);

  if (!open) return null;

  return <CommandPaletteDialog onClose={closePalette} />;
}
