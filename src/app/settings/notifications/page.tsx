import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveAuthorizedWorkspace } from '@/lib/actions/content-actions';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { DailyBriefingSettings } from '@/components/settings/DailyBriefingSettings';
import { NotificationPreferencesForm } from '@/components/notifications/NotificationPreferencesForm';

export const instant = false;

export default async function NotificationSettingsPage() {
  await connection();
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    redirect('/auth/sign-in?redirectTo=/settings/notifications');
  }

  const { workspaceId, error: wsError } = await resolveAuthorizedWorkspace(
    supabase,
    authData.user.id
  );

  if (wsError || !workspaceId) {
    return (
      <WorkspaceShell maxWidth="narrow">
        <div className="surface-card p-6 sm:p-8 badge-warning border space-y-1.5">
          <h2 className="heading-section text-base">Workspace Required</h2>
          <p className="text-xs sm:text-sm opacity-90">
            No active workspace membership found. Please create or join a workspace to configure notification preferences.
          </p>
        </div>
      </WorkspaceShell>
    );
  }

  const { data: wsData } = await supabase
    .from('workspaces')
    .select('name')
    .eq('id', workspaceId)
    .maybeSingle();

  return (
    <WorkspaceShell workspaceName={wsData?.name} maxWidth="narrow">
      <NotificationPreferencesForm
        workspaceId={workspaceId}
        workspaceName={wsData?.name}
      />
      <div className="mt-10 pt-8 border-t border-[var(--border-subtle)]">
        <DailyBriefingSettings />
      </div>
    </WorkspaceShell>
  );
}
