import type { TextareaHTMLAttributes } from 'react';

/**
 * Standardized multi-line text control built on Zahi `.input-control` tokens.
 */
export function Textarea({
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`input-control px-3.5 py-2.5 text-sm leading-relaxed ${className}`.trim()}
      {...props}
    />
  );
}
