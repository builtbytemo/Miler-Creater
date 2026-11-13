import Link from 'next/link';
import { Bell, ChevronLeft, KeyRound } from 'lucide-react';
import { ZahiDiamondMark } from '@/components/brand/ZahiBrand';

export interface SettingsNavProps {
  activeTab: 'notifications' | 'tokens';
  backHref: string;
  backLabel: string;
  eyebrow: string;
  title: string;
  description: string;
  metaLabel?: string;
}

const SETTINGS_TABS = [
  {
    id: 'notifications' as const,
    label: 'Notifications & Briefing',
    href: '/settings/notifications',
    icon: Bell,
  },
  {
    id: 'tokens' as const,
    label: 'CLI, MCP & API Tokens',
    href: '/settings/tokens',
    icon: KeyRound,
  },
];

/**
 * Shared masthead and section switcher across authenticated Zahi settings routes.
 */
export function SettingsNav({
  activeTab,
  backHref,
  backLabel,
  eyebrow,
  title,
  description,
  metaLabel,
}: SettingsNavProps) {
  return (
    <header className="mb-6 pb-5 border-b border-[var(--border-subtle)] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] flex-wrap">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>{backLabel}</span>
          </Link>
          <span aria-hidden="true" className="text-[var(--text-tertiary)]">
            /
          </span>
          <ZahiDiamondMark size="xs" tone="accent" />
          <span className="font-mono uppercase tracking-[0.08em] text-[10.5px] font-medium">
            {eyebrow}
          </span>
          {metaLabel && (
            <>
              <span aria-hidden="true" className="text-[var(--text-tertiary)]">
                ·
              </span>
              <span className="font-mono text-[11px]">{metaLabel}</span>
            </>
          )}
        </div>

        <nav
          aria-label="Settings sections"
          className="inline-flex items-center gap-0.5 p-0.5 rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)] border border-[var(--border-subtle)] text-xs"
        >
          {SETTINGS_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={
                  isActive
                    ? 'inline-flex items-center gap-1.5 min-h-7 px-3 py-1 rounded-[5px] bg-[var(--bg-surface)] text-[var(--text-primary)] font-semibold shadow-2xs ring-1 ring-[var(--border-subtle)] transition-all'
                    : 'inline-flex items-center gap-1.5 min-h-7 px-3 py-1 rounded-[5px] text-[var(--text-muted)] hover:text-[var(--text-primary)] font-medium transition-all'
                }
              >
                <Icon
                  className={
                    isActive
                      ? 'w-3.5 h-3.5 text-[var(--accent)]'
                      : 'w-3.5 h-3.5 text-[var(--text-muted)]'
                  }
                />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="space-y-1">
        <h1 className="heading-display text-[22px] sm:text-[26px]">{title}</h1>
        <p className="text-xs sm:text-sm text-[var(--text-secondary)] max-w-2xl leading-relaxed">
          {description}
        </p>
      </div>
    </header>
  );
}
