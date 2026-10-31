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
  Clock,
  CheckSquare,
  AlertTriangle,
  FileText,
  Calendar,
  Bell,
  Plus,
  Layers,
  LogOut,
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
      // Resolve authorized workspace for authenticated user
      const { workspaceId, error: wsError } = await resolveAuthorizedWorkspace(supabase, user.id);

      if (wsError || !workspaceId) {
        return (
          <div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col font-sans">
            <AppNavigation />
            <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8">
              <div className="p-8 rounded-xl bg-neutral-950 border border-neutral-800 text-center space-y-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center mx-auto">
                  <Layers className="w-5 h-5" />
                </div>
                <h2 className="text-base font-semibold text-neutral-200">No Active Workspace Found</h2>
                <p className="text-xs text-neutral-400 max-w-md mx-auto">
                  You do not currently belong to an active workspace. Please create or join a workspace to view your command center metrics.
                </p>
              </div>
            </main>
          </div>
        );
      }

      // Fetch user profile and workspace metadata in parallel
      const [
        { data: profileData },
        { data: wsData },
        { data: memberData },
      ] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('workspaces').select('id, name, slug').eq('id', workspaceId).maybeSingle(),
        supabase.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle(),
      ]);

      if (profileData) profile = profileData;
      if (wsData) workspace = wsData;
      if (memberData) role = memberData.role;

      // Execute dashboard data aggregation service
      try {
        summary = await getDashboardSummary(supabase, workspaceId, user.id);
      } catch (err) {
        serviceError = err instanceof Error ? err.message : 'Failed to load dashboard metrics';
      }
    }
  }

  // Generate dynamic operational summary text
  const getAttentionSummaryText = () => {
    if (!summary) return 'Loading workspace activity...';
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
    <div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col font-sans">
      {/* Top Application Header */}
      <header className="border-b border-neutral-800 bg-neutral-950 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm tracking-tight shadow-sm">
            CC
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-neutral-100">Command Center</h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                Active
              </span>
            </div>
            <p className="text-xs text-neutral-400">Content & Task Command Center</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs font-medium text-neutral-200">
                  {profile?.full_name || user.email}
                </p>
                <p className="text-[10px] text-neutral-400 font-mono">
                  {role ? `Role: ${role}` : user.email}
                </p>
              </div>
              <form action={signOutAction}>
                <button
                  type="submit"
                  title="Sign out"
                  className="p-2 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </form>
            </div>
          ) : (
            <Link
              href="/auth/sign-in"
              className="text-xs px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </header>

      <AppNavigation />

      {/* Main Operational Dashboard Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-8">
        {/* Workspace Identity & Quick Actions Bar */}
        <div className="p-6 rounded-xl bg-neutral-950 border border-neutral-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-mono text-neutral-400">
              <Layers className="w-3.5 h-3.5 text-blue-500" />
              <span>Workspace: {workspace?.name || 'Personal Workspace'}</span>
            </div>
            <h2 className="text-xl font-semibold text-neutral-100">
              Operational Command Center
            </h2>
            <p className="text-xs text-neutral-400 max-w-2xl">
              {getAttentionSummaryText()}
            </p>
          </div>

          {/* Quick Action Shortcuts */}
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/tasks"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors shadow-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Task</span>
            </Link>
            <Link
              href="/content"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium border border-neutral-700 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Content</span>
            </Link>
            <Link
              href="/calendar"
              title="Open Unified Planning Calendar"
              className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 border border-neutral-700 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            >
              <Calendar className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Database Error Banner (if query failed) */}
        {serviceError && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold">Failed to load workspace metrics</p>
              <p className="text-xs text-rose-400/80 mt-0.5">{serviceError}</p>
            </div>
          </div>
        )}

        {summary && (
          <>
            {/* KPI Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
              <DashboardKpiCard
                title="Overdue Tasks"
                count={summary.tasks.overdueCount}
                href="/tasks"
                icon={AlertCircle}
                variant="danger"
              />
              <DashboardKpiCard
                title="Due Today"
                count={summary.tasks.dueTodayCount}
                href="/tasks"
                icon={Clock}
                variant="warning"
              />
              <DashboardKpiCard
                title="Pending Subtasks"
                count={summary.tasks.pendingSubtasksCount}
                href="/tasks"
                icon={CheckSquare}
                variant="info"
              />
              <DashboardKpiCard
                title="Blocked Tasks"
                count={summary.tasks.blockedCount}
                href="/tasks?status=blocked"
                icon={AlertTriangle}
                variant="warning"
              />
              <DashboardKpiCard
                title="Draft Content"
                count={summary.content.draftCount}
                href="/content"
                icon={FileText}
                variant="default"
              />
              <DashboardKpiCard
                title="Scheduled (7d)"
                count={summary.content.scheduledNext7DaysCount}
                href="/calendar"
                icon={Calendar}
                variant="success"
              />
              <DashboardKpiCard
                title="Unread Alerts"
                count={summary.notifications.unreadCount}
                href="/notifications"
                icon={Bell}
                variant="info"
              />
            </div>

            {/* Action Needed (Urgent Queue) */}
            <DashboardActionNeeded
              urgentTasks={summary.tasks.urgentTasks}
              upcomingContent={summary.content.upcomingItems}
              timeZone={summary.timeZone}
              referenceTimeIso={summary.referenceTime}
            />

            {/* Content Pipeline & Platform Distribution */}
            <DashboardContentPipeline
              content={summary.content}
              timeZone={summary.timeZone}
            />

            {/* Recent Unread Notifications Feed */}
            <DashboardRecentNotifications
              notifications={summary.notifications}
              timeZone={summary.timeZone}
            />
          </>
        )}
      </main>
    </div>
  );
}
