import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getTasks } from '@/lib/services/task-service';
import { AppNavigation } from '@/components/layout/AppNavigation';
import { TaskWorkspace } from '@/components/tasks/TaskWorkspace';
import type { Database } from '@/types/database';

export const instant = false;

interface TasksPageProps {
  searchParams: Promise<{
    status?: string;
    priority?: string;
    project_id?: string;
    search?: string;
  }>;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  await connection();
  const resolvedParams = await searchParams;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const isEnvConfigured = supabaseUrl && !supabaseUrl.includes('your-project-ref');

  if (!isEnvConfigured) {
    return (
      <div
        data-workspace-shell="v2"
        className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex flex-col md:flex-row font-sans"
      >
        <AppNavigation />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 min-w-0 max-w-6xl w-full mx-auto px-5 py-7 sm:px-8 sm:py-10 lg:px-12 lg:py-12 space-y-6"
        >
          <div className="surface-card p-6 sm:p-8 badge-warning border space-y-1.5">
            <h2 className="heading-section text-base">Configuration Required</h2>
            <p className="text-xs sm:text-sm opacity-90">
              Please configure your live Supabase credentials in .env.local to manage persisted tasks.
            </p>
          </div>
        </main>
      </div>
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
      <div
        data-workspace-shell="v2"
        className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex flex-col md:flex-row font-sans"
      >
        <AppNavigation />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 min-w-0 max-w-6xl w-full mx-auto px-5 py-7 sm:px-8 sm:py-10 lg:px-12 lg:py-12 flex items-center justify-center"
        >
          <div className="surface-card max-w-md w-full p-8 text-center space-y-2">
            <h2 className="heading-section text-lg">No Active Workspace</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              No workspace membership found.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const workspace = (memberData as unknown as { workspaces: { id: string; name: string; slug: string } }).workspaces;

  // Fetch projects for filters and forms
  const { data: projectsData } = await supabase
    .from('projects')
    .select('id, name, color')
    .eq('workspace_id', workspace.id)
    .eq('status', 'active');

  const projects = projectsData || [];

  // Fetch tasks
  const tasks = await getTasks(supabase, workspace.id, {
    status: resolvedParams.status as Database['public']['Tables']['tasks']['Row']['status'],
    priority: resolvedParams.priority as Database['public']['Tables']['tasks']['Row']['priority'],
    project_id: resolvedParams.project_id,
    search: resolvedParams.search,
    parent_task_id: null, // Display top-level tasks on main list
  });

  // Calculate statistics
  const totalTasks = tasks.length;
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length;
  const blockedCount = tasks.filter((t) => t.is_blocked).length;
  const completedCount = tasks.filter((t) => t.status === 'done').length;

  return (
    <div
      data-workspace-shell="v2"
      className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex flex-col md:flex-row font-sans"
    >
      <AppNavigation />

      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 min-w-0 max-w-6xl w-full mx-auto px-5 py-7 sm:px-8 sm:py-10 lg:px-12 lg:py-12 space-y-8"
      >
        {/* Quiet Top Meta Row */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-[var(--text-muted)] min-w-0">
          <div className="flex items-center gap-2 font-mono min-w-0 max-w-full">
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent)] ring-1 ring-[var(--accent-border)]"
              aria-hidden="true"
            />
            <span
              className="truncate max-w-[220px] sm:max-w-[340px] md:max-w-[440px]"
              title={workspace.name}
            >
              Workspace: {workspace.name}
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
          userTimeZone="Africa/Cairo"
        />
      </main>
    </div>
  );
}
