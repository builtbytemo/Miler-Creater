import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ZahiDiamondMark, ZahiDividerRule, ZahiMascot } from '@/components/brand/ZahiBrand';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 pt-4 flex items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Home</span>
        </Link>
        <ThemeToggle variant="compact" />
      </div>

      <div className="flex-1 flex flex-col justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-6">
          <div className="flex justify-center mb-2">
            <ZahiMascot size={48} />
          </div>
          <ZahiDividerRule className="max-w-[84px] mx-auto my-2" />
          <div className="inline-flex items-center gap-1.5 justify-center">
            <h1 className="heading-display text-xl">Zahi</h1>
            <ZahiDiamondMark size="xs" tone="accent" />
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Content &amp; Task Command Center
          </p>
        </div>

        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="surface-card zahi-khatam-accent py-7 px-6 sm:px-9">
            {children}
          </div>
        </div>

        <footer className="mt-7 text-center text-xs text-[var(--text-muted)]">
          Zahi • Content &amp; Task Command Center
        </footer>
      </div>
    </div>
  );
}
