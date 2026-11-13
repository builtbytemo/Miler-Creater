import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getContentItems, getIdeaInboxItems, getSocialAccounts } from '@/lib/services/content-service';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { ContentWorkspace } from '@/components/content/ContentWorkspace';

export const instant = false;

interface ContentPageProps {
  searchParams?: Promise<{
    tab?: string;
    platform?: string;
    status?: string;
    contentId?: string;
  }>;
}

export default async function ContentPage({ searchParams }: ContentPageProps = {}) {
  await connection();
  const resolvedParams = searchParams ? await searchParams : {};

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const isEnvConfigured = supabaseUrl && !supabaseUrl.includes('your-project-ref');

  if (!isEnvConfigured) {
    return (
      <WorkspaceShell maxWidth="7xl" mainClassName="space-y-6">
        <div className="surface-card p-6 sm:p-8 badge-warning border space-y-1.5">
          <h2 className="heading-section text-base">Configuration Required</h2>
          <p className="text-xs sm:text-sm opacity-90">
            Please configure your live Supabase credentials in .env.local to manage editorial content.
          </p>
        </div>
      </WorkspaceShell>
    );
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    redirect('/auth/sign-in?redirectTo=/content');
  }

  // Get user profile for timezone preference
  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', authData.user.id)
    .maybeSingle();

  const userTimeZone = profile?.timezone || 'Asia/Cairo';

  // Get active workspace membership
  const { data: memberData } = await supabase
    .from('workspace_members')
    .select('workspace_id, workspaces (id, name, slug)')
    .eq('user_id', authData.user.id)
    .limit(1)
    .maybeSingle();

  if (!memberData) {
    return (
      <WorkspaceShell maxWidth="7xl">
        <div className="surface-card p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">No workspace membership found.</p>
        </div>
      </WorkspaceShell>
    );
  }

  const workspace = (
    memberData as unknown as { workspaces: { id: string; name: string; slug: string } }
  ).workspaces;

  // Parallel fetch: projects, social accounts, all content items, and idea inbox items
  const [projectsResult, socialAccounts, initialItems, initialIdeas] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, color')
      .eq('workspace_id', workspace.id)
      .eq('status', 'active'),
    getSocialAccounts(supabase, workspace.id),
    getContentItems(supabase, workspace.id),
    getIdeaInboxItems(supabase, workspace.id),
  ]);

  const projects = projectsResult.data || [];

  return (
    <WorkspaceShell workspaceName={workspace.name} maxWidth="wide" mainClassName="space-y-6">
      <ContentWorkspace
          initialItems={initialItems}
          initialIdeas={initialIdeas}
          workspaceId={workspace.id}
          socialAccounts={socialAccounts}
          projects={projects}
          userTimeZone={userTimeZone}
          initialTab={resolvedParams.tab}
          initialPlatform={resolvedParams.platform}
          initialStatusFilter={resolvedParams.status}
          initialContentId={resolvedParams.contentId}
        />
    </WorkspaceShell>
  );
}
