'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CheckSquare, LayoutDashboard, Calendar, Share2, Layers } from 'lucide-react';
import { clsx } from 'clsx';

export function AppNavigation() {
  const pathname = usePathname();

  const links = [
    { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
    { href: '/tasks', label: 'Tasks', icon: CheckSquare },
    { href: '/calendar', label: 'Calendar', icon: Calendar, disabled: true, badge: 'Phase 4' },
    { href: '/content', label: 'Content', icon: Share2, disabled: true, badge: 'Phase 3' },
  ];

  return (
    <nav className="flex items-center gap-1 border-b border-neutral-800 bg-neutral-950 px-6 py-2 text-sm">
      <div className="flex items-center gap-2 mr-6 text-xs font-mono text-neutral-400">
        <Layers className="w-3.5 h-3.5 text-blue-500" />
        <span className="font-medium text-neutral-300">Command Center</span>
      </div>

      <div className="flex items-center gap-1">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);

          if (link.disabled) {
            return (
              <span
                key={link.href}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-neutral-600 dark:text-neutral-500 text-xs cursor-not-allowed"
                title={`${link.label} will be implemented in ${link.badge}`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{link.label}</span>
                <span className="text-[10px] px-1 rounded bg-neutral-900 border border-neutral-800">
                  {link.badge}
                </span>
              </span>
            );
          }

          return (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                isActive
                  ? 'bg-neutral-800 text-neutral-100 shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
