import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/**
 * Verifies that the authenticated user holds valid membership in the requested workspace,
 * or resolves their default workspace if no candidate ID is provided.
 * Never trusts a client-supplied workspace ID without database membership verification.
 * 
 * This trusted authorization helper runs strictly in server-side contexts using the
 * caller's authenticated Supabase client (respecting Row Level Security).
 */
export async function resolveAuthorizedWorkspace(
  supabase: SupabaseClient<Database>,
  userId: string,
  requestedWorkspaceId?: string | null
): Promise<{ workspaceId?: string; error?: string }> {
  if (requestedWorkspaceId) {
    const { data: member, error } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('user_id', userId)
      .eq('workspace_id', requestedWorkspaceId)
      .maybeSingle();

    if (error || !member) {
      return { error: 'Unauthorized: You do not have access to this workspace' };
    }
    return { workspaceId: requestedWorkspaceId };
  }

  // Fall back to the user's first active workspace membership
  const { data: defaultMember, error } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error || !defaultMember) {
    return { error: 'No active workspace membership found' };
  }

  return { workspaceId: defaultMember.workspace_id };
}
