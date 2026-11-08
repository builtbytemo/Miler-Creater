import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { resolveAuthorizedWorkspace } from '@/lib/auth/workspace';
import { getDashboardSummary, type DashboardSummary } from '@/lib/services/dashboard-service';
import { signOutAction } from '@/lib/auth/actions';
import { AppNavigation } from '@/components/layout/AppNavigation';
import { DashboardKpiCard } from '@/components/dashboard/DashboardKpiCard';
import { DashboardActionNeeded } from '@/components/dashboard/DashboardActionNeeded';
import { DashboardContentPipeline } from '@/components/dashboard/DashboardContentPipeline';
import { DashboardRecentNotifications } from '@/components/dashboard/DashboardRecentNotifications';
import type { Database, WorkspaceRole } from '@/types/database';
import {
  AlertCircle,
  Calendar,
  LogOut,
  ArrowUpRight,
} from 'lucide-react';

export const instant = false;

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
}

export default async function DashboardPage() {
  await connection();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const isEnvConfigured = supabaseUrl && !supabaseUrl.includes('your-project-ref');

  let user = null;
  let profile: ProfileRow | null = null;
  let workspace: WorkspaceInfo | null = null;
  let role: WorkspaceRole | null = null;
  let summary: DashboardSummary | null = null;
  let serviceError: string | null = null;

  if (isEnvConfigured) {
    let supabase = null;
    try {
      supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      user = data.user;
    } catch {
      // Graceful fallback if database connection fails
    }

    if (!user) {
      redirect('/auth/sign-in?redirectTo=/dashboard');
    }

    if (supabase) {
      const { workspaceId, error: wsError } = await resolveAuthorizedWorkspace(supabase, user.id);

      if (wsError || !workspaceId) {
        return (
          <div
            data-workspace-shell="v2"
            className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex flex-col md:flex-row font-sans"
          >
            <AppNavigation />
            <main
              id="main-content"
              tabIndex={-1}
              className="flex-1 min-w-0 max-w-5xl w-full mx-auto px-6 py-12 sm:px-10 flex items-center justify-center"
            >
              <div className="surface-card max-w-md w-full p-8 sm:p-10 text-center space-y-3">
                <h2 className="heading-section text-xl">
                  No Active Workspace Found
                </h2>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  You do not currently belong to an active workspace. Please create or join a workspace to view your command center metrics.
                </p>
                <div className="pt-2">
                  <Link href="/tasks" className="btn-accent px-5 py-2 text-xs">
                    <span>Explore Tasks</span>
                    <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </main>
          </div>
        );
      }

      const [
        { data: profileData },
        { data: wsData },
        { data: memberData },
      ] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('workspaces').select('id, name, slug').eq('id', workspaceId).maybeSingle(),
        supabase
          .from('workspace_members')
          .select('role')
          .eq('workspace_id', workspaceId)
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);

      if (profileData) profile = profileData;
      if (wsData) workspace = wsData;
      if (memberData) role = memberData.role;

      try {
        summary = await getDashboardSummary(supabase, workspaceId, user.id);
      } catch (err) {
        serviceError = err instanceof Error ? err.message : 'Failed to load dashboard metrics';
      }
    }
  } else {
    summary = {
      workspaceId: 'local-preview',
      userId: 'local-user',
      referenceTime: '2026-11-08T12:00:00.000Z',
      timeZone: 'UTC',
      tasks: {
        overdueCount: 2,
        dueTodayCount: 3,
        pendingSubtasksCount: 5,
        blockedCount: 1,
        urgentTasks: [
          {
            id: 'preview-task-1',
            title: 'Finalize Q4 product launch narrative & creator brief',
            priority: 'urgent',
            status: 'in_progress',
            due_date: '2026-11-08T07:00:00.000Z',
            project_id: null,
          },
          {
            id: 'preview-task-2',
            title: 'Review social scheduling pipeline for weekly release',
            priority: 'high',
            status: 'todo',
            due_date: '2026-11-08T16:00:00.000Z',
            project_id: null,
          },
        ],
      },
      content: {
        draftCount: 6,
        ideaCount: 9,
        scheduledNext7DaysCount: 7,
        scheduledNext24HoursCount: 2,
        byPlatform: {
          linkedin: 3,
          reddit: 1,
          threads: 1,
          x: 2,
        },
        upcomingItems: [
          {
            id: 'preview-content-1',
            title: 'Design systems that feel effortless in daily work',
            platform: 'linkedin',
            action_type: 'post',
            status: 'scheduled',
            scheduled_at: '2026-11-08T18:00:00.000Z',
          },
          {
            id: 'preview-content-2',
            title: 'Behind the scenes: unified task & editorial workflows',
            platform: 'x',
            action_type: 'post',
            status: 'scheduled',
            scheduled_at: '2026-11-09T06:00:00.000Z',
          },
        ],
      },
      notifications: {
        unreadCount: 2,
        recentUnread: [
          {
            id: 'preview-notif-1',
            recipient_id: 'local-user',
            workspace_id: 'local-preview',
            title: 'Launch brief task is due soon',
            message: 'Finalize Q4 product launch narrative & creator brief is scheduled for today.',
            entity_type: 'task',
            entity_id: 'preview-task-1',
            channel: 'in_app',
            status: 'delivered',
            scheduled_for: '2026-11-08T10:00:00.000Z',
            delivered_at: '2026-11-08T10:00:05.000Z',
            read_at: null,
            idempotency_key: null,
            created_at: '2026-11-08T10:00:00.000Z',
          },
        ],
      },
    };
  }

  const getAttentionSummaryText = () => {
    if (!summary) return 'Workspace activity is unavailable right now. Try refreshing the page.';
    const overdue = summary.tasks.overdueCount;
    const dueToday = summary.tasks.dueTodayCount;
    const sched24h = summary.content.scheduledNext24HoursCount;

    const parts: string[] = [];
    if (overdue > 0) parts.push(`${overdue} overdue task${overdue === 1 ? '' : 's'}`);
    if (dueToday > 0) parts.push(`${dueToday} task${dueToday === 1 ? '' : 's'} due today`);
    if (sched24h > 0) parts.push(`${sched24h} post${sched24h === 1 ? '' : 's'} scheduled within 24h`);

    if (parts.length > 0) {
      return `Attention required: ${parts.join(', ')}.`;
    }
    return 'Workspace active. All tasks and content schedules are on track.';
  };

  return (
    <div
      data-workspace-shell="v2"
      className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex flex-col md:flex-row font-sans"
    >
      <AppNavigation />

      {/* Main Operational Dashboard Content */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 min-w-0 max-w-6xl w-full mx-auto px-5 py-7 sm:px-8 sm:py-10 lg:px-12 lg:py-12 space-y-10"
      >
        {/* Open Editorial Masthead (Directly on the Canvas) */}
        <header className="space-y-6 border-b border-[var(--border-subtle)] pb-8 min-w-0">
          {/* Quiet Top Meta Row */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-[var(--text-muted)] min-w-0">
            <div className="flex items-center gap-2 font-mono min-w-0 max-w-full">
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent)] ring-1 ring-[var(--accent-border)]"
                aria-hidden="true"
              />
              <span
                className="truncate max-w-[220px] sm:max-w-[340px] md:max-w-[440px]"
                title={workspace?.name || 'Personal Workspace'}
              >
                Workspace: {workspace?.name || 'Personal Workspace'}
              </span>
              <span className="shrink-0 text-[var(--border-strong)]">·</span>
              <span className="shrink-0 text-[var(--text-secondary)]">Active</span>
            </div>

            <div className="min-w-0 max-w-full">
              {user ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                  <span
                    className="text-[var(--text-secondary)] font-medium truncate max-w-[180px] sm:max-w-[240px]"
                    title={profile?.full_name || user.email || undefined}
                  >
                    {profile?.full_name || user.email}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--text-muted)] shrink-0">
                    {role ? `Role: ${role}` : user.email}
                  </span>
                  <form action={signOutAction} className="shrink-0">
                    <button
                      type="submit"
                      title="Sign out"
                      aria-label="Sign out"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </form>
                </div>
              ) : (
                <Link
                  href="/auth/sign-in"
                  className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Sign In
                </Link>
              )}
            </div>
          </div>

          {/* Confident Heading + Intentional Pill Actions */}
          <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-5 pt-1 min-w-0">
            <div className="space-y-2.5 max-w-2xl min-w-0">
              <h1 className="heading-display text-3xl sm:text-4xl lg:text-[42px] break-words">
                Your workspace, at a glance
              </h1>
              <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed break-words">
                {getAttentionSummaryText()}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Link
                href="/calendar"
                title="Open Unified Planning Calendar"
                aria-label="Open Unified Planning Calendar"
                className="btn-secondary px-3.5 py-2 text-xs sm:text-[13px] whitespace-nowrap"
              >
                <Calendar className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                <span>Calendar</span>
              </Link>
              <Link
                href="/content"
                className="btn-secondary px-4 py-2 text-xs sm:text-[13px] whitespace-nowrap"
              >
                <span>View content</span>
              </Link>
              <Link
                href="/tasks"
                className="btn-accent px-4.5 py-2 text-xs sm:text-[13px] whitespace-nowrap"
              >
                <span>View tasks</span>
                <ArrowUpRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </header>

        {/* Database Error Banner (if query failed) */}
        {serviceError && (
          <div
            role="alert"
            className="p-5 rounded-2xl badge-danger border flex items-start gap-3.5"
          >
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold">Failed to load workspace metrics</p>
              <p className="text-xs opacity-90 mt-1">{serviceError}</p>
            </div>
          </div>
        )}

        {summary && (
          <>
            {/* Thoughtful Pulse Composition: Grouped by Priority Rather Than 7 Identical Boxes */}
            <section aria-label="Workspace pulse" className="min-w-0">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Primary Focus Card: Today's Execution (7 cols) */}
                <div className="lg:col-span-7 surface-card p-5 sm:p-7 flex flex-col justify-between min-w-0">
                  <div className="grid grid-cols-2 gap-4 sm:gap-6 min-w-0">
                    <DashboardKpiCard
                      title="Due Today"
                      count={summary.tasks.dueTodayCount}
                      href="/tasks"
                      variant="warning"
                      tier="hero"
                      subtitle="tasks"
                    />
                    <DashboardKpiCard
                      title="Overdue Tasks"
                      count={summary.tasks.overdueCount}
                      href="/tasks"
                      variant="danger"
                      tier="hero"
                      subtitle="urgent"
                    />
                  </div>

                  <div className="mt-6 pt-4 border-t border-[var(--border-subtle)] grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 min-w-0">
                    <DashboardKpiCard
                      title="Blocked Tasks"
                      count={summary.tasks.blockedCount}
                      href="/tasks?status=blocked"
                      variant="warning"
                      tier="compact"
                    />
                    <DashboardKpiCard
                      title="Pending Subtasks"
                      count={summary.tasks.pendingSubtasksCount}
                      href="/tasks"
                      variant="info"
                      tier="compact"
                    />
                  </div>
                </div>

                {/* Companion Card: Publishing & Inbox Pulse (5 cols) */}
                <div className="lg:col-span-5 surface-card p-5 sm:p-7 flex flex-col justify-between min-w-0">
                  <div className="min-w-0">
                    <DashboardKpiCard
                      title="Scheduled (7d)"
                      count={summary.content.scheduledNext7DaysCount}
                      href="/calendar"
                      variant="success"
                      tier="hero"
                      subtitle="upcoming posts"
                    />
                  </div>

                  <div className="mt-6 pt-4 border-t border-[var(--border-subtle)] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-x-5 gap-y-1 min-w-0">
                    <DashboardKpiCard
                      title="Draft Content"
                      count={summary.content.draftCount}
                      href="/content"
                      variant="default"
                      tier="compact"
                    />
                    <DashboardKpiCard
                      title="Unread Alerts"
                      count={summary.notifications.unreadCount}
                      href="/notifications"
                      variant="info"
                      tier="compact"
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* Two-Column Editorial Workspace Body */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 pt-2 items-start min-w-0">
              {/* Left Main Column (7 cols): Urgent Queue + Recent Unread Alerts */}
              <div className="lg:col-span-7 space-y-10 min-w-0">
                <DashboardActionNeeded
                  urgentTasks={summary.tasks.urgentTasks}
                  upcomingContent={summary.content.upcomingItems}
                  timeZone={summary.timeZone}
                  referenceTimeIso={summary.referenceTime}
                />

                <DashboardRecentNotifications
                  notifications={summary.notifications}
                  timeZone={summary.timeZone}
                />
              </div>

              {/* Right Column (5 cols): Content Pipeline & Platform Ledger */}
              <div className="lg:col-span-5 min-w-0">
                <DashboardContentPipeline
                  content={summary.content}
                  timeZone={summary.timeZone}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
