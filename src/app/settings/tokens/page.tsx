import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveAuthorizedWorkspace } from '@/lib/auth/workspace';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { ClaudeConnection } from '@/components/settings/ClaudeConnection';
import { CliConnection } from '@/components/settings/CliConnection';
import { AiTokensManager } from '@/components/settings/AiTokensManager';

export const instant = false;

export default async function AiTokensSettingsPage() {
  await connection();
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    redirect('/auth/sign-in?redirectTo=/settings/tokens');
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
            No active workspace membership found. Please create or join a workspace to manage AI
            API tokens.
          </p>
        </div>
      </WorkspaceShell>
    );
  }

  const [{ data: wsData }, { data: profileData }] = await Promise.all([
    supabase.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
    supabase.from('profiles').select('timezone').eq('id', authData.user.id).maybeSingle(),
  ]);

  const userTimeZone = profileData?.timezone || 'Asia/Cairo';

  return (
    <WorkspaceShell workspaceName={wsData?.name} maxWidth="narrow">
      <CliConnection workspaceId={workspaceId} />
      <ClaudeConnection />
      <AiTokensManager
        workspaceId={workspaceId}
        workspaceName={wsData?.name}
        userTimeZone={userTimeZone}
      />
    </WorkspaceShell>
  );
}
