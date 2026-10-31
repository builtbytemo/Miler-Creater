import Link from 'next/link';
import {
  Share2,
  Calendar,
  Clock,
  ArrowRight,
  FileText,
  Lightbulb,
} from 'lucide-react';
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
    <section className="space-y-4" aria-labelledby="content-pipeline-heading">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center justify-center">
            <Share2 className="w-3.5 h-3.5" />
          </div>
          <h3 id="content-pipeline-heading" className="text-sm font-semibold text-neutral-100">
            Content Pipeline & Scheduling
          </h3>
        </div>
        <Link
          href="/content"
          className="text-xs text-neutral-400 hover:text-neutral-200 flex items-center gap-1 transition-colors"
        >
          <span>View all content</span>
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column: Platform Distribution & Status Counts */}
        <div className="space-y-3">
          <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
            <p className="text-xs font-semibold text-neutral-300">Scheduled by Platform</p>
            <div className="grid grid-cols-2 gap-2">
              {platforms.map((platform) => (
                <div
                  key={platform}
                  className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-850 flex items-center justify-between"
                >
                  <span className="text-xs text-neutral-400">
                    {platformNames[platform]}
                  </span>
                  <span className="text-xs font-bold text-neutral-200 font-mono">
                    {content.byPlatform[platform]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 flex items-center justify-around gap-2 text-center">
            <div className="space-y-0.5">
              <div className="flex items-center justify-center gap-1 text-[11px] text-neutral-400">
                <FileText className="w-3 h-3 text-emerald-400" />
                <span>Drafts</span>
              </div>
              <p className="text-lg font-bold text-neutral-100">{content.draftCount}</p>
            </div>
            <div className="w-px h-8 bg-neutral-800" />
            <div className="space-y-0.5">
              <div className="flex items-center justify-center gap-1 text-[11px] text-neutral-400">
                <Lightbulb className="w-3 h-3 text-amber-400" />
                <span>Ideas</span>
              </div>
              <p className="text-lg font-bold text-neutral-100">{content.ideaCount}</p>
            </div>
            <div className="w-px h-8 bg-neutral-800" />
            <div className="space-y-0.5">
              <div className="flex items-center justify-center gap-1 text-[11px] text-neutral-400">
                <Calendar className="w-3 h-3 text-purple-400" />
                <span>7-Day Sched</span>
              </div>
              <p className="text-lg font-bold text-neutral-100">{content.scheduledNext7DaysCount}</p>
            </div>
          </div>
        </div>

        {/* Right Column (Span 2): Upcoming Scheduled Posts */}
        <div className="lg:col-span-2 p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-neutral-300">Upcoming Scheduled Posts</p>
            <span className="text-[11px] text-neutral-500 font-mono">
              Next {content.upcomingItems.length} items
            </span>
          </div>

          {content.upcomingItems.length === 0 ? (
            <div className="p-6 text-center space-y-1.5 border border-dashed border-neutral-800 rounded-lg">
              <p className="text-xs text-neutral-400">No content currently scheduled</p>
              <p className="text-[11px] text-neutral-500">
                Create new drafts or schedule posts for publishing across social platforms.
              </p>
              <Link
                href="/content"
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-2 font-medium"
              >
                <span>Go to Content Studio</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {content.upcomingItems.map((item) => (
                <Link
                  key={item.id}
                  href="/content"
                  className="group p-2.5 rounded-lg bg-neutral-900 border border-neutral-850 hover:border-neutral-750 flex items-center justify-between gap-3 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-800 text-neutral-300 border border-neutral-700 capitalize shrink-0">
                      {item.platform}
                    </span>
                    <p className="text-xs text-neutral-200 group-hover:text-purple-300 truncate transition-colors">
                      {item.title || 'Untitled Post'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 font-mono shrink-0">
                    <Clock className="w-3 h-3 text-neutral-500" />
                    <span>
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
      </div>
    </section>
  );
}
