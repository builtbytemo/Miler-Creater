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
import { ZahiMascot } from '@/components/brand/ZahiBrand';
import type { Database, WorkspaceRole } from '@/types/database';
import {
  AlertCircle,
  Calendar,
  LogOut,
  ArrowUpRight,
  SlidersHorizontal,
  KeyRound,
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
              className="flex-1 min-w-0 max-w-4xl w-full mx-auto px-6 py-12 sm:px-10 flex items-center justify-center"
            >
              <div className="surface-card max-w-md w-full p-7 sm:p-9 text-center space-y-4">
                <div className="flex justify-center">
                  <ZahiMascot size={48} />
                </div>
                <div className="space-y-1.5">
                  <h2 className="heading-section text-base">
                    No Active Workspace Found
                  </h2>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    You do not currently belong to an active workspace. Please create or join a workspace to view your command center metrics.
                  </p>
                </div>
                <div className="pt-1">
                  <Link href="/tasks" className="btn-accent h-8 px-4 text-xs">
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
            title: 'Audit API token authentication security & expiration logs',
            priority: 'high',
            status: 'todo',
            due_date: '2026-11-08T17:00:00.000Z',
            project_id: null,
          },
        ],
      },
      content: {
        draftCount: 4,
        ideaCount: 7,
        scheduledNext7DaysCount: 5,
        scheduledNext24HoursCount: 2,
        byPlatform: {
          linkedin: 2,
          reddit: 1,
          threads: 1,
          x: 1,
        },
        upcomingItems: [
          {
            id: 'preview-content-1',
            title: 'How we redesigned our content & task workflows for zero distraction',
            platform: 'x',
            action_type: 'post',
            status: 'scheduled',
            scheduled_at: '2026-11-08T15:30:00.000Z',
          },
          {
            id: 'preview-content-2',
            title: 'Building Multi-Tenant Workspace Operations with PostgreSQL RLS',
            platform: 'linkedin',
            action_type: 'post',
            status: 'scheduled',
            scheduled_at: '2026-11-09T10:00:00.000Z',
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

  const displayName = profile?.full_name || user?.email || 'Local Workspace Preview';
  const attentionParts: string[] = [];
  if (summary) {
    if (summary.tasks.overdueCount > 0) {
      attentionParts.push(
        `${summary.tasks.overdueCount} overdue task${summary.tasks.overdueCount === 1 ? '' : 's'}`
      );
    }
    if (summary.tasks.dueTodayCount > 0) {
      attentionParts.push(
        `${summary.tasks.dueTodayCount} task${summary.tasks.dueTodayCount === 1 ? '' : 's'} due today`
      );
    }
    if (summary.content.scheduledNext24HoursCount > 0) {
      attentionParts.push(
        `${summary.content.scheduledNext24HoursCount} post${summary.content.scheduledNext24HoursCount === 1 ? '' : 's'} scheduled within 24h`
      );
    }
  }

  return (
    <div
      data-workspace-shell="v2"
      className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex flex-col md:flex-row font-sans"
    >
      <AppNavigation />

      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 min-w-0 max-w-[1440px] w-full px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6 space-y-5"
      >
        {/* Compact Command Header */}
        <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 pb-4 border-b border-[var(--border-subtle)] min-w-0">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text-secondary)]">
                Workspace: {workspace?.name ?? 'Local Preview'}
              </span>
              <span aria-hidden="true">/</span>
              <span>{displayName}</span>
              <span aria-hidden="true">/</span>
              <span className="capitalize">Role: {role ?? 'owner'}</span>
            </div>

            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="heading-display text-[20px] sm:text-[22px]">
                Your workspace, at a glance
              </h1>
              {summary && (
                <p
                  className={
                    attentionParts.length > 0
                      ? 'text-xs font-medium text-[var(--status-warning-text)]'
                      : 'text-xs text-[var(--text-secondary)]'
                  }
                >
                  {attentionParts.length > 0
                    ? `Attention required: ${attentionParts.join(', ')}.`
                    : 'Workspace active. All tasks and content schedules are on track.'}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <Link href="/tasks" className="btn-accent h-8 px-3 text-xs">
              <span>View tasks</span>
              <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
            <Link href="/content" className="btn-secondary h-8 px-2.5 text-xs">
              <span>View content</span>
            </Link>
            <Link href="/calendar" className="btn-secondary h-8 px-2.5 text-xs">
              <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Calendar</span>
            </Link>

            {isEnvConfigured && user && (
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="btn-secondary h-8 px-2.5 text-xs text-[var(--text-secondary)]"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Sign out</span>
                </button>
              </form>
            )}
          </div>
        </header>

        {/* Service Error State */}
        {serviceError && (
          <div
            role="alert"
            className="p-3.5 rounded-[var(--radius-md)] badge-danger border flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold">Failed to load workspace metrics</p>
              <p className="text-xs opacity-90 mt-0.5">{serviceError}</p>
            </div>
          </div>
        )}

        {summary && (
          <>
            {/* Unified Segmented Telemetry Ledger (seamless 1px grid across all breakpoints) */}
            <section aria-label="Workspace pulse" className="min-w-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-px rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--border-subtle)] overflow-hidden">
                <DashboardKpiCard
                  title="Overdue Tasks"
                  count={summary.tasks.overdueCount}
                  href="/tasks"
                  variant="danger"
                  tier="compact"
                />
                <DashboardKpiCard
                  title="Due Today"
                  count={summary.tasks.dueTodayCount}
                  href="/tasks"
                  variant="warning"
                  tier="compact"
                />
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
                <DashboardKpiCard
                  title="Scheduled (7d)"
                  count={summary.content.scheduledNext7DaysCount}
                  href="/calendar"
                  variant="success"
                  tier="compact"
                />
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
                  className="col-span-2 sm:col-span-2 xl:col-span-1"
                />
              </div>
            </section>

            {/* Asymmetric Operational Body */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start min-w-0">
              {/* Primary Execution Stream */}
              <div className="lg:col-span-7 space-y-5 min-w-0">
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

              {/* Right Operational Rail */}
              <div className="lg:col-span-5 space-y-5 min-w-0">
                <DashboardContentPipeline
                  content={summary.content}
                  timeZone={summary.timeZone}
                />

                {/* Workspace Tools & CLI Directory */}
                <section
                  aria-label="Workspace automation and CLI"
                  className="surface-card overflow-hidden min-w-0"
                >
                  <div className="px-3.5 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/45 text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                    Automation &amp; CLI
                  </div>
                  <div className="divide-y divide-[var(--border-subtle)]">
                    <Link
                      href="/settings/notifications"
                      className="group flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-[var(--bg-surface-hover)] transition-colors"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <SlidersHorizontal
                          className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--text-primary)]"
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-[var(--text-primary)] truncate">
                            Daily Briefing &amp; Alerts
                          </span>
                          <span className="block text-[11px] text-[var(--text-muted)] truncate">
                            Delivery window ({summary.timeZone})
                          </span>
                        </span>
                      </span>
                      <ArrowUpRight
                        className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-hidden="true"
                      />
                    </Link>

                    <Link
                      href="/settings/tokens"
                      className="group flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-[var(--bg-surface-hover)] transition-colors"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <KeyRound
                          className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--text-primary)]"
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-[var(--text-primary)] truncate">
                            CLI &amp; AI Agent Tokens
                          </span>
                          <span className="block text-[11px] font-mono text-[var(--text-muted)] truncate">
                            miler login · MCP access
                          </span>
                        </span>
                      </span>
                      <ArrowUpRight
                        className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-hidden="true"
                      />
                    </Link>
                  </div>
                </section>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
