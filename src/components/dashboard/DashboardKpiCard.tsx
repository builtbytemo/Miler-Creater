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
  subtitle,
  className,
}: DashboardKpiCardProps) {
  const isDangerActive = count > 0 && variant === 'danger';
  const isWarningActive = count > 0 && variant === 'warning';
  const isAccentActive = count > 0 && variant === 'success';
  const isInfoActive = count > 0 && variant === 'info';

  return (
    <Link
      href={href}
      aria-label={`${title}: ${count}`}
      className={clsx(
        'group relative flex min-w-0 flex-col justify-between gap-2 bg-[var(--bg-surface)] px-3 py-2.5 transition-colors hover:bg-[var(--bg-surface-hover)]',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 group-hover:pr-3.5">
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
        <span className="text-[11px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors whitespace-nowrap truncate">
          {title}
        </span>
      </div>

      <ArrowUpRight
        aria-hidden="true"
        className="pointer-events-none hidden group-hover:block absolute right-2.5 top-2.5 h-3 w-3 text-[var(--text-muted)]"
      />

      <div className="flex items-baseline justify-between gap-2 min-w-0">
        <span
          className={clsx(
            'text-[21px] font-semibold font-mono tabular-nums tracking-[-0.025em] leading-none',
            isDangerActive
              ? 'text-[var(--status-danger-text)]'
              : count === 0
                ? 'text-[var(--text-muted)]'
                : 'text-[var(--text-primary)]'
          )}
        >
          {count}
        </span>
        {subtitle && (
          <span className="text-[10.5px] font-mono text-[var(--text-muted)] truncate">
            {subtitle}
          </span>
        )}
      </div>
    </Link>
  );
}
