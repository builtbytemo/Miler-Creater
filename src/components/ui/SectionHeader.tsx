import type { ReactNode } from 'react';

/**
 * Standardized section header with crisp diamond marker or eyebrow, heading, and trailing action slot.
 */
export function SectionHeader({
  title,
  eyebrow,
  count,
  action,
  accentMarker = false,
  className = '',
}: {
  title: string;
  eyebrow?: string;
  count?: number;
  action?: ReactNode;
  accentMarker?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 min-w-0 ${className}`.trim()}
    >
      <div className="min-w-0 space-y-0.5">
        {eyebrow && (
          <p className="label-eyebrow flex items-center gap-2">
            {accentMarker && (
              <span
                className="inline-block h-1.5 w-1.5 rotate-45 bg-[var(--accent)]"
                aria-hidden="true"
              />
            )}
            <span>{eyebrow}</span>
          </p>
        )}
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="heading-section text-[15px] sm:text-base">{title}</h2>
          {typeof count === 'number' && (
            <span className="font-mono text-xs tabular-nums text-[var(--text-muted)]">
              {count}
            </span>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
