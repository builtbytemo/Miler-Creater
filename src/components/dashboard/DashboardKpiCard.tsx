import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight } from 'lucide-react';
import { clsx } from 'clsx';

interface DashboardKpiCardProps {
  title: string;
  count: number;
  href: string;
  icon?: LucideIcon;
  variant?: 'default' | 'danger' | 'warning' | 'info' | 'success';
  tier?: 'hero' | 'compact';
  subtitle?: string;
  className?: string;
}

export function DashboardKpiCard({
  title,
  count,
  href,
  variant = 'default',
  tier = 'compact',
  subtitle,
  className,
}: DashboardKpiCardProps) {
  const isHero = tier === 'hero';
  const isDangerActive = count > 0 && variant === 'danger';
  const isWarningActive = count > 0 && variant === 'warning';
  const isAccentActive = count > 0 && variant === 'success';
  const isInfoActive = count > 0 && variant === 'info';
  const isNeutralActive = count > 0 && variant === 'default';

  return (
    <Link
      href={href}
      aria-label={`${title}: ${count}`}
      className={clsx(
        'group relative flex min-w-0 flex-col justify-between gap-2 bg-[var(--bg-surface)] transition-colors hover:bg-[var(--bg-surface-hover)] active:bg-[var(--bg-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]',
        isHero ? 'px-3.5 py-2.5' : 'px-3 py-2.5',
        className
      )}
    >
      {isHero && (isDangerActive || isWarningActive || isAccentActive) && (
        <span
          aria-hidden="true"
          className={clsx(
            'pointer-events-none absolute inset-x-0 top-0 h-[2px]',
            isDangerActive && 'bg-[var(--status-danger-text)]',
            isWarningActive && 'bg-[var(--status-warning-text)]',
            isAccentActive && 'bg-[var(--accent)]'
          )}
        />
      )}

      <div className="flex min-w-0 items-center gap-1.5 group-hover:pr-3.5 group-focus-visible:pr-3.5">
        {(isDangerActive || isWarningActive || isAccentActive || isInfoActive) && (
          <span
            aria-hidden="true"
            className={clsx(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              isDangerActive && 'bg-[var(--status-danger-text)]',
              isWarningActive && 'bg-[var(--status-warning-text)]',
              isAccentActive && 'bg-[var(--accent)]',
              isInfoActive && 'bg-[var(--status-info-text)]'
            )}
          />
        )}
        <span
          className={clsx(
            'text-[11px] transition-colors whitespace-nowrap truncate',
            isHero && (isDangerActive || isWarningActive)
              ? 'font-semibold text-[var(--text-primary)]'
              : 'font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] group-focus-visible:text-[var(--text-primary)]'
          )}
        >
          {title}
        </span>
      </div>

      <ArrowUpRight
        aria-hidden="true"
        className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity absolute right-2.5 top-2.5 h-3 w-3 text-[var(--text-muted)]"
      />

      <div className="flex items-baseline justify-between gap-2 min-w-0">
        <span
          className={clsx(
            'font-semibold font-mono tabular-nums tracking-[-0.025em] leading-none',
            isHero ? 'text-[22px]' : 'text-[19px]',
            isDangerActive
              ? 'text-[var(--status-danger-text)]'
              : isNeutralActive
                ? 'text-[var(--text-primary)]'
                : count === 0
                  ? 'text-[var(--text-muted)]'
                  : 'text-[var(--text-primary)]'
          )}
        >
          {count}
        </span>
        {subtitle && (
          <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] transition-colors truncate">
            {subtitle}
          </span>
        )}
      </div>
    </Link>
  );
}
