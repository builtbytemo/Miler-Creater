'use client';

import Link from 'next/link';
import { AlertCircle, RotateCcw } from 'lucide-react';

export function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="flex min-h-[70vh] items-center justify-center bg-neutral-900 p-6">
    <div role="alert" className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-950 p-8 text-center">
      <AlertCircle aria-hidden="true" className="mx-auto mb-4 h-8 w-8 text-amber-400" />
      <h1 className="text-xl font-semibold text-neutral-100">This page couldn’t load</h1>
      <p className="mt-2 text-sm leading-relaxed text-neutral-400">Try loading it again. If the problem continues, return to your overview and try another page.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500"><RotateCcw className="h-4 w-4" />Try again</button>
        <Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-lg border border-neutral-700 px-4 text-sm text-neutral-200 hover:bg-neutral-900">Go to overview</Link>
      </div>
    </div>
  </main>;
}
