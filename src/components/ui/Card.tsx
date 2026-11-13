import type { ReactNode } from 'react';

/**
 * Standardized surface card container with subtle hairline border and optional interactive state.
 */
export function Card({
  interactive = false,
  className = '',
  children,
}: {
  interactive?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`${interactive ? 'surface-card-interactive' : 'surface-card'} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
