import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { AppNavigation } from '@/components/layout/AppNavigation';
import { ZahiAiRail } from '@/components/layout/ZahiAiRail';

export type WorkspaceMaxWidth = 'narrow' | '5xl' | '6xl' | '7xl' | 'wide';

const MAX_WIDTH_CLASS: Record<WorkspaceMaxWidth, string> = {
  narrow: 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
  wide: 'max-w-[1440px]',
};

export interface WorkspaceShellProps {
  children: ReactNode;
  workspaceName?: string;
  userLabel?: string;
  maxWidth?: WorkspaceMaxWidth;
  mainClassName?: string;
  padded?: boolean;
}

/**
 * Canonical authenticated three-region workspace shell:
 * [Left Navigation Rail] + [Center Workspace <main>] + [Right Zahi Assistant Rail]
 */
export function WorkspaceShell({
  children,
  workspaceName,
  userLabel,
  maxWidth = 'wide',
  mainClassName,
  padded = true,
}: WorkspaceShellProps) {
  return (
    <div
      data-workspace-shell="v2"
      className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex flex-col md:flex-row font-sans overflow-x-clip"
    >
      <AppNavigation workspaceName={workspaceName} userLabel={userLabel} />

      <div className="flex-1 min-w-0 flex flex-col">
        <main
          id="main-content"
          tabIndex={-1}
          className={clsx(
            '@container flex-1 min-w-0 w-full mx-auto focus:outline-none',
            MAX_WIDTH_CLASS[maxWidth],
            padded && 'px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6',
            mainClassName
          )}
        >
          {children}
        </main>
      </div>

      <ZahiAiRail workspaceName={workspaceName} userLabel={userLabel} />
    </div>
  );
}
