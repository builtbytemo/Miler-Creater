import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getContentItems,
  getSocialAccounts,
} from '@/lib/services/content-service';
import { getTasks } from '@/lib/services/task-service';
import { getWeekRange, getMonthGrid } from '@/lib/temporal/calendar';
import { DEFAULT_TIMEZONE, isValidTimeZone, normalizeTimeZone } from '@/lib/temporal/timezone';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { CalendarWorkspace } from '@/components/calendar/CalendarWorkspace';

export const instant = false;

export default async function CalendarPage() {
  await connection();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const isEnvConfigured = supabaseUrl && !supabaseUrl.includes('your-project-ref');

  if (!isEnvConfigured) {
    return (
      <WorkspaceShell maxWidth="6xl" mainClassName="space-y-6">
        <div className="surface-card p-6 sm:p-8 badge-warning border space-y-1.5">
          <h2 className="heading-section text-base">Configuration Required</h2>
          <p className="text-xs sm:text-sm opacity-90">
            Please configure your live Supabase credentials in .env.local to access the editorial calendar.
          </p>
        </div>
      </WorkspaceShell>
    );
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    redirect('/auth/sign-in?redirectTo=/calendar');
  }

  // Resolve user profile and authorized workspace membership in parallel
  const [profileResult, memberResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('timezone')
      .eq('id', authData.user.id)
      .maybeSingle(),
    supabase
      .from('workspace_members')
      .select('workspace_id, workspaces (id, name, slug)')
      .eq('user_id', authData.user.id)
      .limit(1)
      .maybeSingle(),
  ]);

  const profile = profileResult.data;
  const memberData = memberResult.data;

  const rawTz = profile?.timezone;
  const userTimeZone =
    rawTz && isValidTimeZone(rawTz)
      ? normalizeTimeZone(rawTz)
      : DEFAULT_TIMEZONE;

  if (!memberData) {
    return (
      <WorkspaceShell maxWidth="6xl">
        <div className="surface-card p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">No workspace membership found.</p>
        </div>
      </WorkspaceShell>
    );
  }

  const workspace = (
    memberData as unknown as { workspaces: { id: string; name: string; slug: string } }
  ).workspaces;

  // Calculate current week and month grid boundaries in the user's timezone
  const now = new Date();
  const currentWeek = getWeekRange(now, userTimeZone);
  const currentMonthGrid = getMonthGrid(now, userTimeZone);
  const firstCell = currentMonthGrid.cells[0];
  const lastCell = currentMonthGrid.cells[currentMonthGrid.cells.length - 1];
  const scheduledFromIso = firstCell.startOfDay.toISOString();
  const scheduledToIso = lastCell.endOfDay.toISOString();

  // Parallel server-side fetch: active projects, social accounts, scheduled items across full month grid, unscheduled backlog, and scheduled tasks
  const [projectsResult, socialAccounts, scheduledItems, unscheduledItems, scheduledTasks] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, color')
      .eq('workspace_id', workspace.id)
      .eq('status', 'active'),
    getSocialAccounts(supabase, workspace.id),
    getContentItems(supabase, workspace.id, {
      scheduled_from: scheduledFromIso,
      scheduled_to: scheduledToIso,
    }),
    getContentItems(supabase, workspace.id, {
      is_scheduled: false,
    }),
    getTasks(supabase, workspace.id, {
      scheduled_from: scheduledFromIso,
      scheduled_to: scheduledToIso,
      parent_task_id: null,
    }),
  ]);

  const projects = projectsResult.data || [];

  return (
    <WorkspaceShell workspaceName={workspace.name} maxWidth="wide" mainClassName="space-y-6">
      <CalendarWorkspace
          initialScheduledItems={scheduledItems}
          initialScheduledTasks={scheduledTasks}
          initialUnscheduledItems={unscheduledItems}
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          socialAccounts={socialAccounts}
          projects={projects}
          userTimeZone={userTimeZone}
          initialWeekRange={currentWeek}
          initialLoadedRange={{ startIso: scheduledFromIso, endIso: scheduledToIso }}
        />
    </WorkspaceShell>
  );
}
