import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminClient } from '../src/lib/supabase/admin';

// Pure simulation of Postgres function is_workspace_member(lookup_workspace_id, required_role)
function simulateIsWorkspaceMember(
  userRole: 'owner' | 'admin' | 'member' | 'viewer' | null,
  requiredRole: 'owner' | 'admin' | 'member' | 'viewer'
): boolean {
  if (!userRole) return false;
  if (requiredRole === 'viewer') return true;
  if (requiredRole === 'member' && ['owner', 'admin', 'member'].includes(userRole)) return true;
  if (requiredRole === 'admin' && ['owner', 'admin'].includes(userRole)) return true;
  if (requiredRole === 'owner' && userRole === 'owner') return true;
  return false;
}

describe('Security Boundaries & Isolation Tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Admin Service-Role Client Protection', () => {
    it('throws immediately if invoked in a browser window environment', () => {
      // Mock global window object to simulate client-side execution
      vi.stubGlobal('window', {});

      expect(() => createAdminClient()).toThrow(
        /SECURITY VIOLATION: createAdminClient\(\) was called in a browser environment!/
      );
    });

    it('throws if service role key is missing in server environment', () => {
      const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      expect(() => createAdminClient()).toThrow(
        /Missing or placeholder NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/
      );

      if (origKey) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
    });
  });

  describe('Workspace Role Hierarchy RLS Logic', () => {
    it('viewer role allows read-only access but denies member and admin operations', () => {
      expect(simulateIsWorkspaceMember('viewer', 'viewer')).toBe(true);
      expect(simulateIsWorkspaceMember('viewer', 'member')).toBe(false);
      expect(simulateIsWorkspaceMember('viewer', 'admin')).toBe(false);
      expect(simulateIsWorkspaceMember('viewer', 'owner')).toBe(false);
    });

    it('member role allows content/task mutations but denies workspace administrative operations', () => {
      expect(simulateIsWorkspaceMember('member', 'viewer')).toBe(true);
      expect(simulateIsWorkspaceMember('member', 'member')).toBe(true);
      expect(simulateIsWorkspaceMember('member', 'admin')).toBe(false);
      expect(simulateIsWorkspaceMember('member', 'owner')).toBe(false);
    });

    it('admin role allows member management and token generation but denies workspace destruction', () => {
      expect(simulateIsWorkspaceMember('admin', 'viewer')).toBe(true);
      expect(simulateIsWorkspaceMember('admin', 'member')).toBe(true);
      expect(simulateIsWorkspaceMember('admin', 'admin')).toBe(true);
      expect(simulateIsWorkspaceMember('admin', 'owner')).toBe(false);
    });

    it('owner role has full permission across all operations', () => {
      expect(simulateIsWorkspaceMember('owner', 'viewer')).toBe(true);
      expect(simulateIsWorkspaceMember('owner', 'member')).toBe(true);
      expect(simulateIsWorkspaceMember('owner', 'admin')).toBe(true);
      expect(simulateIsWorkspaceMember('owner', 'owner')).toBe(true);
    });

    it('unauthenticated or non-member users are denied all permissions', () => {
      expect(simulateIsWorkspaceMember(null, 'viewer')).toBe(false);
      expect(simulateIsWorkspaceMember(null, 'member')).toBe(false);
      expect(simulateIsWorkspaceMember(null, 'admin')).toBe(false);
      expect(simulateIsWorkspaceMember(null, 'owner')).toBe(false);
    });
  });

  describe('Notification & Preferences RLS Boundaries', () => {
    function simulateNotificationSelectPolicy(authUid: string | null, recipientId: string): boolean {
      if (!authUid) return false;
      return authUid === recipientId;
    }

    function simulateNotificationPreferencePolicy(
      authUid: string | null,
      prefUserId: string,
      userRoleInWorkspace: 'owner' | 'admin' | 'member' | 'viewer' | null
    ): boolean {
      if (!authUid) return false;
      const isOwner = authUid === prefUserId;
      const isMember = simulateIsWorkspaceMember(userRoleInWorkspace, 'viewer');
      return isOwner && isMember;
    }

    it('strictly restricts notification viewing to the recipient only', () => {
      const userA = 'user-aaa';
      const userB = 'user-bbb';

      expect(simulateNotificationSelectPolicy(userA, userA)).toBe(true);
      expect(simulateNotificationSelectPolicy(userA, userB)).toBe(false);
      expect(simulateNotificationSelectPolicy(null, userA)).toBe(false);
    });

    it('strictly restricts notification preferences to the owning user within authorized workspace', () => {
      const userA = 'user-aaa';
      const userB = 'user-bbb';

      // User A accessing User A's preferences in workspace where A is a member -> Allowed
      expect(simulateNotificationPreferencePolicy(userA, userA, 'member')).toBe(true);
      expect(simulateNotificationPreferencePolicy(userA, userA, 'viewer')).toBe(true);

      // User A accessing User B's preferences in workspace -> Denied
      expect(simulateNotificationPreferencePolicy(userA, userB, 'member')).toBe(false);

      // User A accessing User A's preferences in workspace where A is NOT a member -> Denied
      expect(simulateNotificationPreferencePolicy(userA, userA, null)).toBe(false);

      // Unauthenticated access -> Denied
      expect(simulateNotificationPreferencePolicy(null, userA, 'member')).toBe(false);
    });
  });

  describe('Task Completion RPC Fail-Closed Security Policy (Migration 20261112000002)', () => {
    function simulateCompleteTaskAuth(
      callerRole: 'anon' | 'authenticated' | 'service_role' | null,
      authUid: string | null,
      userWorkspaceRole: 'owner' | 'admin' | 'member' | 'viewer' | null
    ): { allowed: boolean; error?: string } {
      // 1. Trusted backend execution (service_role)
      if (callerRole === 'service_role') {
        return { allowed: true };
      }
      // 2. Authenticated user with active session
      if (authUid !== null && callerRole === 'authenticated') {
        const isMember = simulateIsWorkspaceMember(userWorkspaceRole, 'member');
        if (!isMember) {
          return { allowed: false, error: 'Access denied: not an authorized member of workspace' };
        }
        return { allowed: true };
      }
      // 3. Fail closed on anonymous or missing session
      return { allowed: false, error: 'Access denied: authenticated user session required' };
    }

    it('rejects anonymous callers unconditionally regardless of parameters', () => {
      const res = simulateCompleteTaskAuth('anon', null, null);
      expect(res.allowed).toBe(false);
      expect(res.error).toMatch(/authenticated user session required/);
    });

    it('rejects missing or null auth callers without a valid session', () => {
      const res = simulateCompleteTaskAuth(null, null, null);
      expect(res.allowed).toBe(false);
      expect(res.error).toMatch(/authenticated user session required/);
    });

    it('rejects authenticated users who are not members of the target workspace', () => {
      const res = simulateCompleteTaskAuth('authenticated', 'user-123', null);
      expect(res.allowed).toBe(false);
      expect(res.error).toMatch(/not an authorized member of workspace/);
    });

    it('rejects authenticated users who only hold viewer role (insufficient privilege)', () => {
      const res = simulateCompleteTaskAuth('authenticated', 'user-123', 'viewer');
      expect(res.allowed).toBe(false);
      expect(res.error).toMatch(/not an authorized member of workspace/);
    });

    it('allows authenticated members, admins, and owners of the target workspace', () => {
      expect(simulateCompleteTaskAuth('authenticated', 'user-123', 'member').allowed).toBe(true);
      expect(simulateCompleteTaskAuth('authenticated', 'user-123', 'admin').allowed).toBe(true);
      expect(simulateCompleteTaskAuth('authenticated', 'user-123', 'owner').allowed).toBe(true);
    });

    it('allows service_role for legitimate background operations without user session', () => {
      expect(simulateCompleteTaskAuth('service_role', null, null).allowed).toBe(true);
    });
  });
});
