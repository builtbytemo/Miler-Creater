'use client';

import Link from 'next/link';
import { AlertCircle, RotateCcw, ArrowUpRight } from 'lucide-react';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';

export function WorkspaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <WorkspaceShell
      maxWidth="wide"
      padded={false}
      mainClassName="min-h-[75vh] flex items-center justify-center p-6"
    >
      <div
        role="alert"
        className="surface-card w-full max-w-md p-6 sm:p-8 text-center space-y-4"
      >
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] badge-warning border">
            <AlertCircle aria-hidden="true" className="h-5 w-5" />
          </div>
          <div className="space-y-1.5">
            <h1 className="heading-section text-base">
              This page couldn’t load
            </h1>
            <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
              Try loading it again. If the problem continues, return to your overview and try another page.
            </p>
          </div>
          <div className="pt-1 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="btn-accent h-8 px-3.5 text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Try again</span>
            </button>
            <Link
              href="/dashboard"
              className="btn-secondary h-8 px-3.5 text-xs"
            >
              <span>Go to overview</span>
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
    </WorkspaceShell>
  );
}
