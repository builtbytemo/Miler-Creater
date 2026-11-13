import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { DashboardContentMetrics } from '@/lib/services/dashboard-service';
import { formatInTimeZone } from '@/lib/temporal/timezone';
import { ZahiDiamondMark } from '@/components/brand/ZahiBrand';

interface DashboardContentPipelineProps {
  content: DashboardContentMetrics;
  timeZone: string;
}

const platformNames: Record<keyof DashboardContentMetrics['byPlatform'], string> = {
  linkedin: 'LinkedIn',
  reddit: 'Reddit',
  threads: 'Threads',
  x: 'X (Twitter)',
};

const platformCode: Record<keyof DashboardContentMetrics['byPlatform'], string> = {
  linkedin: 'LI',
  reddit: 'RD',
  threads: 'TH',
  x: 'X',
};

export function DashboardContentPipeline({
  content,
  timeZone,
}: DashboardContentPipelineProps) {
  const platforms = Object.keys(platformNames) as Array<keyof DashboardContentMetrics['byPlatform']>;
  const totalPlatformScheduled = platforms.reduce(
    (sum, platform) => sum + content.byPlatform[platform],
    0
  );

  return (
    <section
      className="surface-card overflow-hidden min-w-0"
      aria-labelledby="content-pipeline-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/45">
        <div className="flex items-center gap-2 min-w-0">
          <ZahiDiamondMark size="xs" tone="accent" />
          <h2 id="content-pipeline-heading" className="heading-section text-[13px]">
            Content Pipeline &amp; Scheduling
          </h2>
        </div>
        <Link
          href="/content"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
        >
          <span>Open content</span>
          <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
        </Link>
      </div>

      {/* Compact Stage Summary (Direct queue deep links) */}
      <div className="grid grid-cols-3 divide-x divide-[var(--border-subtle)] border-b border-[var(--border-subtle)]">
        <Link
          href="/content?tab=drafts"
          className="group px-3.5 py-2.5 hover:bg-[var(--bg-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] transition-colors min-w-0"
        >
          <div className="flex items-center justify-between gap-1">
            <p className="text-[11px] font-medium text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] truncate">
              Drafts
            </p>
            <ArrowUpRight className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" aria-hidden="true" />
          </div>
          <p className="mt-1 text-base font-semibold font-mono tabular-nums text-[var(--text-primary)] leading-none">
            {content.draftCount}
          </p>
        </Link>
        <Link
          href="/content?tab=ideas"
          className="group px-3.5 py-2.5 hover:bg-[var(--bg-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] transition-colors min-w-0"
        >
          <div className="flex items-center justify-between gap-1">
            <p className="text-[11px] font-medium text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] truncate">
              Ideas
            </p>
            <ArrowUpRight className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" aria-hidden="true" />
          </div>
          <p className="mt-1 text-base font-semibold font-mono tabular-nums text-[var(--text-primary)] leading-none">
            {content.ideaCount}
          </p>
        </Link>
        <Link
          href="/content?tab=scheduled"
          className="group px-3.5 py-2.5 hover:bg-[var(--bg-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] transition-colors min-w-0"
        >
          <div className="flex items-center justify-between gap-1">
            <p className="text-[11px] font-medium text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] truncate">
              Next 24h
            </p>
            <ArrowUpRight className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" aria-hidden="true" />
          </div>
          <p className="mt-1 text-base font-semibold font-mono tabular-nums text-[var(--text-primary)] leading-none">
            {content.scheduledNext24HoursCount}
          </p>
        </Link>
      </div>

      {/* Channel Distribution */}
      <div className="px-3.5 py-3 border-b border-[var(--border-subtle)] space-y-1.5 min-w-0">
        <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] pb-0.5">
          <span>Scheduled by Platform</span>
          <span>Queued</span>
        </div>
        <div className="-mx-1.5 space-y-0.5">
          {platforms.map((platform) => {
            const count = content.byPlatform[platform];
            const barWidthPercent =
              count > 0 && totalPlatformScheduled > 0
                ? Math.max(12, Math.round((count / totalPlatformScheduled) * 100))
                : 0;

            return (
              <Link
                key={platform}
                href={`/content?tab=scheduled&platform=${platform}`}
                className="group flex items-center justify-between gap-3 px-1.5 py-1 rounded-[var(--radius-sm)] text-xs hover:bg-[var(--bg-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] transition-colors min-w-0"
              >
                <span className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors truncate min-w-[90px]">
                  {platformNames[platform]}
                </span>
                <div className="flex items-center gap-2.5 flex-1 justify-end min-w-0">
                  <div
                    aria-hidden="true"
                    className="h-1 w-16 sm:w-20 rounded-full bg-[var(--bg-surface-muted)] overflow-hidden shrink-0"
                  >
                    {barWidthPercent > 0 && (
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${barWidthPercent}%` }}
                      />
                    )}
                  </div>
                  <span className="w-5 text-right font-semibold tabular-nums font-mono text-[var(--text-primary)] shrink-0">
                    {count}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Upcoming Chronological Schedule */}
      <div className="min-w-0">
        <div className="bg-[var(--bg-surface-muted)]/30 px-3.5 py-1.5 border-b border-[var(--border-subtle)] flex items-center justify-between text-[10.5px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
          <span>Upcoming Posts</span>
          <Link
            href="/calendar"
            className="hover:text-[var(--text-primary)] transition-colors"
          >
            Calendar →
          </Link>
        </div>

        {content.upcomingItems.length === 0 ? (
          <div className="px-3.5 py-5 text-center space-y-1.5">
            <p className="text-xs font-medium text-[var(--text-primary)]">
              No content currently scheduled
            </p>
            <p className="text-[11.5px] text-[var(--text-muted)]">
              Queue a draft on X, LinkedIn, Threads, or Reddit to populate your publishing timeline.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {content.upcomingItems.slice(0, 4).map((item) => (
              <Link
                key={item.id}
                href={`/content?tab=scheduled&contentId=${encodeURIComponent(item.id)}`}
                className="group flex items-center justify-between gap-2.5 px-3.5 py-2 transition-colors hover:bg-[var(--bg-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] min-w-0"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="inline-flex shrink-0 items-center justify-center min-w-[24px] rounded-[4px] border badge-neutral px-1 py-0.5 text-[10px] font-mono font-semibold leading-none">
                    {platformCode[item.platform]}
                  </span>
                  <p className="text-xs font-medium text-[var(--text-primary)] truncate min-w-0">
                    {item.title}
                  </p>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] shrink-0 whitespace-nowrap">
                  {item.scheduled_at
                    ? formatInTimeZone(item.scheduled_at, timeZone, {
                        year: undefined,
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Scheduled'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
