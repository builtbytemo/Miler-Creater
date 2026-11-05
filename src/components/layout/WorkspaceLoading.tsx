export function WorkspaceLoading() {
  return <div role="status" aria-label="Loading workspace" className="min-h-screen bg-neutral-900 p-4 sm:p-8">
    <div className="mx-auto max-w-7xl space-y-6 motion-safe:animate-pulse">
      <span className="sr-only">Loading your workspace…</span>
      <div className="h-14 rounded-xl border border-neutral-800 bg-neutral-950" />
      <div className="space-y-3 py-4"><div className="h-7 w-44 rounded bg-neutral-800" /><div className="h-4 w-64 max-w-full rounded bg-neutral-800/60" /></div>
      <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-xl border border-neutral-800 bg-neutral-950" />)}</div>
      <div className="h-72 rounded-xl border border-neutral-800 bg-neutral-950" />
    </div>
  </div>;
}
