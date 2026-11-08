export function WorkspaceLoading() {
  return (
    <div
      role="status"
      aria-label="Loading workspace"
      className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex flex-col md:flex-row"
    >
      {/* Desktop Sidebar Skeleton */}
      <div
        aria-hidden="true"
        className="hidden md:flex md:w-60 md:shrink-0 md:flex-col md:justify-between border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] px-4 py-6"
      >
        <div className="space-y-8 motion-safe:animate-pulse">
          <div className="flex items-center justify-between">
            <div className="h-6 w-32 rounded-md bg-[var(--bg-surface-muted)]" />
            <div className="h-8 w-8 rounded-full bg-[var(--bg-surface-muted)]" />
          </div>
          <div className="space-y-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-8 w-full rounded-lg bg-[var(--bg-surface-muted)]/70"
              />
            ))}
          </div>
        </div>
        <div className="h-9 w-full rounded-full bg-[var(--bg-surface-muted)] motion-safe:animate-pulse" />
      </div>

      {/* Main Content Skeleton */}
      <div className="flex-1 min-w-0 max-w-6xl w-full mx-auto px-5 py-7 sm:px-8 sm:py-10 lg:px-12 lg:py-12 space-y-10 motion-safe:animate-pulse">
        <span className="sr-only">Loading your workspace…</span>

        {/* Open Masthead Skeleton */}
        <div className="space-y-4 border-b border-[var(--border-subtle)] pb-8">
          <div className="h-4 w-48 rounded bg-[var(--bg-surface-muted)]" />
          <div className="h-10 w-80 max-w-full rounded-xl bg-[var(--bg-surface-muted)]" />
          <div className="h-4 w-96 max-w-full rounded bg-[var(--bg-surface-muted)]" />
        </div>

        {/* 2-Part Pulse Composition Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 surface-card h-44 p-6" />
          <div className="lg:col-span-5 surface-card h-44 p-6" />
        </div>

        {/* Two-Column Body Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-7 surface-card h-64 p-6" />
          <div className="lg:col-span-5 surface-card h-64 p-6" />
        </div>
      </div>
    </div>
  );
}
