import type { InputHTMLAttributes, ReactNode } from 'react';

/**
 * Standardized text input control with Zahi architectural radius and Pomegranate Red focus ring.
 */
export function Input({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`input-control px-3.5 py-2 text-sm ${className}`.trim()}
      {...props}
    />
  );
}

/**
 * Standardized accessible form field wrapper with label and optional hint/error messaging.
 */
export function FormField({
  htmlFor,
  label,
  hint,
  children,
  className = '',
}: {
  htmlFor: string;
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`.trim()}>
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium text-[var(--text-secondary)]"
      >
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}
