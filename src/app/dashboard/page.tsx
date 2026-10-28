import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { signOutAction } from '@/lib/auth/actions';
import type { Database, WorkspaceRole } from '@/types/database';
import {
  Calendar,
  CheckSquare,
  Share2,
  ShieldCheck,
  Bot,
  Database as DbIcon,
  User,
  LogOut,
  Layers,
  Clock,
} from 'lucide-react';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
}

export default async function DashboardPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const isEnvConfigured = supabaseUrl && !supabaseUrl.includes('your-project-ref');

  let user = null;
  let profile: ProfileRow | null = null;
  let workspace: WorkspaceInfo | null = null;
  let role: WorkspaceRole | null = null;

  if (isEnvConfigured) {
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      user = data.user;

      if (!user) {
        redirect('/auth/sign-in');
      }

      // Fetch user profile and active workspace
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (profileData) {
        profile = profileData;
      }

      const { data: memberData } = await supabase
        .from('workspace_members')
        .select('workspace_id, role')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

      if (memberData) {
        role = memberData.role;
        const { data: wsData } = await supabase
          .from('workspaces')
          .select('id, name, slug')
          .eq('id', memberData.workspace_id)
          .maybeSingle();
        if (wsData) {
          workspace = wsData;
        }
      }
    } catch {
      // Allow graceful display if DB trigger is pending first migration
    }
  }

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
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Phase 1 Active
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
                  className="p-2 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </form>
            </div>
          ) : (
            <a
              href="/auth/sign-in"
              className="text-xs px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors"
            >
              Sign In
            </a>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-8">
        {/* Workspace Identity Banner */}
        <div className="p-6 rounded-xl bg-neutral-950 border border-neutral-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-mono text-neutral-400">
              <Layers className="w-3.5 h-3.5 text-neutral-400" />
              <span>Workspace: {workspace?.name || 'Personal Workspace (Default)'}</span>
            </div>
            <h2 className="text-xl font-semibold text-neutral-100">
              Architecture & Security Foundation
            </h2>
            <p className="text-sm text-neutral-400 max-w-2xl">
              Foundation established for multi-tenant content planning across LinkedIn, Reddit,
              Threads, and X, with hierarchical tasks, server-side calendar scheduling, and
              AI tool security boundaries.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-4 h-4" />
              RLS Access Protected
            </span>
          </div>
        </div>

        {/* Phase 1 Verification Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center border border-blue-500/20">
              <DbIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-200">Database & RLS</h3>
              <p className="text-xs text-neutral-400 mt-1">
                14 schema entities defined in version-controlled migration with strict Row Level
                Security policies.
              </p>
            </div>
            <div className="pt-2 border-t border-neutral-800/80 text-[11px] text-neutral-400 font-mono">
              supabase/migrations/
            </div>
          </div>

          <div className="p-5 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-200">Supabase Auth SSR</h3>
              <p className="text-xs text-neutral-400 mt-1">
                Cookie-based session management, Next.js middleware token refresh, and Google OAuth
                ready.
              </p>
            </div>
            <div className="pt-2 border-t border-neutral-800/80 text-[11px] text-neutral-400 font-mono">
              @supabase/ssr v0.12+
            </div>
          </div>

          <div className="p-5 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
            <div className="w-9 h-9 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-200">AI Integration Boundary</h3>
              <p className="text-xs text-neutral-400 mt-1">
                Scoped API tokens, confirmation flow for high-risk mutations, and audit logging
                architecture.
              </p>
            </div>
            <div className="pt-2 border-t border-neutral-800/80 text-[11px] text-neutral-400 font-mono">
              docs/AI_INTEGRATION_BOUNDARY.md
            </div>
          </div>

          <div className="p-5 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-200">Temporal & Timezone</h3>
              <p className="text-xs text-neutral-400 mt-1">
                UTC TIMESTAMPTZ storage paired with profile IANA timezone rendering for calendar
                accuracy.
              </p>
            </div>
            <div className="pt-2 border-t border-neutral-800/80 text-[11px] text-neutral-400 font-mono">
              Timezone: {profile?.timezone || 'UTC (Configurable)'}
            </div>
          </div>
        </div>

        {/* Feature Architecture Status */}
        <div className="p-6 rounded-xl bg-neutral-950 border border-neutral-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-200">
              Core Module Specifications (Ready for Subsequent Phases)
            </h3>
            <span className="text-xs text-neutral-400 font-mono">Phase 1 Complete</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-neutral-900 border border-neutral-800 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-300">
                <Share2 className="w-4 h-4 text-blue-400" />
                <span>Social Content Engine</span>
              </div>
              <p className="text-xs text-neutral-400">
                Unified schema for LinkedIn, Reddit, Threads, and X across posts, comments, replies,
                shares, reposts, and reactions. Unscheduled ideas + scheduled items.
              </p>
            </div>

            <div className="p-4 rounded-lg bg-neutral-900 border border-neutral-800 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-300">
                <CheckSquare className="w-4 h-4 text-emerald-400" />
                <span>Task & Dependency Graph</span>
              </div>
              <p className="text-xs text-neutral-400">
                Hierarchical subtasks, milestones, recurrence rules, priority levels, and
                four-way dependency constraints.
              </p>
            </div>

            <div className="p-4 rounded-lg bg-neutral-900 border border-neutral-800 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-300">
                <Calendar className="w-4 h-4 text-purple-400" />
                <span>Unified Planning Engine</span>
              </div>
              <p className="text-xs text-neutral-400">
                Composite calendar query projection designed to merge scheduled tasks and content
                items onto unified day, week, month, and timeline views.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
