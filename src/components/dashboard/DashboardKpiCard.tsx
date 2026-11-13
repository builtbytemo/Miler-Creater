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
}

/**
 * High-density telemetry counter cell linking directly to filtered operational views.
 */
export function DashboardKpiCard({
  title,
  count,
  href,
  variant = 'default',
  tier = 'hero',
  subtitle,
}: DashboardKpiCardProps) {
  const hasUrgentCount = count > 0 && (variant === 'danger' || variant === 'warning');

  if (tier === 'compact') {
    return (
      <Link
        href={href}
        aria-label={`${title}: ${count}`}
        className="group flex min-w-0 items-center justify-between gap-3 rounded-[var(--radius-sm)] py-1.5 px-2 -mx-2 transition-colors hover:bg-[var(--bg-surface-hover)]"
      >
        <span className="flex min-w-0 items-center gap-2 text-xs text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
          {hasUrgentCount && (
            <span
              aria-hidden="true"
              className={clsx(
                'h-1.5 w-1.5 rotate-45 shrink-0',
                variant === 'danger'
                  ? 'bg-[var(--status-danger-text)]'
                  : 'bg-[var(--status-warning-text)]'
              )}
            />
          )}
          <span className="truncate">{title}</span>
        </span>
        <span className="inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap">
          <span
            className={clsx(
              'text-sm font-semibold tracking-tight tabular-nums font-mono',
              hasUrgentCount && variant === 'danger'
                ? 'text-[var(--status-danger-text)]'
                : 'text-[var(--text-primary)]'
            )}
          >
            {count}
          </span>
          <ArrowUpRight
            aria-hidden="true"
            className="h-3 w-3 shrink-0 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100"
          />
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-label={`${title}: ${count}`}
      className="group block min-w-0 rounded-[var(--radius-md)] p-2 -m-2 transition-colors hover:bg-[var(--bg-surface-hover)]/80"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
          {variant === 'success' && count > 0 && (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rotate-45 bg-[var(--accent)]"
            />
          )}
          {hasUrgentCount && (
            <span
              aria-hidden="true"
              className={clsx(
                'h-1.5 w-1.5 shrink-0 rotate-45',
                variant === 'danger'
                  ? 'bg-[var(--status-danger-text)]'
                  : 'bg-[var(--status-warning-text)]'
              )}
            />
          )}
          <span className="truncate">{title}</span>
        </span>
        <ArrowUpRight
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] opacity-45 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[var(--accent-text)] group-hover:opacity-100"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p
          className={clsx(
            'text-2xl sm:text-[30px] font-semibold tracking-[-0.03em] tabular-nums leading-none',
            hasUrgentCount && variant === 'danger'
              ? 'text-[var(--status-danger-text)]'
              : 'text-[var(--text-primary)]'
          )}
        >
          {count}
        </p>
        {subtitle && (
          <span className="text-[11px] font-mono text-[var(--text-muted)] whitespace-nowrap">
            {subtitle}
          </span>
        )}
      </div>
    </Link>
  );
}
