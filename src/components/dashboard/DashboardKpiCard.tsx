import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

interface DashboardKpiCardProps {
  title: string;
  count: number;
  href: string;
  icon: LucideIcon;
  variant?: 'default' | 'danger' | 'warning' | 'info' | 'success';
  subtitle?: string;
}

export function DashboardKpiCard({
  title,
  count,
  href,
  icon: Icon,
  variant = 'default',
  subtitle,
}: DashboardKpiCardProps) {
  const variantStyles = {
    default: 'text-neutral-400 bg-neutral-900 border-neutral-800 group-hover:border-neutral-700',
    danger: count > 0 
      ? 'text-rose-400 bg-rose-500/10 border-rose-500/20 group-hover:border-rose-500/40' 
      : 'text-neutral-400 bg-neutral-900 border-neutral-800',
    warning: count > 0 
      ? 'text-amber-400 bg-amber-500/10 border-amber-500/20 group-hover:border-amber-500/40' 
      : 'text-neutral-400 bg-neutral-900 border-neutral-800',
    info: 'text-blue-400 bg-blue-500/10 border-blue-500/20 group-hover:border-blue-500/40',
    success: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 group-hover:border-emerald-500/40',
  };

  return (
    <Link
      href={href}
      aria-label={`${title}: ${count}`}
      className="group block p-4 rounded-xl bg-neutral-950 border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-925 transition-all focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-neutral-400 group-hover:text-neutral-300 transition-colors">
            {title}
          </p>
          <p className="text-2xl font-bold tracking-tight text-neutral-100">
            {count}
          </p>
          {subtitle && (
            <p className="text-[11px] text-neutral-500">
              {subtitle}
            </p>
          )}
        </div>
        <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center border transition-colors', variantStyles[variant])}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </Link>
  );
}
