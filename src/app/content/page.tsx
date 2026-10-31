import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getContentItems, getIdeaInboxItems, getSocialAccounts } from '@/lib/services/content-service';
import { AppNavigation } from '@/components/layout/AppNavigation';
import { ContentWorkspace } from '@/components/content/ContentWorkspace';

export const instant = false;

export default async function ContentPage() {
  await connection();

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
              Please configure your live Supabase credentials in .env.local to manage editorial content.
            </p>
          </div>
        </main>
      </div>
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
    <div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col font-sans">
      <AppNavigation />

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-6">
        <ContentWorkspace
          initialItems={initialItems}
          initialIdeas={initialIdeas}
          workspaceId={workspace.id}
          socialAccounts={socialAccounts}
          projects={projects}
          userTimeZone={userTimeZone}
        />
      </main>
    </div>
  );
}
