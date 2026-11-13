import type { ReactNode } from 'react';
import { ZahiMascot } from '@/components/brand/ZahiBrand';

export interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
  showMascot?: boolean;
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  showMascot = false,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-6 text-center space-y-2.5 ${className}`.trim()}
    >
      {showMascot ? (
        <div className="flex justify-center pb-0.5">
          <ZahiMascot size={48} />
        </div>
      ) : icon ? (
        <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-secondary)]">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</p>
        <p className="text-xs text-[var(--text-muted)] max-w-sm mx-auto leading-relaxed">
          {description}
        </p>
      </div>
      {action && <div className="pt-1 flex justify-center gap-2">{action}</div>}
    </div>
  );
}
