import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveAuthorizedWorkspace } from '@/lib/actions/content-actions';
import { AppNavigation } from '@/components/layout/AppNavigation';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';

export const instant = false;

export default async function NotificationsPage() {
  await connection();
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    redirect('/auth/sign-in?redirectTo=/notifications');
  }

  const { workspaceId, error: wsError } = await resolveAuthorizedWorkspace(
    supabase,
    authData.user.id
  );

  if (wsError || !workspaceId) {
    return (
      <div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col font-sans">
        <AppNavigation />
        <main className="flex-1 max-w-5xl w-full mx-auto p-6 md:p-8">
          <div className="p-6 rounded-xl bg-amber-950/40 border border-amber-900/60 text-amber-200">
            <h2 className="text-base font-semibold mb-1">Workspace Required</h2>
            <p className="text-xs text-amber-300/80">
              No active workspace membership found. Please create or join a workspace to view notifications.
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Fetch workspace details & user timezone preference
  const [{ data: wsData }, { data: profile }] = await Promise.all([
    supabase.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
    supabase.from('profiles').select('timezone').eq('id', authData.user.id).maybeSingle(),
  ]);

  const userTimeZone = profile?.timezone || DEFAULT_TIMEZONE;

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col font-sans">
      <AppNavigation />

      <main className="flex-1 max-w-5xl w-full mx-auto p-6 md:p-8">
        <NotificationCenter
          workspaceId={workspaceId}
          workspaceName={wsData?.name}
          userTimeZone={userTimeZone}
        />
      </main>
    </div>
  );
}
