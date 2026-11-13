import type { ReactNode } from 'react';
import { ZahiMascot } from '@/components/brand/ZahiBrand';

/**
 * Curated empty state for clear queues or uninitialized views, optionally
 * displaying the canonical monochrome Zahi mascot.
 */
export function EmptyState({
  title,
  description,
  icon,
  showMascot = false,
  action,
  className = '',
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  showMascot?: boolean;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`surface-card p-6 sm:p-8 flex flex-col items-center text-center gap-3 ${className}`.trim()}
    >
      {showMascot ? (
        <ZahiMascot variant="medallion" imgClassName="w-20 h-auto" />
      ) : (
        icon && (
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-secondary)]">
            {icon}
          </div>
        )
      )}
      <div className="space-y-1 max-w-sm">
        <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
        <p className="text-xs sm:text-[13px] text-[var(--text-secondary)] leading-relaxed">
          {description}
        </p>
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
