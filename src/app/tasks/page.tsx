import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getTasks } from '@/lib/services/task-service';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { TaskWorkspace } from '@/components/tasks/TaskWorkspace';
import { ZahiDiamondMark } from '@/components/brand/ZahiBrand';
import { DEFAULT_TIMEZONE, isValidTimeZone, normalizeTimeZone } from '@/lib/temporal/timezone';
import type { Database } from '@/types/database';

export const instant = false;

interface TasksPageProps {
  searchParams: Promise<{
    status?: string;
    statusFilter?: string;
    dateFilter?: string;
    priority?: string;
    project_id?: string;
    search?: string;
    taskId?: string;
  }>;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  await connection();
  const resolvedParams = await searchParams;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const isEnvConfigured = supabaseUrl && !supabaseUrl.includes('your-project-ref');

  if (!isEnvConfigured) {
    return (
      <WorkspaceShell maxWidth="6xl" mainClassName="space-y-6">
        <div className="surface-card p-6 sm:p-8 badge-warning border space-y-1.5">
          <h2 className="heading-section text-base">Configuration Required</h2>
          <p className="text-xs sm:text-sm opacity-90">
            Please configure your live Supabase credentials in .env.local to manage persisted tasks.
          </p>
        </div>
      </WorkspaceShell>
    );
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    redirect('/auth/sign-in?redirectTo=/tasks');
  }

  // Get active workspace
  const { data: memberData } = await supabase
    .from('workspace_members')
    .select('workspace_id, workspaces (id, name, slug)')
    .eq('user_id', authData.user.id)
    .limit(1)
    .maybeSingle();

  if (!memberData) {
    return (
      <WorkspaceShell maxWidth="6xl" mainClassName="flex items-center justify-center">
        <div className="surface-card max-w-md w-full p-8 text-center space-y-2">
          <h2 className="heading-section text-lg">No Active Workspace</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            No workspace membership found.
          </p>
        </div>
      </WorkspaceShell>
    );
  }

  const workspace = (memberData as unknown as { workspaces: { id: string; name: string; slug: string } }).workspaces;

  // Resolve profile timezone defensively (unit test mocks may omit profiles) alongside projects and tasks
  const profileTable = supabase.from('profiles') as unknown as {
    select?: (columns: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: { timezone?: string | null } | null }>;
      };
    };
  };

  const [projectsResult, profileResult, tasks] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, color')
      .eq('workspace_id', workspace.id)
      .eq('status', 'active'),
    typeof profileTable?.select === 'function'
      ? profileTable.select('timezone').eq('id', authData.user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    getTasks(supabase, workspace.id, {
      status: resolvedParams.status as Database['public']['Tables']['tasks']['Row']['status'],
      priority: resolvedParams.priority as Database['public']['Tables']['tasks']['Row']['priority'],
      project_id: resolvedParams.project_id,
      search: resolvedParams.search,
      parent_task_id: null, // Display top-level tasks on main list
    }),
  ]);

  const projects = projectsResult.data || [];
  const rawTz = profileResult.data?.timezone;
  const userTimeZone =
    rawTz && isValidTimeZone(rawTz) ? normalizeTimeZone(rawTz) : DEFAULT_TIMEZONE;

  // Calculate statistics
  const totalTasks = tasks.length;
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length;
  const blockedCount = tasks.filter((t) => t.is_blocked).length;
  const completedCount = tasks.filter((t) => t.status === 'done').length;

  return (
    <WorkspaceShell workspaceName={workspace.name} maxWidth="wide" mainClassName="space-y-5">
        {/* Quiet Top Meta Row */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-[var(--text-muted)] min-w-0">
          <div className="flex items-center gap-2 font-mono min-w-0 max-w-full">
            <ZahiDiamondMark size="xs" tone="accent" />
            <span
              className="truncate max-w-[220px] sm:max-w-[340px] md:max-w-[440px]"
              title={workspace.name}
            >
              Workspace: {workspace.name}
            </span>
            <span className="text-[var(--border-strong)]" aria-hidden="true">·</span>
            <span className="text-[11px] text-[var(--text-tertiary)] truncate" title="Active timezone">
              {userTimeZone}
            </span>
          </div>

          <div
            aria-label="Task summary counts"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-[var(--text-muted)]"
          >
            <span>
              <strong className="font-semibold text-[var(--text-primary)] tabular-nums">{totalTasks}</strong> total
            </span>
            <span className="text-[var(--border-strong)]" aria-hidden="true">·</span>
            <span>
              <strong className="font-semibold text-[var(--text-primary)] tabular-nums">{inProgressCount}</strong> in progress
            </span>
            <span className="text-[var(--border-strong)]" aria-hidden="true">·</span>
            <span className={blockedCount > 0 ? 'text-[var(--status-danger-text)]' : undefined}>
              <strong className="font-semibold tabular-nums">{blockedCount}</strong> blocked
            </span>
            <span className="text-[var(--border-strong)]" aria-hidden="true">·</span>
            <span>
              <strong className="font-semibold text-[var(--text-primary)] tabular-nums">{completedCount}</strong> done
            </span>
          </div>
        </div>

        {/* Interactive Task Workspace (Masthead + Primary Action -> Search & Filters -> Compact Task List) */}
        <TaskWorkspace
          initialTasks={tasks}
          workspaceId={workspace.id}
          projects={projects}
          userTimeZone={userTimeZone}
          initialSearch={resolvedParams.search}
          initialStatusFilter={resolvedParams.statusFilter ?? resolvedParams.status}
          initialPriorityFilter={resolvedParams.priority}
          initialDateFilter={resolvedParams.dateFilter}
          initialTaskId={resolvedParams.taskId}
        />
    </WorkspaceShell>
  );
}
