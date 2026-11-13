import type { ReactNode } from 'react';
import { ZahiDividerRule, ZahiMascot } from '@/components/brand/ZahiBrand';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col justify-center px-4 py-10 sm:px-6 lg:px-8 bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-6">
        <div className="flex justify-center mb-2">
          <ZahiMascot size={48} />
        </div>
        <ZahiDividerRule className="max-w-[84px] mx-auto my-2" />
        <h1 className="heading-display text-xl">Zahi</h1>
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
  );
}
