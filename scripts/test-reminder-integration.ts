/**
 * ==============================================================================
 * Safe Staging Database Integration Test Script for Reminder Automation
 * ==============================================================================
 * 
 * Safety & Isolation Guarantees:
 *   1. Dedicated Target Isolation:
 *      Refuses to run unless STAGING_SUPABASE_URL, STAGING_SERVICE_ROLE_KEY,
 *      EXPECTED_STAGING_PROJECT_REF, and CONFIRM_DISPOSABLE_DATABASE=true are
 *      explicitly supplied.
 *   2. Hostname Validation:
 *      Validates that STAGING_SUPABASE_URL matches a recognizable remote Supabase
 *      domain (*.supabase.co) and matches EXPECTED_STAGING_PROJECT_REF exactly.
 *      Rejects localhost, 127.0.0.1, or placeholder strings before creating clients.
 *   3. No Production Fallback:
 *      Never falls back to NEXT_PUBLIC_SUPABASE_URL or .env.local credentials.
 *   4. Scoped Cleanup by Captured IDs:
 *      Tracks every created Auth user, workspace, and task by exact ID. Never uses
 *      broad pattern deletions. Exits with failure if any cleanup step fails.
 *   5. Step Isolation:
 *      Cleans up transient tasks (e.g. opt-out task) before moving to subsequent
 *      checks, preventing un-notified fixture leakage across test steps.
 * 
 * Usage:
 *   STAGING_SUPABASE_URL="https://<ref>.supabase.co" \
 *   STAGING_SERVICE_ROLE_KEY="<key>" \
 *   EXPECTED_STAGING_PROJECT_REF="<ref>" \
 *   CONFIRM_DISPOSABLE_DATABASE="true" \
 *   npm run test:reminders:db
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';
import { processUpcomingTaskReminders } from '../src/lib/services/reminder-service';

export interface StagingEnvironmentConfig {
  stagingUrl: string;
  serviceRoleKey: string;
  projectRef: string;
}

/**
 * Validates staging environment configuration strictly before any client creation
 * or network request is attempted. Fails closed if any requirement is unmet.
 */
export function validateStagingEnvironment(
  env: Record<string, string | undefined> = process.env
): StagingEnvironmentConfig {
  const stagingUrl = env.STAGING_SUPABASE_URL?.trim();
  const serviceRoleKey = env.STAGING_SERVICE_ROLE_KEY?.trim();
  const expectedRef = env.EXPECTED_STAGING_PROJECT_REF?.trim();
  const confirmDisposable = env.CONFIRM_DISPOSABLE_DATABASE?.trim();

  // 1. Explicit opt-in confirmation check
  if (confirmDisposable !== 'true') {
    throw new Error(
      'Target selection rejected: CONFIRM_DISPOSABLE_DATABASE must be explicitly set to "true". ' +
      'This guard prevents accidental execution against non-disposable environments.'
    );
  }

  // 2. Required dedicated environment variables check
  if (!stagingUrl) {
    throw new Error('Target selection rejected: STAGING_SUPABASE_URL is missing.');
  }

  if (!serviceRoleKey) {
    throw new Error('Target selection rejected: STAGING_SERVICE_ROLE_KEY is missing.');
  }

  if (!expectedRef) {
    throw new Error('Target selection rejected: EXPECTED_STAGING_PROJECT_REF is missing.');
  }

  // 3. Reject placeholders
  if (
    stagingUrl.includes('your-project-ref') ||
    stagingUrl.includes('your-staging-ref') ||
    serviceRoleKey.includes('your-service-role') ||
    serviceRoleKey.includes('your-staging-service-role')
  ) {
    throw new Error('Target selection rejected: STAGING credentials contain template placeholder values.');
  }

  // 4. Validate URL syntax
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(stagingUrl);
  } catch {
    throw new Error('Target selection rejected: STAGING_SUPABASE_URL is not a valid URL.');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Target selection rejected: STAGING_SUPABASE_URL must use https protocol.');
  }

  // 5. Reject localhost / local IP addresses
  const hostname = parsedUrl.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local')
  ) {
    throw new Error('Target selection rejected: Localhost and local IP targets are not permitted.');
  }

  // 6. Validate Supabase project hostname pattern (<ref>.supabase.co)
  const supabaseHostPattern = /^([a-z0-9]{20})\.supabase\.co$/i;
  const match = hostname.match(supabaseHostPattern);

  if (!match) {
    throw new Error(
      'Target selection rejected: STAGING_SUPABASE_URL hostname must match "<ref>.supabase.co" with a 20-character project ref.'
    );
  }

  const extractedProjectRef = match[1].toLowerCase();

  // 7. Verify project reference matches EXPECTED_STAGING_PROJECT_REF
  if (extractedProjectRef !== expectedRef.toLowerCase()) {
    throw new Error(
      `Target selection rejected: URL project reference ("${extractedProjectRef}") does not match EXPECTED_STAGING_PROJECT_REF ("${expectedRef}").`
    );
  }

  return {
    stagingUrl,
    serviceRoleKey,
    projectRef: extractedProjectRef,
  };
}

