import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveAuthorizedWorkspace } from '@/lib/actions/content-actions';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';

export const instant = false;

interface NotificationsPageProps {
  searchParams?: Promise<{
    filter?: string;
  }>;
}

export default async function NotificationsPage({ searchParams }: NotificationsPageProps = {}) {
  await connection();
  const resolvedParams = searchParams ? await searchParams : {};
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
      <WorkspaceShell maxWidth="5xl">
        <div className="surface-card p-6 sm:p-8 badge-warning border space-y-1.5">
          <h2 className="heading-section text-base">Workspace Required</h2>
          <p className="text-xs sm:text-sm opacity-90">
            No active workspace membership found. Please create or join a workspace to view notifications.
          </p>
        </div>
      </WorkspaceShell>
    );
  }

  // Fetch workspace details & user timezone preference
  const [{ data: wsData }, { data: profile }] = await Promise.all([
    supabase.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
    supabase.from('profiles').select('timezone').eq('id', authData.user.id).maybeSingle(),
  ]);

  const userTimeZone = profile?.timezone || DEFAULT_TIMEZONE;

  return (
    <WorkspaceShell workspaceName={wsData?.name} maxWidth="5xl">
      <NotificationCenter
        workspaceId={workspaceId}
        workspaceName={wsData?.name}
        userTimeZone={userTimeZone}
        initialReadFilter={resolvedParams.filter === 'unread' ? 'unread' : 'all'}
      />
    </WorkspaceShell>
  );
}
