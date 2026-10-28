import { redirect } from 'next/navigation';
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
  const resolvedParams = await searchParams;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const isEnvConfigured = supabaseUrl && !supabaseUrl.includes('your-project-ref');

  if (!isEnvConfigured) {
    return (
      <div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col font-sans">
        <AppNavigation />
        <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-6">
          <div className="p-6 rounded-xl bg-amber-950/30 border border-amber-800 text-amber-200">
            <h2 className="text-base font-semibold mb-1">Configuration Required</h2>
            <p className="text-xs text-amber-300/80">
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
      <div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col font-sans">
        <AppNavigation />
        <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8">
          <div className="p-6 rounded-xl bg-neutral-950 border border-neutral-800 text-center">
            <p className="text-sm text-neutral-400">No workspace membership found.</p>
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
    <div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col font-sans">
      <AppNavigation />

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-6">
        {/* Header & Quick Stats */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-neutral-800">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-neutral-100">Tasks Command Center</h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Phase 2 Engine
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-1">
              Hierarchical subtasks, dependency validation, recurrence engine, and unified scheduling
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800">
              <span className="text-[10px] text-neutral-500 uppercase block font-mono">Total</span>
              <span className="font-semibold text-neutral-200">{totalTasks}</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800">
              <span className="text-[10px] text-blue-400 uppercase block font-mono">In Progress</span>
              <span className="font-semibold text-blue-400">{inProgressCount}</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800">
              <span className="text-[10px] text-red-400 uppercase block font-mono">Blocked</span>
              <span className="font-semibold text-red-400">{blockedCount}</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800">
              <span className="text-[10px] text-emerald-400 uppercase block font-mono">Done</span>
              <span className="font-semibold text-emerald-400">{completedCount}</span>
            </div>
          </div>
        </div>

        {/* Interactive Task Workspace */}
        <TaskWorkspace
          initialTasks={tasks}
          workspaceId={workspace.id}
          projects={projects}
          userTimeZone="Asia/Cairo"
        />
      </main>
    </div>
  );
}