export async function runStagingReminderVerification() {
  console.log('\n================================================================');
  console.log('   Reminder Engine Safe Staging / Database Integration Test');
  console.log('================================================================\n');

  // FAIL-CLOSED GUARD: Validates all requirements before initializing Supabase client
  const config = validateStagingEnvironment(process.env);

  console.log(`[Target Verified] Dedicated Staging Project Ref: ${config.projectRef}`);
  console.log('Target database is confirmed disposable. Initializing administrative client...\n');

  const adminClient: SupabaseClient<Database> = createClient<Database>(
    config.stagingUrl,
    config.serviceRoleKey,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );

  // ----------------------------------------------------------------------------
  // Pre-flight Check: Verify Migration 20261029000001 is Applied
  // ----------------------------------------------------------------------------
  console.log('Checking database schema prerequisites...');

  const { error: prefTableCheck } = await adminClient
    .from('notification_preferences')
    .select('id')
    .limit(1);

  if (prefTableCheck) {
    console.warn(
      '\n⚠️  MIGRATION PREREQUISITE PENDING:\n' +
      '   Table "public.notification_preferences" does not exist in the target database.\n' +
      '   Postgres Error: ' + prefTableCheck.message + '\n\n' +
      '   To run this integration test, apply migration:\n' +
      '   "supabase/migrations/20261029000001_notification_system_enhancements.sql"\n' +
      '   to your disposable staging database first.\n'
    );
    process.exit(1);
  }

  const testSuffix = Math.random().toString(36).substring(2, 8);
  const emailA = `test-reminder-owner-${testSuffix}@example.com`;
  const emailB = `test-reminder-external-${testSuffix}@example.com`;
  const password = `Str0ngP@ssw0rd_${testSuffix}!`;

  // Scoped resource tracking by exact IDs for reliable cleanup
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdTaskIds: string[] = [];

  let workspaceAId: string | null = null;
  let workspaceBId: string | null = null;
  let userAId: string | null = null;
  let userBId: string | null = null;

  try {
    // --------------------------------------------------------------------------
    // 1. Provision Ephemeral Test Users & Workspaces
    // --------------------------------------------------------------------------
    console.log(`\n1. Creating isolated test users (User A & User B)...`);

    const { data: userAData, error: errA } = await adminClient.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Staging Test User A' },
    });
    if (errA || !userAData?.user) throw new Error(`Failed to create User A: ${errA?.message}`);
    userAId = userAData.user.id;
    createdUserIds.push(userAId);

    const { data: userBData, error: errB } = await adminClient.auth.admin.createUser({
      email: emailB,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Staging Test User B (External)' },
    });
    if (errB || !userBData?.user) throw new Error(`Failed to create User B: ${errB?.message}`);
    userBId = userBData.user.id;
    createdUserIds.push(userBId);

    // Fetch the auto-provisioned workspaces and capture IDs immediately
    const { data: wsA, error: wsAErr } = await adminClient
      .from('workspaces')
      .select('id, name')
      .eq('owner_id', userAId)
      .single();
    if (wsAErr || !wsA) throw new Error(`Failed to query Workspace A: ${wsAErr?.message}`);
    workspaceAId = wsA.id;
    createdWorkspaceIds.push(workspaceAId);

    const { data: wsB, error: wsBErr } = await adminClient
      .from('workspaces')
      .select('id, name')
      .eq('owner_id', userBId)
      .single();
    if (wsBErr || !wsB) throw new Error(`Failed to query Workspace B: ${wsBErr?.message}`);
    workspaceBId = wsB.id;
    createdWorkspaceIds.push(workspaceBId);

    console.log(`   ✓ Provisioned Workspace A: ${wsA.name} (${wsA.id})`);
    console.log(`   ✓ Provisioned Workspace B: ${wsB.name} (${wsB.id})`);

    const now = new Date();
    // --------------------------------------------------------------------------
    // 2. Upcoming Task Reminder Creation
    // --------------------------------------------------------------------------
    console.log('\n2. Testing upcoming task reminder creation...');
    const dueDate = new Date(now.getTime() + 45 * 60 * 1000).toISOString();

    const { data: task1, error: task1Err } = await adminClient
      .from('tasks')
      .insert({
        workspace_id: workspaceAId,
        title: `Staging Verification Task 1 (${testSuffix})`,
        status: 'todo',
        due_date: dueDate,
        assigned_to: userAId,
        created_by: userAId,
      })
      .select()
      .single();

    if (task1Err || !task1) throw new Error(`Failed to insert task 1: ${task1Err?.message}`);
    createdTaskIds.push(task1.id);

    const run1 = await processUpcomingTaskReminders(adminClient, {
      workspaceId: workspaceAId,
      referenceTime: now,
    });

    if (run1.created !== 1) {
      throw new Error(`Expected exactly 1 upcoming task notification created, got ${run1.created}`);
    }

    const { data: notifs1 } = await adminClient
      .from('notifications')
      .select('id, title, status, idempotency_key, entity_id')
      .eq('workspace_id', workspaceAId)
      .eq('recipient_id', userAId)
      .eq('entity_id', task1.id);

    if (!notifs1 || notifs1.length !== 1) {
      throw new Error(`Expected exactly 1 notification row in database, found ${notifs1?.length ?? 0}`);
    }
    console.log(`   ✓ Created 1 notification: "${notifs1[0].title}" (Key: ${notifs1[0].idempotency_key})`);

    // --------------------------------------------------------------------------
    // 3. Idempotency & Duplicate Prevention
    // --------------------------------------------------------------------------
    console.log('\n3. Testing idempotency on repeated execution...');
    const run2 = await processUpcomingTaskReminders(adminClient, {
      workspaceId: workspaceAId,
      referenceTime: now,
    });

    if (run2.created !== 0 || run2.duplicates !== 1) {
      throw new Error(`Expected 0 created and 1 duplicate on rerun, got created=${run2.created}, duplicates=${run2.duplicates}`);
    }

    const { data: notifsAfterRerun } = await adminClient
      .from('notifications')
      .select('id')
      .eq('workspace_id', workspaceAId)
      .eq('recipient_id', userAId)
      .eq('entity_id', task1.id);

    if (notifsAfterRerun?.length !== 1) {
      throw new Error(`Duplicate notification was created in database! Total count=${notifsAfterRerun?.length}`);
    }
    console.log('   ✓ Idempotency verified: re-running created 0 duplicates (total persisted = 1).');

    // --------------------------------------------------------------------------
    // 4. Opted-Out User Preferences (Isolated Check)
    // --------------------------------------------------------------------------
    console.log('\n4. Testing user preference opt-out enforcement...');
    const { error: prefUpsertErr } = await adminClient
      .from('notification_preferences')
      .upsert(
        {
          workspace_id: workspaceAId,
          user_id: userAId,
          notify_upcoming_tasks: false, // disabled
          in_app_notifications_enabled: true,
        },
        { onConflict: 'workspace_id,user_id' }
      );

    if (prefUpsertErr) throw new Error(`Failed to update preferences: ${prefUpsertErr.message}`);

    const { data: taskOptOut, error: taskOptErr } = await adminClient
      .from('tasks')
      .insert({
        workspace_id: workspaceAId,
        title: `Staging Opt-Out Task (${testSuffix})`,
        status: 'todo',
        due_date: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
        assigned_to: userAId,
        created_by: userAId,
      })
      .select()
      .single();

    if (taskOptErr || !taskOptOut) throw new Error(`Failed to insert opt-out task: ${taskOptErr?.message}`);
    createdTaskIds.push(taskOptOut.id);

    const runOptOut = await processUpcomingTaskReminders(adminClient, {
      workspaceId: workspaceAId,
      referenceTime: now,
    });

    if (runOptOut.created !== 0) {
      throw new Error(`Expected opted-out task created count to be 0, got ${runOptOut.created}`);
    }

    // Verify directly in database that NO notification row was created for taskOptOut
    const { data: optOutNotifs, error: optNotifErr } = await adminClient
      .from('notifications')
      .select('id')
      .eq('entity_id', taskOptOut.id);

    if (optNotifErr) throw new Error(`Failed to check opt-out notifications: ${optNotifErr.message}`);
    if (optOutNotifs && optOutNotifs.length > 0) {
      throw new Error(`Opted-out user incorrectly received ${optOutNotifs.length} notification(s)!`);
    }

    // FIX 3: Remove opt-out task immediately to prevent leaking into subsequent checks
    const { error: optDelErr } = await adminClient.from('tasks').delete().eq('id', taskOptOut.id);
    if (optDelErr) throw new Error(`Failed to remove opt-out task fixture: ${optDelErr.message}`);
    const optTaskIdx = createdTaskIds.indexOf(taskOptOut.id);
    if (optTaskIdx !== -1) createdTaskIds.splice(optTaskIdx, 1);

    // Restore preference to true
    const { error: prefRestoreErr } = await adminClient
      .from('notification_preferences')
      .upsert(
        {
          workspace_id: workspaceAId,
          user_id: userAId,
          notify_upcoming_tasks: true,
          in_app_notifications_enabled: true,
        },
        { onConflict: 'workspace_id,user_id' }
      );
    if (prefRestoreErr) throw new Error(`Failed to restore preferences: ${prefRestoreErr.message}`);

    console.log('   ✓ Opt-out verified: user with notify_upcoming_tasks = false received no reminder, fixture cleaned.');

    // --------------------------------------------------------------------------
    // 5. Completed Tasks Excluded
    // --------------------------------------------------------------------------
    console.log('\n5. Testing completed tasks exclusion...');
    const { data: taskDone, error: taskDoneErr } = await adminClient
      .from('tasks')
      .insert({
        workspace_id: workspaceAId,
        title: `Staging Completed Task (${testSuffix})`,
        status: 'done',
        completed_at: new Date().toISOString(),
        due_date: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
        assigned_to: userAId,
        created_by: userAId,
      })
      .select()
      .single();

    if (taskDoneErr || !taskDone) throw new Error(`Failed to insert completed task: ${taskDoneErr?.message}`);
    createdTaskIds.push(taskDone.id);

    const runDone = await processUpcomingTaskReminders(adminClient, {
      workspaceId: workspaceAId,
      referenceTime: now,
    });

    if (runDone.created !== 0) {
      throw new Error(`Expected 0 created notifications during completed task check, got ${runDone.created}`);
    }

    const { data: doneNotifs, error: doneNotifErr } = await adminClient
      .from('notifications')
      .select('id')
      .eq('entity_id', taskDone.id);

    if (doneNotifErr) throw new Error(`Failed to query done task notifications: ${doneNotifErr.message}`);
    if (doneNotifs && doneNotifs.length > 0) {
      throw new Error('Completed task incorrectly received a notification!');
    }

    // Clean up taskDone fixture immediately
    const { error: doneDelErr } = await adminClient.from('tasks').delete().eq('id', taskDone.id);
    if (doneDelErr) throw new Error(`Failed to delete completed task fixture: ${doneDelErr.message}`);
    const doneTaskIdx = createdTaskIds.indexOf(taskDone.id);
    if (doneTaskIdx !== -1) createdTaskIds.splice(doneTaskIdx, 1);

    console.log('   ✓ Completed task verified: status = "done" tasks are excluded from reminder queries.');

    // --------------------------------------------------------------------------
    // 6. Rescheduled Deadline Creates New Reminder
    // --------------------------------------------------------------------------
    console.log('\n6. Testing rescheduled deadline handling...');
    const rescheduledDueDate = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    const { error: updateErr } = await adminClient
      .from('tasks')
      .update({ due_date: rescheduledDueDate })
      .eq('id', task1.id);
    if (updateErr) throw new Error(`Failed to reschedule task 1: ${updateErr.message}`);

    const futureClock = new Date(new Date(rescheduledDueDate).getTime() - 30 * 60 * 1000);
    const runRescheduled = await processUpcomingTaskReminders(adminClient, {
      workspaceId: workspaceAId,
      referenceTime: futureClock,
    });

    if (runRescheduled.created !== 1) {
      throw new Error(`Expected rescheduled deadline to create 1 new notification, got ${runRescheduled.created}`);
    }

    const { data: rescheduledNotifs } = await adminClient
      .from('notifications')
      .select('id, idempotency_key')
      .eq('workspace_id', workspaceAId)
      .eq('entity_id', task1.id);

    if (!rescheduledNotifs || rescheduledNotifs.length !== 2) {
      throw new Error(`Expected exactly 2 notifications total for rescheduled task, found ${rescheduledNotifs?.length}`);
    }
    console.log(`   ✓ Rescheduling verified: second reminder generated for updated deadline (total = 2).`);

    // --------------------------------------------------------------------------
    // 7. Non-Workspace Recipient Rejection (Strengthened Check)
    // --------------------------------------------------------------------------
    console.log('\n7. Testing cross-workspace security boundary...');
    const { data: taskForeign, error: foreignErr } = await adminClient
      .from('tasks')
      .insert({
        workspace_id: workspaceAId,
        title: `Cross-Workspace Test Task (${testSuffix})`,
        status: 'todo',
        due_date: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
        assigned_to: userBId, // Member of Workspace B, NOT Workspace A
        created_by: userAId,
      })
      .select()
      .single();

    if (foreignErr || !taskForeign) throw new Error(`Failed to create foreign task: ${foreignErr?.message}`);
    createdTaskIds.push(taskForeign.id);

    const runForeign = await processUpcomingTaskReminders(adminClient, {
      workspaceId: workspaceAId,
      referenceTime: now,
    });

    // FIX 4: Assert 0 created notifications and verified membership rejection
    if (runForeign.created !== 0) {
      throw new Error(`Expected 0 created notifications for foreign task, got ${runForeign.created}`);
    }

    const hasExpectedRejection = runForeign.errorMessages.some(
      (msg) => msg.includes(taskForeign.id) && msg.includes('is not an active member of workspace')
    );

    if (!hasExpectedRejection) {
      throw new Error(
        `Expected workspace membership error not found in errorMessages:\n${runForeign.errorMessages.join('\n')}`
      );
    }

    const { data: foreignNotifs } = await adminClient
      .from('notifications')
      .select('id')
      .eq('entity_id', taskForeign.id);

    if (foreignNotifs && foreignNotifs.length > 0) {
      throw new Error('Security boundary breached: User B received notification in unauthorized workspace!');
    }

    // Clean up taskForeign fixture.
    // Keep it in createdTaskIds unless deletion succeeds, so finally can retry.
    const { error: foreignTaskDeleteError } = await adminClient
      .from('tasks')
      .delete()
      .eq('id', taskForeign.id);

    if (foreignTaskDeleteError) {
      throw new Error(
        `Failed to remove foreign task fixture: ${foreignTaskDeleteError.message}`
      );
    }

    const foreignIdx = createdTaskIds.indexOf(taskForeign.id);
    if (foreignIdx !== -1) createdTaskIds.splice(foreignIdx, 1);

    console.log('   ✓ Security boundary verified: non-workspace member safely rejected, no notification delivered.');

    console.log('\n================================================================');
    console.log('   ✅ ALL 7 STAGING INTEGRATION CHECKS PASSED SUCCESSFULLY');
    console.log('================================================================\n');
  } finally {
    // --------------------------------------------------------------------------
    // 8. Reliable, Scoped Teardown
    // --------------------------------------------------------------------------
    console.log('Executing scoped teardown of tracked resources...');
    const cleanupErrors: string[] = [];

    // Stage A: Delete explicitly created tasks by captured ID
    for (const taskId of createdTaskIds) {
      try {
        const { error } = await adminClient.from('tasks').delete().eq('id', taskId);
        if (error) cleanupErrors.push(`Failed to delete task ${taskId}: ${error.message}`);
      } catch (err) {
        cleanupErrors.push(`Exception deleting task ${taskId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Stage B: Delete notifications in test workspaces
    for (const wsId of createdWorkspaceIds) {
      try {
        const { error } = await adminClient.from('notifications').delete().eq('workspace_id', wsId);
        if (error) cleanupErrors.push(`Failed to delete notifications in workspace ${wsId}: ${error.message}`);
      } catch (err) {
        cleanupErrors.push(`Exception deleting notifications in workspace ${wsId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Stage C: Delete preferences in test workspaces
    for (const wsId of createdWorkspaceIds) {
      try {
        const { error } = await adminClient.from('notification_preferences').delete().eq('workspace_id', wsId);
        if (error) cleanupErrors.push(`Failed to delete preferences in workspace ${wsId}: ${error.message}`);
      } catch (err) {
        cleanupErrors.push(`Exception deleting preferences in workspace ${wsId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Stage D: Attempt deletion of created workspaces by exact ID
    for (const wsId of createdWorkspaceIds) {
      try {
        const { error } = await adminClient.from('workspaces').delete().eq('id', wsId);
        if (error) {
          cleanupErrors.push(`Failed to delete workspace ${wsId}: ${error.message}`);
        }
      } catch (err) {
        cleanupErrors.push(`Exception deleting workspace ${wsId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Stage E: Attempt deletion of created Auth users by exact ID
    for (const userId of createdUserIds) {
      try {
        const { error } = await adminClient.auth.admin.deleteUser(userId);
        if (error) {
          cleanupErrors.push(`Failed to delete auth user ${userId}: ${error.message}`);
        }
      } catch (err) {
        cleanupErrors.push(`Exception deleting auth user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // FIX 2: Ensure failure if cleanup encountered errors
    if (cleanupErrors.length > 0) {
      console.error('\n❌ CLEANUP ERRORS DETECTED:');
      cleanupErrors.forEach((e) => console.error('   - ' + e));
      throw new Error(`Integration test teardown incomplete (${cleanupErrors.length} failure(s)):\n${cleanupErrors.join('\n')}`);
    } else {
      console.log('✓ Teardown complete. All tracked test resources removed cleanly.\n');
    }
  }
}

// Execute only when run directly from CLI
if (
  process.argv[1] &&
  (process.argv[1].endsWith('test-reminder-integration.ts') || process.argv[1].endsWith('test-reminder-integration.js'))
) {
  runStagingReminderVerification().catch((err) => {
    console.error('\n❌ STAGING INTEGRATION TEST FAILED:', err);
    process.exit(1);
  });
}
