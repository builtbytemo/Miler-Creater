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
        className="hidden md:flex md:w-[228px] md:shrink-0 md:flex-col md:justify-between border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] px-3 py-3.5"
      >
        <div className="space-y-4 motion-safe:animate-pulse">
          <div className="flex items-center justify-between px-1">
            <div className="h-6 w-24 rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)]" />
            <div className="h-7 w-7 rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)]" />
          </div>
          <div className="h-8 w-full rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)]" />
          <div className="space-y-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-8 w-full rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)]/70"
              />
            ))}
          </div>
        </div>
        <div className="h-8 w-full rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)] motion-safe:animate-pulse" />
      </div>

      {/* Main Content Skeleton */}
      <div className="flex-1 min-w-0 max-w-[1440px] w-full px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6 space-y-5 motion-safe:animate-pulse">
        <span className="sr-only">Loading your workspace…</span>

        {/* Compact Header Skeleton */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--border-subtle)]">
          <div className="space-y-1.5">
            <div className="h-3 w-44 rounded bg-[var(--bg-surface-muted)]" />
            <div className="h-6 w-64 max-w-full rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)]" />
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-8 w-24 rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)]" />
            <div className="h-8 w-24 rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)]" />
          </div>
        </div>

        {/* Single Segmented Telemetry Strip Skeleton */}
        <div className="h-16 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]" />

        {/* Asymmetric Two-Pane Body Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 space-y-5">
            <div className="surface-card h-64" />
            <div className="surface-card h-40" />
          </div>
          <div className="lg:col-span-5 space-y-5">
            <div className="surface-card h-72" />
            <div className="surface-card h-32" />
          </div>
        </div>
      </div>
    </div>
  );
}
