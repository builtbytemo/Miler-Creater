/**
 * ==============================================================================
 * Live Database Integration Test Script (Two-Tenant RLS & Audit Lifecycle)
 * ==============================================================================
 * 
 * Usage:
 *   npm run test:db
 * 
 * Prerequisites:
 *   - A live, disposable Supabase project with migrations 1, 2, 3, and 4 applied.
 *   - Real SUPABASE_URL, ANON_KEY, and SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';

async function runLiveDatabaseAudit() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.log('\n=== Real Database Multi-Tenant RLS & Audit Lifecycle Integration Test ===\n');

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    supabaseUrl.includes('your-project-ref') ||
    serviceRoleKey.includes('your-service-role')
  ) {
    console.error(
      '❌ CONFIGURATION ERROR: Live integration testing could not be executed against a remote database.\n' +
      '   Reason: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing or contains placeholder values.\n' +
      '   Please configure real Supabase credentials in .env.local to run live database RLS tests.\n'
    );
    process.exit(1);
  }

  const adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const clientA = createClient<Database>(supabaseUrl, anonKey!);
  const clientB = createClient<Database>(supabaseUrl, anonKey!);

  const testSuffix = Math.random().toString(36).substring(2, 7);
  const emailA = `test-user-a-${testSuffix}@example.com`;
  const emailB = `test-user-b-${testSuffix}@example.com`;
  const password = `StrongP@ssw0rd_${testSuffix}!`;

  let userAId: string | null = null;
  let userBId: string | null = null;

  try {
    console.log(`1. Creating User A (${emailA}) and User B (${emailB})...`);

    // Provision User A
    const { data: userAData, error: errA } = await adminClient.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Test User A' },
    });
    if (errA || !userAData?.user) throw new Error(`Failed to create User A: ${errA?.message || 'No user data'}`);
    userAId = userAData.user.id;

    // Provision User B
    const { data: userBData, error: errB } = await adminClient.auth.admin.createUser({
      email: emailB,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Test User B' },
    });
    if (errB || !userBData?.user) throw new Error(`Failed to create User B: ${errB?.message || 'No user data'}`);
    userBId = userBData.user.id;

    console.log('2. Verifying trigger auto-provisioning of profiles, workspaces, memberships & redacted audit events...');

    // Verify profiles exist
    const { data: profA } = await adminClient.from('profiles').select('id, email, timezone').eq('id', userAId).single();
    const { data: profB } = await adminClient.from('profiles').select('id, email, timezone').eq('id', userBId).single();
    if (!profA || !profB) throw new Error('Profiles were not created by on_auth_user_created trigger!');
    if (profA.timezone !== 'Asia/Cairo' || profB.timezone !== 'Asia/Cairo') {
      throw new Error(`Profile timezone mismatch: A=${profA.timezone}, B=${profB.timezone}`);
    }

    // Verify workspaces exist
    const { data: wsA } = await adminClient
      .from('workspaces')
      .select('id, name, owner_id')
      .eq('owner_id', userAId)
      .single();

    const { data: wsB } = await adminClient
      .from('workspaces')
      .select('id, name, owner_id')
      .eq('owner_id', userBId)
      .single();

    if (!wsA || !wsB) throw new Error('Workspaces were not auto-provisioned by on_auth_user_created trigger!');
    console.log(`   User A Workspace: ${wsA.name} (${wsA.id})`);
    console.log(`   User B Workspace: ${wsB.name} (${wsB.id})`);

    // Verify owner membership role exists for each user
    const { data: memA } = await adminClient
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', wsA.id)
      .eq('user_id', userAId)
      .single();

    const { data: memB } = await adminClient
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', wsB.id)
      .eq('user_id', userBId)
      .single();

    if (memA?.role !== 'owner' || memB?.role !== 'owner') {
      throw new Error(`Owner membership role verification failed: User A role=${memA?.role}, User B role=${memB?.role}`);
    }
    console.log('   ✅ PASS: Both users have verified "owner" role in their personal workspaces.');

    // Verify newly auto-provisioned audit event contains NO plaintext user_email
    const { data: auditA, error: auditErrA } = await adminClient
      .from('audit_events')
      .select('*')
      .eq('workspace_id', wsA.id)
      .eq('event_type', 'workspace.auto_provisioned')
      .single();

    if (auditErrA || !auditA) {
      throw new Error(`Provisioning audit event was not found for Workspace A: ${auditErrA?.message}`);
    }
    const detailsA = auditA.details as Record<string, unknown> | null;
    if (detailsA && typeof detailsA === 'object' && 'user_email' in detailsA) {
      throw new Error('SECURITY VIOLATION: Auto-provisioned audit event details contain plaintext user_email!');
    }
    console.log('   ✅ PASS: Auto-provisioned audit event confirmed free of plaintext user_email.');

    console.log('3. Authenticating Client A and Client B...');
    const { error: loginErrA } = await clientA.auth.signInWithPassword({ email: emailA, password });
    if (loginErrA) throw new Error(`User A login failed: ${loginErrA.message}`);

    const { error: loginErrB } = await clientB.auth.signInWithPassword({ email: emailB, password });
    if (loginErrB) throw new Error(`User B login failed: ${loginErrB.message}`);

    console.log('4. User A creating, reading, and updating their own task in Workspace A (Positive Tenant Access)...');
    const { data: taskA, error: createErrA } = await clientA
      .from('tasks')
      .insert({
        workspace_id: wsA.id,
        title: 'Confidential Strategy Task A',
        priority: 'high',
        status: 'todo',
      })
      .select()
      .single();
    if (createErrA || !taskA) throw new Error(`User A task creation failed: ${createErrA?.message}`);

    // Positive read verification
    const { data: ownTaskA, error: readOwnErrA } = await clientA
      .from('tasks')
      .select('*')
      .eq('id', taskA.id)
      .single();
    if (readOwnErrA || !ownTaskA) throw new Error(`User A positive read failed: ${readOwnErrA?.message}`);

    // Positive update verification
    const { data: updatedTaskA, error: updateOwnErrA } = await clientA
      .from('tasks')
      .update({ description: 'Authorized strategy update by User A' })
      .eq('id', taskA.id)
      .select()
      .single();
    if (updateOwnErrA || updatedTaskA?.description !== 'Authorized strategy update by User A') {
      throw new Error(`User A positive update failed: ${updateOwnErrA?.message}`);
    }
    console.log(`   Task A verified (created, read, and updated by User A): "${taskA.title}" (${taskA.id})`);

    console.log('5. Testing Cross-Tenant Boundary: User B attempting to SELECT User A task...');
    const { data: readAttempt, error: readErr } = await clientB
      .from('tasks')
      .select('*')
      .eq('id', taskA.id)
      .maybeSingle();

    if (readErr) {
      throw new Error(`Unexpected query error during cross-tenant read attempt: ${readErr.message}`);
    }
    if (readAttempt !== null) {
      throw new Error('SECURITY VIOLATION: User B was able to read User A task across workspace boundary!');
    }
    console.log('   ✅ PASS: User B received 0 rows (RLS enforced read isolation).');

    console.log('6. Testing Cross-Tenant Boundary: User B attempting to UPDATE User A task...');
    const { data: updateAttempt, error: updateErr } = await clientB
      .from('tasks')
      .update({ title: 'Hacked by User B' })
      .eq('id', taskA.id)
      .select();

    if (updateErr) {
      throw new Error(`Unexpected query error during cross-tenant update attempt: ${updateErr.message}`);
    }
    if (updateAttempt && updateAttempt.length > 0) {
      throw new Error('SECURITY VIOLATION: User B was able to UPDATE User A task!');
    }
    console.log('   ✅ PASS: User B update matched 0 rows (RLS enforced update isolation).');

    console.log('7. Testing Cross-Tenant Boundary: User B attempting to INSERT a task into Workspace A...');
    const { error: insertViolation } = await clientB
      .from('tasks')
      .insert({
        workspace_id: wsA.id, // Trying to inject into Workspace A
        title: 'Unauthorized Task Injection',
        priority: 'low',
        status: 'todo',
      });

    if (!insertViolation) {
      throw new Error('SECURITY VIOLATION: User B successfully injected a task into Workspace A!');
    }
    const isRlsError = insertViolation.code === '42501' ||
                       insertViolation.message.toLowerCase().includes('row-level security') ||
                       insertViolation.message.toLowerCase().includes('violates');
    if (!isRlsError) {
      throw new Error(`Cross-tenant insert rejected for unexpected non-RLS reason: ${insertViolation.message} (code: ${insertViolation.code})`);
    }
    console.log(`   ✅ PASS: Unauthorized insertion rejected by RLS: "${insertViolation.message}".`);

    console.log('8. Testing Cross-Tenant Boundary: User B attempting to DELETE User A task...');
    const { data: deleteAttempt, error: deleteErr } = await clientB
      .from('tasks')
      .delete()
      .eq('id', taskA.id)
      .select();

    if (deleteErr) {
      throw new Error(`Unexpected query error during cross-tenant delete attempt: ${deleteErr.message}`);
    }
    if (deleteAttempt && deleteAttempt.length > 0) {
      throw new Error('SECURITY VIOLATION: User B was able to DELETE User A task!');
    }
    console.log('   ✅ PASS: Unauthorized deletion matched 0 rows (RLS enforced delete isolation).');

    console.log('9. User B creating and reading a legitimate task in Workspace B (Positive Tenant Access)...');
    const { data: taskB, error: createErrB } = await clientB
      .from('tasks')
      .insert({
        workspace_id: wsB.id,
        title: 'Legitimate Strategy Task B',
        priority: 'medium',
        status: 'todo',
      })
      .select()
      .single();
    if (createErrB || !taskB) throw new Error(`User B task creation failed: ${createErrB?.message}`);

    const { data: ownTaskB, error: readOwnErrB } = await clientB
      .from('tasks')
      .select('*')
      .eq('id', taskB.id)
      .single();
    if (readOwnErrB || !ownTaskB) throw new Error(`User B positive read failed: ${readOwnErrB?.message}`);
    console.log(`   Task B verified (created and read by User B): "${taskB.title}" (${taskB.id})`);

    console.log('10. Verifying User A task was not altered by any cross-tenant attempts...');
    const { data: finalTaskA } = await clientA
      .from('tasks')
      .select('title, description')
      .eq('id', taskA.id)
      .single();
    if (finalTaskA?.title !== 'Confidential Strategy Task A' || finalTaskA?.description !== 'Authorized strategy update by User A') {
      throw new Error('Task A data corruption detected after cross-tenant attack tests!');
    }
    console.log('   ✅ PASS: Task A integrity confirmed unaltered.');

    console.log('11. Verifying Audit Immutability: Ordinary UPDATE and DELETE attempts must be rejected...');
    if (!auditA?.id) {
      throw new Error('Precondition failed: Target audit event for immutability test is missing or has no ID.');
    }

    const expectedTriggerMessage = 'Audit events are immutable and cannot be updated or deleted.';
    const expectedErrorCode = 'P0001';

    // Attempt ordinary UPDATE on audit event via adminClient (service_role matches row directly)
    const { error: updateAuditErr } = await adminClient
      .from('audit_events')
      .update({ actor_id: 'tampered-actor-id' } as any)
      .eq('id', auditA.id);

    if (!updateAuditErr) {
      throw new Error('SECURITY VIOLATION: Ordinary UPDATE on audit_events was not rejected by immutability trigger!');
    }
    const hasExpectedUpdateMessage =
      updateAuditErr.message.includes(expectedTriggerMessage) ||
      updateAuditErr.message.toLowerCase().includes('audit events are immutable');
    const hasExpectedUpdateCode = updateAuditErr.code === expectedErrorCode;

    if (!hasExpectedUpdateMessage || !hasExpectedUpdateCode) {
      throw new Error(
        `Ordinary UPDATE failed with unexpected error instead of immutability trigger rejection.\n` +
        `   Expected message containing: "${expectedTriggerMessage}"\n` +
        `   Expected SQLSTATE code: "${expectedErrorCode}"\n` +
        `   Actual message: "${updateAuditErr.message}"\n` +
        `   Actual code: "${updateAuditErr.code}"`
      );
    }
    console.log(`   ✅ PASS: Ordinary UPDATE rejected by trigger: "${updateAuditErr.message}" (code: ${updateAuditErr.code}).`);

    // Attempt ordinary DELETE on audit event via adminClient
    const { error: deleteAuditErr } = await adminClient
      .from('audit_events')
      .delete()
      .eq('id', auditA.id);

    if (!deleteAuditErr) {
      throw new Error('SECURITY VIOLATION: Ordinary DELETE on audit_events was not rejected by immutability trigger!');
    }
    const hasExpectedDeleteMessage =
      deleteAuditErr.message.includes(expectedTriggerMessage) ||
      deleteAuditErr.message.toLowerCase().includes('audit events are immutable');
    const hasExpectedDeleteCode = deleteAuditErr.code === expectedErrorCode;

    if (!hasExpectedDeleteMessage || !hasExpectedDeleteCode) {
      throw new Error(
        `Ordinary DELETE failed with unexpected error instead of immutability trigger rejection.\n` +
        `   Expected message containing: "${expectedTriggerMessage}"\n` +
        `   Expected SQLSTATE code: "${expectedErrorCode}"\n` +
        `   Actual message: "${deleteAuditErr.message}"\n` +
        `   Actual code: "${deleteAuditErr.code}"`
      );
    }
    console.log(`   ✅ PASS: Ordinary DELETE rejected by trigger: "${deleteAuditErr.message}" (code: ${deleteAuditErr.code}).`);

    console.log('12. Verifying Workspace Disassociation: Deleting disposable workspace cascades to audit_events.workspace_id = NULL...');
    // Create a disposable workspace owned by User A specifically for deletion verification
    const dispSlug = `disp-ws-${Math.random().toString(36).substring(2, 7)}`;
    const { data: wsDisp, error: wsDispErr } = await adminClient
      .from('workspaces')
      .insert({
        name: 'Disposable Audit Lifecycle Workspace',
        slug: dispSlug,
        owner_id: userAId,
      })
      .select()
      .single();

    if (wsDispErr || !wsDisp) {
      throw new Error(`Failed to create disposable test workspace: ${wsDispErr?.message}`);
    }

    // Insert a test audit event associated with the disposable workspace
    const { data: dispAudit, error: dispAuditErr } = await adminClient
      .from('audit_events')
      .insert({
        workspace_id: wsDisp.id,
        actor_type: 'user',
        actor_id: userAId,
        event_type: 'test.disassociation',
        entity_type: 'workspace',
        entity_id: wsDisp.id,
        details: { test_purpose: 'workspace_deletion_cascade' },
      })
      .select()
      .single();

    if (dispAuditErr || !dispAudit) {
      throw new Error(`Failed to insert test audit event: ${dispAuditErr?.message}`);
    }

    // Precondition Checks: Validate disposable audit event before attempting workspace deletion
    if (!dispAudit.id) {
      throw new Error('PRECONDITION FAILURE: Disposable audit event has no usable ID.');
    }
    if (dispAudit.workspace_id !== wsDisp.id) {
      throw new Error(
        `PRECONDITION FAILURE: Disposable audit event workspace_id mismatch: expected "${wsDisp.id}", got "${dispAudit.workspace_id}".`
      );
    }
    console.log(`   Disposable audit event verified attached to workspace (${dispAudit.id} -> ${wsDisp.id}).`);

    // Delete the disposable workspace
    const { error: delDispWsErr } = await adminClient
      .from('workspaces')
      .delete()
      .eq('id', wsDisp.id);

    if (delDispWsErr) {
      throw new Error(`Deleting disposable workspace failed: ${delDispWsErr.message}`);
    }
    console.log('   ✅ PASS: Disposable workspace deleted successfully.');

    // Verify surviving audit event exists and has workspace_id = NULL
    const { data: survivingAudit, error: survErr } = await adminClient
      .from('audit_events')
      .select('*')
      .eq('id', dispAudit.id)
      .single();

    if (survErr || !survivingAudit) {
      throw new Error(`Failed to fetch audit event after workspace deletion: ${survErr?.message}`);
    }
    if (survivingAudit.workspace_id !== null) {
      throw new Error(`Expected surviving audit_events.workspace_id to be NULL, but got ${survivingAudit.workspace_id}`);
    }
    console.log('   ✅ PASS: Surviving audit event has workspace_id = NULL.');

    // Verify all other columns remain strictly unchanged
    if (
      survivingAudit.id !== dispAudit.id ||
      survivingAudit.actor_type !== dispAudit.actor_type ||
      survivingAudit.actor_id !== dispAudit.actor_id ||
      survivingAudit.event_type !== dispAudit.event_type ||
      survivingAudit.entity_type !== dispAudit.entity_type ||
      survivingAudit.entity_id !== dispAudit.entity_id ||
      JSON.stringify(survivingAudit.details) !== JSON.stringify(dispAudit.details) ||
      survivingAudit.ip_address !== dispAudit.ip_address ||
      survivingAudit.user_agent !== dispAudit.user_agent ||
      survivingAudit.created_at !== dispAudit.created_at
    ) {
      throw new Error('SECURITY VIOLATION: Non-workspace fields in audit event were mutated during disassociation cascade!');
    }
    console.log('   ✅ PASS: All other audit event fields confirmed unaltered during disassociation.');

    console.log('\n🎉 ALL LIVE DATABASE MULTI-TENANT & AUDIT LIFECYCLE CHECKS PASSED!\n');
  } finally {
    console.log('\nCleaning up test users and workspaces...');
    const cleanupErrors: string[] = [];

    // Stage 1: Delete workspaces owned by test users first (cascading tasks, memberships, and disassociating audit events)
    if (userAId) {
      try {
        const { error: wsDelErrA } = await adminClient.from('workspaces').delete().eq('owner_id', userAId);
        if (wsDelErrA) cleanupErrors.push(`User A workspace cleanup failed: ${wsDelErrA.message}`);
      } catch (err) {
        cleanupErrors.push(`User A workspace cleanup exception: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (userBId) {
      try {
        const { error: wsDelErrB } = await adminClient.from('workspaces').delete().eq('owner_id', userBId);
        if (wsDelErrB) cleanupErrors.push(`User B workspace cleanup failed: ${wsDelErrB.message}`);
      } catch (err) {
        cleanupErrors.push(`User B workspace cleanup exception: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Stage 2: Delete auth users (cascades to profiles, now unblocked by prior workspace deletion)
    if (userAId) {
      try {
        const { error: delErrA } = await adminClient.auth.admin.deleteUser(userAId);
        if (delErrA) cleanupErrors.push(`User A auth user cleanup failed: ${delErrA.message}`);
      } catch (err) {
        cleanupErrors.push(`User A auth user cleanup exception: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (userBId) {
      try {
        const { error: delErrB } = await adminClient.auth.admin.deleteUser(userBId);
        if (delErrB) cleanupErrors.push(`User B auth user cleanup failed: ${delErrB.message}`);
      } catch (err) {
        cleanupErrors.push(`User B auth user cleanup exception: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (cleanupErrors.length > 0) {
      console.error('\n❌ Cleanup encountered errors:\n' + cleanupErrors.join('\n'));
      throw new Error(`Test cleanup failed:\n${cleanupErrors.join('\n')}`);
    } else {
      console.log('Cleanup complete. All test workspaces and Auth users removed cleanly.');
    }
  }
}

runLiveDatabaseAudit().catch((err) => {
  console.error('\n❌ LIVE DATABASE AUDIT FAILED:', err);
  process.exit(1);
});
