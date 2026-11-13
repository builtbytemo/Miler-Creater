/**
 * Standardized loading skeleton matching the desktop sidebar + main operational overview grid.
 */
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
        className="hidden md:flex md:w-[var(--sidebar-width)] md:shrink-0 md:flex-col md:justify-between border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] px-3.5 py-5"
      >
        <div className="space-y-6 motion-safe:animate-pulse">
          <div className="flex items-center justify-between px-1">
            <div className="h-7 w-24 rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)]" />
            <div className="h-7 w-7 rounded-[var(--radius-md)] bg-[var(--bg-surface-muted)]" />
          </div>
          <div className="h-8 w-full rounded-[var(--radius-md)] bg-[var(--bg-surface-muted)]/80" />
          <div className="space-y-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="h-8 w-full rounded-[var(--radius-md)] bg-[var(--bg-surface-muted)]/65"
              />
            ))}
          </div>
        </div>
        <div className="h-9 w-full rounded-[var(--radius-md)] bg-[var(--bg-surface-muted)] motion-safe:animate-pulse" />
      </div>

      {/* Main Content Skeleton */}
      <div className="flex-1 min-w-0 max-w-6xl w-full mx-auto px-5 py-7 sm:px-8 sm:py-10 lg:px-12 lg:py-10 space-y-8 motion-safe:animate-pulse">
        <span className="sr-only">Loading your workspace…</span>

        {/* Editorial Masthead Skeleton */}
        <div className="space-y-4 border-b border-[var(--border-subtle)] pb-6">
          <div className="h-4 w-52 rounded-[var(--radius-xs)] bg-[var(--bg-surface-muted)]" />
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="space-y-2.5">
              <div className="h-9 w-72 max-w-full rounded-[var(--radius-md)] bg-[var(--bg-surface-muted)]" />
              <div className="h-4 w-96 max-w-full rounded-[var(--radius-xs)] bg-[var(--bg-surface-muted)]" />
            </div>
            <div className="flex gap-2">
              <div className="h-9 w-24 rounded-[var(--radius-md)] bg-[var(--bg-surface-muted)]" />
              <div className="h-9 w-28 rounded-[var(--radius-md)] bg-[var(--bg-surface-muted)]" />
            </div>
          </div>
        </div>

        {/* Two-Column Operational Body Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 space-y-6">
            <div className="surface-card h-64 p-6" />
            <div className="surface-card h-44 p-6" />
          </div>
          <div className="lg:col-span-5 space-y-6">
            <div className="surface-card h-56 p-6" />
            <div className="surface-card h-40 p-6" />
          </div>
        </div>
      </div>
    </div>
  );
}
