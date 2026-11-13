import type { HTMLAttributes, ReactNode } from 'react';

export function Card({
  children,
  className = '',
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  interactive?: boolean;
}) {
  return (
    <div
      className={`${interactive ? 'surface-card-interactive' : 'surface-card'} ${className}`.trim()}
      {...props}
    >
      {children}
    </div>
  );
}
