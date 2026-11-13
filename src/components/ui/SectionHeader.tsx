import type { ReactNode } from 'react';

export function SectionHeader({
  title,
  description,
  badge,
  action,
  headingId,
  className = '',
}: {
  title: string;
  description?: string;
  badge?: ReactNode;
  action?: ReactNode;
  headingId?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[var(--border-subtle)] ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center gap-2 min-w-0">
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
