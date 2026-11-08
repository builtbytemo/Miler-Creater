import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { DashboardContentMetrics } from '@/lib/services/dashboard-service';
import { formatInTimeZone } from '@/lib/temporal/timezone';
import type { SocialPlatform } from '@/types/database';

interface DashboardContentPipelineProps {
  content: DashboardContentMetrics;
  timeZone: string;
}

export function DashboardContentPipeline({
  content,
  timeZone,
}: DashboardContentPipelineProps) {
  const platformNames: Record<SocialPlatform, string> = {
    linkedin: 'LinkedIn',
    reddit: 'Reddit',
    threads: 'Threads',
    x: 'X (Twitter)',
  };

  const platforms: SocialPlatform[] = ['linkedin', 'reddit', 'threads', 'x'];

  return (
    <section className="space-y-6 min-w-0" aria-labelledby="content-pipeline-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
        <h3 id="content-pipeline-heading" className="heading-section text-lg">
          Content Pipeline &amp; Scheduling
        </h3>
        <Link
          href="/content"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
        >
          <span>View all content</span>
          <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>

      {/* Upcoming Scheduled Posts */}
      <div className="space-y-3 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
          <span className="font-medium text-[var(--text-secondary)]">Upcoming Scheduled Posts</span>
          <span className="font-mono shrink-0">Next {content.upcomingItems.length} items</span>
        </div>

        {content.upcomingItems.length === 0 ? (
          <div className="py-8 px-5 text-center space-y-2 border border-dashed border-[var(--border-subtle)] rounded-2xl">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              No content currently scheduled
            </p>
            <p className="text-xs text-[var(--text-muted)] max-w-xs mx-auto leading-relaxed">
              Create new drafts or schedule posts for publishing across social platforms.
            </p>
            <div className="pt-1">
              <Link
                href="/content"
                className="btn-accent px-4 py-1.5 text-xs"
              >
                <span>Go to Content Studio</span>
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="surface-card divide-y divide-[var(--border-subtle)] overflow-hidden">
            {content.upcomingItems.map((item) => (
              <Link
                key={item.id}
                href="/content"
                className="group block px-4 py-3.5 transition-colors hover:bg-[var(--bg-surface-hover)] space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2.5 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] group-hover:underline line-clamp-2 break-words min-w-0 flex-1">
                    {item.title || 'Untitled Post'}
                  </p>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[var(--text-muted)] opacity-50 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[var(--text-primary)] group-hover:opacity-100"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] capitalize shrink-0">
                    {item.platform}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)] font-mono shrink-0">
                    {item.scheduled_at
                      ? formatInTimeZone(item.scheduled_at, timeZone, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'Unscheduled'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Editorial Pipeline Breakdown & Platform Ledger (No Box-Inside-Box Clutter) */}
      <div className="pt-2 space-y-5 min-w-0">
        <div className="grid grid-cols-3 gap-3 border-y border-[var(--border-subtle)] py-4">
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-muted)] truncate">Drafts</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-[var(--text-primary)]">
              {content.draftCount}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-muted)] truncate">Ideas</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-[var(--text-primary)]">
              {content.ideaCount}
            </p>
          </div>
          <div className="min-w-0">
            <p
              className="text-xs text-[var(--text-muted)] truncate"
              title="Scheduled in next 7 days"
            >
              7-Day Sched
            </p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-[var(--text-primary)]">
              {content.scheduledNext7DaysCount}
            </p>
          </div>
        </div>

        <div className="space-y-2 min-w-0">
          <p className="text-xs font-medium text-[var(--text-secondary)]">
            Scheduled by Platform
          </p>
          <div className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
            {platforms.map((platform) => (
              <div
                key={platform}
                className="flex items-center justify-between gap-2 py-2 text-xs min-w-0"
              >
                <span className="text-[var(--text-secondary)] truncate">
                  {platformNames[platform]}
                </span>
                <span className="font-semibold tabular-nums font-mono text-[var(--text-primary)] shrink-0">
                  {content.byPlatform[platform]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
