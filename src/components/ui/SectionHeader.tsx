import type { ReactNode } from 'react';
import { ZahiDiamondMark } from '@/components/brand/ZahiBrand';

export function SectionHeader({
  title,
  description,
  badge,
  action,
  headingId,
  accented = false,
  className = '',
}: {
  title: string;
  description?: string;
  badge?: ReactNode;
  action?: ReactNode;
  headingId?: string;
  accented?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[var(--border-subtle)] ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        {accented && <ZahiDiamondMark size="xs" tone="accent" />}
        <h2
          id={headingId}
          className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]"
        >
          {title}
        </h2>
        {badge}
        {description && (
          <span className="text-xs text-[var(--text-muted)] truncate">
            {description}
          </span>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
