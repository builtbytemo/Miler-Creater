import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ==============================================================================
 * Workspace Lifecycle & Membership Invariant Tests (Offline / Static & Simulation)
 * ==============================================================================
 *
 * NOTE: These tests verify the invariant specifications and static SQL definitions
 * through pure unit simulations and AST/regex migration inspection.
 * Real PostgreSQL execution of triggers and cascade constraints requires a live
 * PostgreSQL/Supabase database instance (e.g. via staging verification).
 */

// Pure simulation of PostgreSQL protect_workspace_members_delete() deferred trigger logic
interface WorkspaceRecord {
  id: string;
  owner_id: string;
}

interface WorkspaceMemberRecord {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
}

function simulateProtectWorkspaceMembersDelete(
  deletedMember: WorkspaceMemberRecord,
  workspacesTable: Map<string, WorkspaceRecord>
): { success: boolean; error?: string } {
  // Check if the parent workspace still exists in workspacesTable
  const parentWorkspace = workspacesTable.get(deletedMember.workspace_id);

  // If the workspace still exists and the deleted member is the workspace owner, forbid removal
  if (parentWorkspace && parentWorkspace.owner_id === deletedMember.user_id) {
    return {
      success: false,
      error: 'The workspace owner cannot be removed from workspace members while the workspace exists.',
    };
  }

  return { success: true };
}

// Pure simulation of workspaces_delete_owner RLS policy:
// USING (public.is_workspace_member(id, 'owner'))
function simulateWorkspaceDeletePolicy(
  actorUserId: string | null,
  workspaceId: string,
  membersTable: WorkspaceMemberRecord[]
): boolean {
  if (!actorUserId) return false;
  const membership = membersTable.find(
    (m) => m.workspace_id === workspaceId && m.user_id === actorUserId
  );
  return membership?.role === 'owner';
}

