/**
 * ==============================================================================
 * Live Database Integration Test Script (Two-Tenant RLS Verification)
 * ==============================================================================
 * 
 * Usage:
 *   npx tsx scripts/test-database-rls.ts
 * 
 * Prerequisites:
 *   - A live, disposable Supabase project with 20261028000001_initial_schema.sql applied.
 *   - Real SUPABASE_URL, ANON_KEY, and SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';

async function runLiveDatabaseAudit() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.log('\n=== Real Database Multi-Tenant RLS Integration Test ===\n');

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    supabaseUrl.includes('your-project-ref') ||
    serviceRoleKey.includes('your-service-role')
  ) {
    console.warn(
      '⚠️  LIMITATION REPORT: Live integration testing could not be executed against a remote database.\n' +
      '   Reason: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured with a live instance.\n' +
      '   Per Phase 1.1 instructions, this limitation is explicitly noted.\n' +
      '   Unit tests simulate these policies, but real PostgreSQL RLS requires applying the migration\n' +
      '   to a disposable Supabase instance and providing live credentials.\n'
    );
    process.exit(0);
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

  console.log(`1. Creating User A (${emailA}) and User B (${emailB})...`);

  // Provision User A
  const { data: userAData, error: errA } = await adminClient.auth.admin.createUser({
    email: emailA,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Test User A' },
  });
  if (errA) throw new Error(`Failed to create User A: ${errA.message}`);

  // Provision User B
  const { data: userBData, error: errB } = await adminClient.auth.admin.createUser({
    email: emailB,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Test User B' },
  });
  if (errB) throw new Error(`Failed to create User B: ${errB.message}`);

  try {
    console.log('2. Verifying trigger auto-provisioning of personal workspaces...');
    const { data: wsA } = await adminClient
      .from('workspaces')
      .select('id, name')
      .eq('owner_id', userAData.user.id)
      .single();

    const { data: wsB } = await adminClient
      .from('workspaces')
      .select('id, name')
      .eq('owner_id', userBData.user.id)
      .single();

    if (!wsA || !wsB) throw new Error('Workspaces were not auto-provisioned by on_auth_user_created trigger!');
    console.log(`   User A Workspace: ${wsA.name} (${wsA.id})`);
    console.log(`   User B Workspace: ${wsB.name} (${wsB.id})`);

    console.log('3. Authenticating Client A and Client B...');
    const { error: loginErrA } = await clientA.auth.signInWithPassword({ email: emailA, password });
    if (loginErrA) throw new Error(`User A login failed: ${loginErrA.message}`);

    const { error: loginErrB } = await clientB.auth.signInWithPassword({ email: emailB, password });
    if (loginErrB) throw new Error(`User B login failed: ${loginErrB.message}`);

    console.log('4. User A creating a private task in Workspace A...');
    const { data: taskA, error: createErr } = await clientA
      .from('tasks')
      .insert({
        workspace_id: wsA.id,
        title: 'Confidential Strategy Task A',
        priority: 'high',
        status: 'todo',
      })
      .select()
      .single();
    if (createErr) throw new Error(`User A task creation failed: ${createErr.message}`);
    console.log(`   Task created: "${taskA.title}" (${taskA.id})`);

    console.log('5. Testing Cross-Tenant Boundary: User B attempting to SELECT User A task...');
    const { data: readAttempt } = await clientB
      .from('tasks')
      .select('*')
      .eq('id', taskA.id)
      .maybeSingle();

    if (readAttempt !== null) {
      throw new Error('SECURITY VIOLATION: User B was able to read User A task across workspace boundary!');
    }
    console.log('   ✅ PASS: User B received 0 rows (RLS enforced isolation).');

    console.log('6. Testing Cross-Tenant Boundary: User B attempting to UPDATE User A task...');
    const { data: updateAttempt } = await clientB
      .from('tasks')
      .update({ title: 'Hacked by User B' })
      .eq('id', taskA.id)
      .select();

    if (updateAttempt && updateAttempt.length > 0) {
      throw new Error('SECURITY VIOLATION: User B was able to UPDATE User A task!');
    }
    console.log('   ✅ PASS: User B update was rejected / matched 0 rows.');

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
    console.log(`   ✅ PASS: Unauthorized insertion rejected by RLS: "${insertViolation.message}".`);

    console.log('8. Testing Cross-Tenant Boundary: User B attempting to DELETE User A task...');
    const { data: deleteAttempt } = await clientB
      .from('tasks')
      .delete()
      .eq('id', taskA.id)
      .select();

    if (deleteAttempt && deleteAttempt.length > 0) {
      throw new Error('SECURITY VIOLATION: User B was able to DELETE User A task!');
    }
    console.log('   ✅ PASS: Unauthorized deletion was rejected by RLS.');

    console.log('\n🎉 ALL LIVE DATABASE MULTI-TENANT ISOLATION CHECKS PASSED!\n');
  } finally {
    console.log('Cleaning up test users...');
    await adminClient.auth.admin.deleteUser(userAData.user.id);
    await adminClient.auth.admin.deleteUser(userBData.user.id);
    console.log('Cleanup complete.');
  }
}

runLiveDatabaseAudit().catch((err) => {
  console.error('\n❌ LIVE DATABASE AUDIT FAILED:', err);
  process.exit(1);
});
