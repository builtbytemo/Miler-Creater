import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ZahiCornerBracket,
  ZahiLogoMark,
  ZahiMascot,
} from '@/components/brand/ZahiBrand';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

/**
 * Shared authentication shell framing sign-in, sign-up, and password recovery routes
 * in Zahi's warm ivory / near-black design tokens with selective mascot presence.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col justify-between bg-[var(--bg-canvas)] text-[var(--text-primary)] font-sans">
      <div className="px-5 py-4 flex items-center justify-between max-w-5xl w-full mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ZahiLogoMark size="sm" />
          <span>Back to Zahi</span>
        </Link>
        <ThemeToggle variant="compact" />
      </div>

      <div className="flex-1 flex flex-col justify-center py-6 px-4 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-6 space-y-2.5">
          <div className="flex justify-center">
            <ZahiMascot
              variant="medallion"
              priority={true}
              imgClassName="w-20 h-auto"
            />
          </div>
          <div>
            <h1 className="font-brand-serif text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
              Zahi
            </h1>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Content &amp; Task Command Center
            </p>
          </div>
        </div>

        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="relative surface-card py-7 px-6 sm:px-9 overflow-hidden">
            <ZahiCornerBracket
              position="top-left"
              className="!w-10 !h-10 opacity-30"
            />
            <ZahiCornerBracket
              position="top-right"
              className="!w-10 !h-10 opacity-30"
            />
            <div className="relative z-10">{children}</div>
          </div>
        </div>
      </div>

      <footer className="py-6 text-center text-xs text-[var(--text-muted)]">
        Zahi • Content &amp; Task Command Center
      </footer>
    </div>
  );
}
