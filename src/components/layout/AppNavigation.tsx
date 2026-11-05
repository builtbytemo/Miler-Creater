'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CheckSquare, LayoutDashboard, Calendar, Share2, Layers, KeyRound } from 'lucide-react';
import { clsx } from 'clsx';
import { NotificationBell } from '@/components/notifications/NotificationBell';

const links = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
  { href: '/calendar', label: 'Calendar', icon: Calendar },
  { href: '/content', label: 'Content', icon: Share2 },
  { href: '/settings/tokens', label: 'API Tokens', icon: KeyRound },
];

export function AppNavigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className="sticky top-0 z-30 border-b border-neutral-800 bg-neutral-950/95 backdrop-blur-xl">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 px-4 sm:px-6 lg:px-8">
        <Link href="/dashboard" aria-label="Command Center home" className="flex min-h-16 items-center gap-2.5 text-sm font-semibold tracking-tight text-neutral-100">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-500/10"><Layers className="h-4 w-4 text-blue-400" /></span>
          <span>Command Center</span>
        </Link>
        <div className="order-last flex w-full gap-1 overflow-x-auto pb-2 md:order-none md:w-auto md:flex-1 md:py-2">
          {links.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return <Link key={link.href} href={link.href} aria-current={isActive ? 'page' : undefined}
              className={clsx('flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors', isActive ? 'bg-blue-500/10 text-blue-300 ring-1 ring-inset ring-blue-500/20' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100')}>
              <Icon aria-hidden="true" className="h-4 w-4" /><span>{link.label}</span>
            </Link>;
          })}
        </div>
        <div className="ml-auto flex items-center"><NotificationBell /></div>
      </div>
    </nav>
  );
}
