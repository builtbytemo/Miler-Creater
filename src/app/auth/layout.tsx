import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-6">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-bold text-lg mb-3 shadow-sm">
          CC
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Command Center</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
          Social Media Content & Task Operations
        </p>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-neutral-900 py-8 px-6 shadow-sm border border-neutral-200 dark:border-neutral-800 sm:rounded-xl sm:px-10">
          {children}
        </div>
      </div>

      <footer className="mt-8 text-center text-xs text-neutral-400 dark:text-neutral-600">
        Personal-first Content & Task Command Center • Phase 1 Architecture
      </footer>
    </div>
  );
}
