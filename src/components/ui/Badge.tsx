import type { ReactNode } from 'react';

export type BadgeTone =
  | 'default'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'editorial';

const TONE_CLASS: Record<BadgeTone, string> = {
  default: 'badge-neutral',
  accent: 'badge-accent',
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  info: 'badge-info',
  editorial: 'badge-editorial',
};

/**
 * Compact semantic status or metadata badge built on WCAG-compliant Zahi palettes.
 */
export function Badge({
  tone = 'default',
  className = '',
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-0.5 text-[11px] font-medium leading-tight ${TONE_CLASS[tone]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
