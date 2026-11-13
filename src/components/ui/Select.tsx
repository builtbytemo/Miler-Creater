import type { SelectHTMLAttributes } from 'react';

/**
 * Standardized select control built on Zahi `.input-control` tokens.
 */
export function Select({
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`input-control px-3 py-2 text-sm appearance-auto ${className}`.trim()}
      {...props}
    >
      {children}
    </select>
  );
}
