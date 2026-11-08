'use client';

import Link from 'next/link';
import { AlertCircle, RotateCcw, ArrowUpRight } from 'lucide-react';
import { AppNavigation } from '@/components/layout/AppNavigation';

export function WorkspaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      data-workspace-shell="v2"
      className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex flex-col md:flex-row font-sans"
    >
      <AppNavigation />
      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-1 min-w-0 min-h-[75vh] items-center justify-center p-6"
      >
        <div
          role="alert"
          className="surface-card w-full max-w-md p-8 sm:p-10 text-center space-y-4"
        >
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full badge-warning border">
            <AlertCircle aria-hidden="true" className="h-5 w-5" />
          </div>
          <div className="space-y-2">
            <h1 className="heading-section text-xl">
              This page couldn’t load
            </h1>
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
              Try loading it again. If the problem continues, return to your overview and try another page.
            </p>
          </div>
          <div className="pt-2 flex flex-wrap justify-center gap-2.5">
            <button
              type="button"
              onClick={reset}
              className="btn-accent min-h-9 px-4.5 py-2 text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Try again</span>
            </button>
            <Link
              href="/dashboard"
              className="btn-secondary min-h-9 px-4.5 py-2 text-xs"
            >
              <span>Go to overview</span>
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