describe('Workspace Lifecycle & Ownership Protection Invariant Tests', () => {
  const workspaceAId = 'ws-aaa-111';
  const ownerAId = 'usr-owner-a';
  const memberAId = 'usr-member-a';

  const initialWorkspaces = (): Map<string, WorkspaceRecord> => {
    const map = new Map<string, WorkspaceRecord>();
    map.set(workspaceAId, { id: workspaceAId, owner_id: ownerAId });
    return map;
  };

  const ownerMembership: WorkspaceMemberRecord = {
    id: 'mem-1',
    workspace_id: workspaceAId,
    user_id: ownerAId,
    role: 'owner',
  };

  const regularMembership: WorkspaceMemberRecord = {
    id: 'mem-2',
    workspace_id: workspaceAId,
    user_id: memberAId,
    role: 'member',
  };

  describe('1. Owner Removal Protection While Workspace Exists', () => {
    it('rejects removing the workspace owner while the parent workspace remains', () => {
      const workspaces = initialWorkspaces();

      const result = simulateProtectWorkspaceMembersDelete(ownerMembership, workspaces);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/workspace owner cannot be removed from workspace members while the workspace exists/);
    });

    it('demonstrates why SECURITY DEFINER is required to prevent RLS circular visibility trap on self-deletion', () => {
      // Simulating what happens under SECURITY INVOKER when an owner deletes their own membership row:
      // The row was deleted in the current transaction snapshot.
      const transactionSnapshotMembers: WorkspaceMemberRecord[] = []; // Owner's membership row is now deleted

      // Caller RLS check: workspaces_select_member calls is_workspace_member(id, 'viewer')
      const callerCanViewWorkspaceThroughRLS = transactionSnapshotMembers.some(
        (m) => m.workspace_id === workspaceAId && m.user_id === ownerAId
      );
      // Under SECURITY INVOKER, RLS filters out the parent workspace row because caller has no active membership row!
      expect(callerCanViewWorkspaceThroughRLS).toBe(false);

      // Under SECURITY DEFINER, the trigger function inspects table storage directly as function owner (postgres),
      // successfully seeing that the workspace row still exists on disk!
      const directTableStorageContainsWorkspace = initialWorkspaces().has(workspaceAId);
      expect(directTableStorageContainsWorkspace).toBe(true);
    });

    it('statically asserts that migration 20261029000002 checks FOUND and ws_owner = OLD.user_id with hardened security', () => {
      const migrationPath = path.resolve(
        __dirname,
        '../supabase/migrations/20261029000002_fix_workspace_cascade_deletion.sql'
      );
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');

      // Static code assertions (verifies source text only, does not prove PostgreSQL runtime behavior)
      expect(sqlContent).toContain('CREATE OR REPLACE FUNCTION public.protect_workspace_members_delete()');
      expect(sqlContent).toContain('SECURITY DEFINER');
      expect(sqlContent).toContain("SET search_path = ''");
      expect(sqlContent).toContain('FROM public.workspaces');
      expect(sqlContent).toContain('IF FOUND AND ws_owner = OLD.user_id THEN');
      expect(sqlContent).toContain(
        "RAISE EXCEPTION 'The workspace owner cannot be removed from workspace members while the workspace exists.';"
      );
      expect(sqlContent).toContain(
        'REVOKE ALL ON FUNCTION public.protect_workspace_members_delete() FROM PUBLIC, anon, authenticated;'
      );

      // Least-privilege verification: Ensure unnecessary direct EXECUTE grants are absent
      expect(sqlContent).not.toContain('GRANT EXECUTE ON FUNCTION public.protect_workspace_members_delete()');
    });
  });

  describe('2. Ordinary Member Removal', () => {
    it('permits removing an ordinary member according to existing permissions while workspace remains', () => {
      const workspaces = initialWorkspaces();

      const result = simulateProtectWorkspaceMembersDelete(regularMembership, workspaces);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('3. Workspace Cascade Deletion Without Trigger Blocking', () => {
    it('allows owner membership deletion to succeed when the parent workspace is deleted', () => {
      const workspaces = initialWorkspaces();

      // Lifecycle step: Parent workspace is deleted from workspaces table
      workspaces.delete(workspaceAId);

      // Foreign-key cascade executes membership removal
      const cascadeResult = simulateProtectWorkspaceMembersDelete(ownerMembership, workspaces);

      expect(cascadeResult.success).toBe(true);
      expect(cascadeResult.error).toBeUndefined();
    });

    it('statically asserts that the deletion guard is configured as a DEFERRED CONSTRAINT TRIGGER', () => {
      const migrationPath = path.resolve(
        __dirname,
        '../supabase/migrations/20261029000002_fix_workspace_cascade_deletion.sql'
      );
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');

      expect(sqlContent).toContain('CREATE CONSTRAINT TRIGGER trg_workspace_members_protect_owner_delete');
      expect(sqlContent).toContain('AFTER DELETE ON public.workspace_members');
      expect(sqlContent).toContain('DEFERRABLE INITIALLY DEFERRED');
      expect(sqlContent).toContain('EXECUTE FUNCTION public.protect_workspace_members_delete()');
    });
  });

  describe("4. Tenant Isolation: Denying Cross-Tenant Workspace Deletion", () => {
    const workspaceBId = 'ws-bbb-222';
    const ownerBId = 'usr-owner-b';

    const members: WorkspaceMemberRecord[] = [
      ownerMembership,
      regularMembership,
      {
        id: 'mem-3',
        workspace_id: workspaceBId,
        user_id: ownerBId,
        role: 'owner',
      },
    ];

    it("denies Tenant B from deleting Tenant A's workspace", () => {
      const canDelete = simulateWorkspaceDeletePolicy(ownerBId, workspaceAId, members);
      expect(canDelete).toBe(false);
    });

    it("denies regular member of Tenant A from deleting Tenant A's workspace", () => {
      const canDelete = simulateWorkspaceDeletePolicy(memberAId, workspaceAId, members);
      expect(canDelete).toBe(false);
    });

    it("denies unauthenticated actor from deleting Tenant A's workspace", () => {
      const canDelete = simulateWorkspaceDeletePolicy(null, workspaceAId, members);
      expect(canDelete).toBe(false);
    });

    it("permits only Tenant A's owner to delete Tenant A's workspace", () => {
      const canDelete = simulateWorkspaceDeletePolicy(ownerAId, workspaceAId, members);
      expect(canDelete).toBe(true);
    });
  });

  describe('5. Staging Integration Cleanup Scoping', () => {
    it('verifies that test-reminder-integration.ts scopes deletion exclusively to exact captured IDs', () => {
      const scriptPath = path.resolve(__dirname, '../scripts/test-reminder-integration.ts');
      const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

      // Verify exact ID tracking arrays exist
      expect(scriptContent).toContain('const createdUserIds: string[] = [];');
      expect(scriptContent).toContain('const createdWorkspaceIds: string[] = [];');
      expect(scriptContent).toContain('const createdTaskIds: string[] = [];');

      // Verify exact ID filtering in cleanup stages
      expect(scriptContent).toContain(".delete().eq('id', taskId)");
      expect(scriptContent).toContain(".delete().eq('workspace_id', wsId)");
      expect(scriptContent).toContain(".delete().eq('id', wsId)");
      expect(scriptContent).toContain('auth.admin.deleteUser(userId)');

      // Confirm no broad unscoped deletion statements exist
      expect(scriptContent).not.toMatch(/\.from\('workspaces'\)\.delete\(\)\s*;/);
      expect(scriptContent).not.toMatch(/\.from\('tasks'\)\.delete\(\)\s*;/);
      expect(scriptContent).not.toMatch(/\.from\('notifications'\)\.delete\(\)\s*;/);
    });
  });
});
