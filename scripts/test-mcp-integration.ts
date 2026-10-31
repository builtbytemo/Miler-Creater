/**
 * ==============================================================================
 * Safe Staging Database Integration Test Script for Model Context Protocol (MCP)
 * ==============================================================================
 * 
 * Safety & Isolation Guarantees:
 *   1. Dedicated Target Isolation:
 *      Refuses to run unless STAGING_SUPABASE_URL, STAGING_SERVICE_ROLE_KEY,
 *      EXPECTED_STAGING_PROJECT_REF, and CONFIRM_DISPOSABLE_DATABASE=true are
 *      explicitly supplied. Never falls back to .env.local or production credentials.
 *   2. Hostname & Ref Validation:
 *      Validates that STAGING_SUPABASE_URL matches "<ref>.supabase.co" and matches
 *      EXPECTED_STAGING_PROJECT_REF exactly. Rejects localhost, IPs, and placeholders.
 *   3. Ambient Environment Purge:
 *      Purges ambient NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to
 *      prevent accidental database cross-talk before validating staging guards.
 *   4. Direct Injection & Assertion:
 *      Constructs the authoritative staging admin client explicitly and passes it
 *      directly to handleMcpRequest(), ensuring createAdminClient() target alignment.
 *   5. Full Lifecycle & Scoped Cleanup:
 *      Tracks all created users, workspaces, and tasks by exact ID. Cleans them up in
 *      strict reverse-dependency order inside a guaranteed finally block.
 *   6. Audit Ledger Immutability:
 *      Accounts for immutable audit_events. Never attempts to delete or alter audit rows.
 *      Verifies workspace disassociation (workspace_id = NULL) after workspace deletion.
 *   7. Resilient Teardown:
 *      Does not call process.exit(1) inside finally. Collects cleanup errors, reports
 *      any uncleaned IDs, completes all possible teardowns, and sets exitCode after cleanup.
 * 
 * Usage:
 *   tsx --env-file=.env.staging.local scripts/test-mcp-integration.ts
 *   or:
 *   npm run test:mcp:db
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';
import { validateStagingEnvironment } from './test-reminder-integration';
import { createAdminClient } from '../src/lib/supabase/admin';
import { createAiToken, revokeAiToken } from '../src/lib/mcp/token-service';
import { authenticateAiToken } from '../src/lib/mcp/auth';
import { checkTokenRateLimit } from '../src/lib/mcp/rate-limiter';
import { handleMcpRequest } from '../src/app/api/mcp/route';
import { hashAiToken } from '../src/lib/ai/tokens';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export async function runLiveMcpVerification(env: Record<string, string | undefined> = process.env) {
  console.log('\n================================================================');
  console.log('   Model Context Protocol (MCP) Safe Staging Integration Test');
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // PHASE 1: ENVIRONMENT ISOLATION & STAGING TARGET GUARD
  // ---------------------------------------------------------------------------
  console.log('1. Validating staging environment and enforcing isolation guards...');

  // Purge ambient credentials from environment to prevent accidental fallback
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_ANON_KEY;

  const config = validateStagingEnvironment(env);

  // Construct the authoritative staging admin client explicitly
  const stagingAdminClient = createClient<Database>(config.stagingUrl, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // Pin environment variables strictly to validated staging config
  process.env.NEXT_PUBLIC_SUPABASE_URL = config.stagingUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = config.serviceRoleKey;

  // Probe createAdminClient() to assert alignment
  const probeClient = createAdminClient();
  const probeUrl = (probeClient as unknown as { supabaseUrl: string }).supabaseUrl;
  if (!probeUrl || probeUrl !== config.stagingUrl || !probeUrl.includes(config.projectRef)) {
    throw new Error(
      `CRITICAL ISOLATION ERROR: createAdminClient() target mismatch.\n` +
      `Expected: ${config.stagingUrl}\n` +
      `Actual:   ${probeUrl}`
    );
  }
  console.log(`   ✓ Target validated: ${config.stagingUrl} (${config.projectRef})`);

  // ---------------------------------------------------------------------------
  // PHASE 2: NON-MUTATING SCHEMA PROBE (M7-M10 ARTIFACTS)
  // ---------------------------------------------------------------------------
  console.log('2. Probing schema prerequisites without database mutation...');

  // Probe tables and view using SELECT LIMIT 0 (read-only, 0 rows, 0 write tx)
  const { error: tokensErr } = await stagingAdminClient.from('ai_api_tokens').select('id').limit(0);
  if (tokensErr) {
    throw new Error(`Prerequisite missing: public.ai_api_tokens unavailable (${tokensErr.message})`);
  }

  const { error: limitsErr } = await stagingAdminClient.from('ai_token_rate_limits').select('token_id').limit(0);
  if (limitsErr) {
    throw new Error(`Prerequisite missing: public.ai_token_rate_limits unavailable (${limitsErr.message})`);
  }

  const untypedClient = stagingAdminClient as unknown as {
    from: (table: string) => { select: (cols: string) => { limit: (n: number) => Promise<{ error: Error | null }> } };
  };
  const { error: safeViewErr } = await untypedClient.from('ai_api_tokens_safe').select('id').limit(0);
  if (safeViewErr) {
    throw new Error(`Prerequisite missing: public.ai_api_tokens_safe unavailable (${safeViewErr.message})`);
  }

  // Probe RPC presence via PostgREST root OpenAPI endpoint
  const openApiRes = await fetch(`${config.stagingUrl}/rest/v1/`, {
    method: 'GET',
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Accept: 'application/openapi+json',
    },
  });

  if (!openApiRes.ok) {
    throw new Error(`PostgREST OpenAPI schema probe failed with status ${openApiRes.status}`);
  }

  const openApiSpec = (await openApiRes.json()) as { paths?: Record<string, unknown> };
  if (!openApiSpec.paths || !openApiSpec.paths['/rpc/check_and_increment_ai_token_rate_limit']) {
    throw new Error(
      'Prerequisite missing: RPC check_and_increment_ai_token_rate_limit not found in PostgREST schema cache.'
    );
  }

  // Probe RPC endpoint via read-only HTTP OPTIONS
  const rpcOptionsRes = await fetch(
    `${config.stagingUrl}/rest/v1/rpc/check_and_increment_ai_token_rate_limit`,
    {
      method: 'OPTIONS',
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
      },
    }
  );
  if (rpcOptionsRes.status !== 200 && rpcOptionsRes.status !== 204) {
    throw new Error(`RPC OPTIONS probe failed with status ${rpcOptionsRes.status}`);
  }
  console.log('   ✓ Schema artifacts verified (ai_api_tokens, ai_token_rate_limits, ai_api_tokens_safe, RPC)');

  // ---------------------------------------------------------------------------
  // TRACKING ARRAYS FOR RESILIENT TEARDOWN
  // ---------------------------------------------------------------------------
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdTaskIds: string[] = [];

  let testError: unknown = null;
  const cleanupErrors: Error[] = [];
  const auditVerificationErrors: Error[] = [];

  const testSuffix = Math.random().toString(36).substring(2, 7);
  const emailA = `mcp-test-user-a-${testSuffix}@example.com`;
  const emailB = `mcp-test-user-b-${testSuffix}@example.com`;
  const testPassword = `StrongP@ssw0rd_${testSuffix}!`;

  let userAId: string | null = null;
  let userBId: string | null = null;
  let wsAId: string | null = null;
  let wsBId: string | null = null;
  let token1Id: string | null = null;
  let token2Id: string | null = null;
  let token3Id: string | null = null;
  const createdTokenIds: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // PHASE 3: EPHEMERAL FIXTURE SETUP
    // -------------------------------------------------------------------------
    console.log('3. Provisioning isolated test fixtures...');

    // Provision User A
    const { data: userAData, error: userAErr } = await stagingAdminClient.auth.admin.createUser({
      email: emailA,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: `MCP Test User A ${testSuffix}` },
    });
    if (userAErr || !userAData?.user) {
      throw new Error(`Failed to create User A: ${userAErr?.message || 'No user data'}`);
    }
    userAId = userAData.user.id;
    createdUserIds.push(userAId);

    // Discover auto-provisioned Workspace A
    const { data: wsAData, error: wsAErr } = await stagingAdminClient
      .from('workspaces')
      .select('id, name')
      .eq('owner_id', userAId)
      .maybeSingle();

    if (wsAErr || !wsAData) {
      throw new Error(`Failed to discover auto-provisioned Workspace A: ${wsAErr?.message || 'Workspace not found'}`);
    }
    wsAId = wsAData.id;
    createdWorkspaceIds.push(wsAId);
    console.log(`   ✓ User A created (${userAId}) with auto-provisioned Workspace A (${wsAId})`);

    // Provision User B
    const { data: userBData, error: userBErr } = await stagingAdminClient.auth.admin.createUser({
      email: emailB,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: `MCP Test User B ${testSuffix}` },
    });
    if (userBErr || !userBData?.user) {
      throw new Error(`Failed to create User B: ${userBErr?.message || 'No user data'}`);
    }
    userBId = userBData.user.id;
    createdUserIds.push(userBId);

    // Discover auto-provisioned Workspace B
    const { data: wsBData, error: wsBErr } = await stagingAdminClient
      .from('workspaces')
      .select('id, name')
      .eq('owner_id', userBId)
      .maybeSingle();

    if (wsBErr || !wsBData) {
      throw new Error(`Failed to discover auto-provisioned Workspace B: ${wsBErr?.message || 'Workspace not found'}`);
    }
    wsBId = wsBData.id;
    createdWorkspaceIds.push(wsBId);
    console.log(`   ✓ User B created (${userBId}) with auto-provisioned Workspace B (${wsBId})`);

    // Add User B as member of Workspace A
    const { error: memberInsertErr } = await stagingAdminClient.from('workspace_members').insert({
      workspace_id: wsAId,
      user_id: userBId,
      role: 'member',
    });
    if (memberInsertErr) {
      throw new Error(`Failed to add User B as member to Workspace A: ${memberInsertErr.message}`);
    }
    console.log(`   ✓ User B added as member of Workspace A`);

    // -------------------------------------------------------------------------
    // PHASE 4: TOKEN LIFECYCLE & SECURITY BOUNDS
    // -------------------------------------------------------------------------
    console.log('4. Testing AI token creation, formatting, and hash-only persistence...');

    // Token 1: Full-Scope Token for User A
    const token1 = await createAiToken(stagingAdminClient, {
      workspaceId: wsAId,
      userId: userAId,
      name: `Full Token ${testSuffix}`,
      scopes: ['task:read', 'task:write', 'content:read', 'content:write'],
      expiresInDays: 30,
    });
    token1Id = token1.tokenMetadata.id;
    createdTokenIds.push(token1Id);
    if (!token1.token.startsWith('ctc_live_') || token1.token.length !== 73) {
      throw new Error('Token 1 format violation: must start with ctc_live_ and be 73 characters');
    }

    // Token 2: Read-Only Token for User A (used for scope testing and subsequent revocation)
    const token2 = await createAiToken(stagingAdminClient, {
      workspaceId: wsAId,
      userId: userAId,
      name: `Read Token ${testSuffix}`,
      scopes: ['task:read', 'content:read'],
      expiresInDays: 30,
    });
    token2Id = token2.tokenMetadata.id;
    createdTokenIds.push(token2Id);

    // Token 3: Member Token for User B in Workspace A (used for membership deactivation testing)
    const token3 = await createAiToken(stagingAdminClient, {
      workspaceId: wsAId,
      userId: userBId,
      name: `Member Token ${testSuffix}`,
      scopes: ['task:read'],
      expiresInDays: 30,
    });
    token3Id = token3.tokenMetadata.id;
    createdTokenIds.push(token3Id);

    // Verify hash-only persistence in database row
    const { data: dbToken1, error: fetchTokenErr } = await stagingAdminClient
      .from('ai_api_tokens')
      .select('id, token_hash, token_prefix, is_revoked, revoked_at, scopes')
      .eq('id', token1.tokenMetadata.id)
      .single();

    if (fetchTokenErr || !dbToken1) {
      throw new Error(`Failed to verify Token 1 database row: ${fetchTokenErr?.message}`);
    }
    if (dbToken1.token_hash !== hashAiToken(token1.token)) {
      throw new Error('Database token_hash does not match SHA-256 computation of plaintext token');
    }
    if (dbToken1.revoked_at !== null || dbToken1.is_revoked !== false) {
      throw new Error('New token must have revoked_at=null and is_revoked=false');
    }
    console.log('   ✓ Tokens created; verified SHA-256 hash storage and omitted revoked_at');

    // Test active authentication with Token 1
    const auth1 = await authenticateAiToken(token1.token, { adminClient: stagingAdminClient });
    if (!auth1.success) {
      throw new Error(`Token 1 authentication failed: ${auth1.error.message}`);
    }
    if (auth1.context.workspaceId !== wsAId || auth1.context.userId !== userAId) {
      throw new Error('Authenticated context workspaceId or userId mismatch');
    }
    console.log('   ✓ Token 1 authenticated successfully with trusted context');

    // -------------------------------------------------------------------------
    // PHASE 5: OFFICIAL MCP CLIENT PROTOCOL & GATEWAY (/api/mcp)
    // -------------------------------------------------------------------------
    console.log('5. Testing official MCP client protocol exchange and gateway execution...');

    // Bridge StreamableHTTPClientTransport to handleMcpRequest with direct client injection
    const activeToken = token1.token;
    const customFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const request = url instanceof Request ? url : new Request(url, init);
      if (!request.headers.get('host')) {
        request.headers.set('host', 'localhost:3000');
      }
      return handleMcpRequest(request, { adminClient: stagingAdminClient });
    };

    const clientTransport = new StreamableHTTPClientTransport(
      new URL('http://localhost:3000/api/mcp'),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${activeToken}`,
          },
        },
        fetch: customFetch as unknown as typeof fetch,
      }
    );

    const mcpClient = new Client(
      { name: 'mcp-staging-integration-test', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } }
    );

    await mcpClient.connect(clientTransport);

    // 1. Tool discovery
    const toolList = await mcpClient.listTools();
    if (!toolList.tools || toolList.tools.length !== 14) {
      throw new Error(`Expected exactly 14 registered MCP tools, found ${toolList.tools?.length}`);
    }
    console.log(`   ✓ MCP protocol connected; discovered all 14 tools`);

    // 2. Write tool execution: create_task
    const taskTitle = `MCP Staging Task ${testSuffix}`;
    const createTaskRes = await mcpClient.callTool({
      name: 'create_task',
      arguments: {
        title: taskTitle,
        priority: 'high',
        description: 'Created by live MCP staging integration test',
      },
    });

    if (createTaskRes.isError) {
      throw new Error(`create_task tool call failed: ${JSON.stringify(createTaskRes.content)}`);
    }

    const contentItem = (createTaskRes.content as Array<{ type: string; text: string }>)?.[0];
    const createdTask = JSON.parse(contentItem.text) as { id: string; workspace_id: string; title: string };
    if (!createdTask.id || createdTask.workspace_id !== wsAId) {
      throw new Error(`Created task is not scoped to Workspace A: ${JSON.stringify(createdTask)}`);
    }
    createdTaskIds.push(createdTask.id);
    console.log(`   ✓ Write tool executed: create_task created task ${createdTask.id}`);

    // 3. Read tool execution: search_tasks
    const searchTaskRes = await mcpClient.callTool({
      name: 'search_tasks',
      arguments: {
        search: taskTitle,
        limit: 5,
      },
    });

    if (searchTaskRes.isError) {
      throw new Error(`search_tasks tool call failed: ${JSON.stringify(searchTaskRes.content)}`);
    }
    const searchContent = (searchTaskRes.content as Array<{ type: string; text: string }>)?.[0];
    const searchResults = JSON.parse(searchContent.text) as Array<{ id: string; title: string }>;
    if (!searchResults.some((t) => t.id === createdTask.id)) {
      throw new Error(`search_tasks failed to find newly created task ${createdTask.id}`);
    }
    console.log(`   ✓ Read tool executed: search_tasks verified task retrieval`);

    // 4. Identity tamper-proofing: attempted foreign workspace injection rejected by strict schema validation
    const tamperRes = await mcpClient.callTool({
      name: 'create_task',
      arguments: {
        title: `Tamper Task ${testSuffix}`,
        workspace_id: '00000000-0000-4000-8000-000000000000', // Foreign ID attempt
      },
    });
    if (!tamperRes.isError) {
      throw new Error(
        'Identity tamper violation: expected tool call with unrecognized workspace_id to be rejected by strict schema validation'
      );
    }
    const tamperText = (tamperRes.content as Array<{ type: string; text: string }>)?.[0]?.text || '';
    const isStrictSchemaRejection =
      (tamperText.includes('Input validation error') || tamperText.includes('Invalid arguments')) &&
      (/unrecognized key.*workspace_id/i.test(tamperText) || tamperText.includes('Unrecognized key: "workspace_id"'));

    if (!isStrictSchemaRejection) {
      throw new Error(
        `Expected tool call to be rejected specifically by strict schema validation for unrecognized 'workspace_id', got: ${tamperText}`
      );
    }
    console.log(`   ✓ Identity tamper-proofing verified: unrecognized workspace_id strictly rejected by schema`);

    await mcpClient.close();

    // 5. Scope guard enforcement with Read-Only Token (Token 2)
    const readOnlyTransport = new StreamableHTTPClientTransport(
      new URL('http://localhost:3000/api/mcp'),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${token2.token}`,
          },
        },
        fetch: customFetch as unknown as typeof fetch,
      }
    );
    const readOnlyClient = new Client(
      { name: 'mcp-readonly-client', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } }
    );
    await readOnlyClient.connect(readOnlyTransport);

    const writeAttemptRes = await readOnlyClient.callTool({
      name: 'create_task',
      arguments: { title: 'Unauthorized Task' },
    });
    if (!writeAttemptRes.isError) {
      throw new Error('Read-only token unexpectedly succeeded executing create_task write tool');
    }
    const errText = (writeAttemptRes.content as Array<{ type: string; text: string }>)?.[0]?.text;
    if (!errText?.includes('FORBIDDEN') && !errText?.includes('Missing required scope')) {
      throw new Error(`Expected FORBIDDEN scope error, got: ${errText}`);
    }
    console.log('   ✓ Scope enforcement verified: read-only token cannot execute write tool');
    await readOnlyClient.close();

    // 6. Security Header Guards: Host and Origin rejection
    const invalidHostReq = new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: {
        host: 'unauthorized-host.example.com',
        authorization: `Bearer ${token1.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const invalidHostRes = await handleMcpRequest(invalidHostReq, { adminClient: stagingAdminClient });
    if (invalidHostRes.status !== 403) {
      throw new Error(`Host guard failure: expected 403 for unauthorized host, got ${invalidHostRes.status}`);
    }

    const invalidOriginReq = new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'https://malicious-origin.evil',
        authorization: `Bearer ${token1.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    const invalidOriginRes = await handleMcpRequest(invalidOriginReq, { adminClient: stagingAdminClient });
    if (invalidOriginRes.status !== 403) {
      throw new Error(`Origin guard failure: expected 403 for unauthorized origin, got ${invalidOriginRes.status}`);
    }
    console.log('   ✓ Host and Origin security guards verified (403 Forbidden on violations)');

    // -------------------------------------------------------------------------
    // PHASE 6: RATE LIMITING & FAIL-CLOSED TESTING (ISOLATED)
    // -------------------------------------------------------------------------
    console.log('6. Testing atomic rate limiting and fail-closed bounds...');

    // Rate-limit isolation: evaluate on a distinct reference window to avoid interference
    const rateLimitWindow = new Date(Date.now() + 600 * 1000); // 10 minutes ahead
    const rlCall1 = await checkTokenRateLimit(stagingAdminClient, token1.tokenMetadata.id, {
      windowSeconds: 60,
      maxRequests: 2,
      referenceTime: rateLimitWindow,
    });
    if (!rlCall1.allowed || rlCall1.currentCount !== 1) {
      throw new Error(`Rate limit call 1 unexpected result: ${JSON.stringify(rlCall1)}`);
    }

    const rlCall2 = await checkTokenRateLimit(stagingAdminClient, token1.tokenMetadata.id, {
      windowSeconds: 60,
      maxRequests: 2,
      referenceTime: rateLimitWindow,
    });
    if (!rlCall2.allowed || rlCall2.currentCount !== 2 || rlCall2.remainingRequests !== 0) {
      throw new Error(`Rate limit call 2 unexpected result: ${JSON.stringify(rlCall2)}`);
    }

    const rlCall3 = await checkTokenRateLimit(stagingAdminClient, token1.tokenMetadata.id, {
      windowSeconds: 60,
      maxRequests: 2,
      referenceTime: rateLimitWindow,
    });
    if (rlCall3.allowed !== false) {
      throw new Error(`Rate limit call 3 was unexpectedly allowed beyond quota: ${JSON.stringify(rlCall3)}`);
    }
    console.log('   ✓ Live atomic rate limiter verified: quota enforcement and counter increment');

    // Fail-Closed verification: simulated RPC failure returns allowed: false
    const mockFailingClient = {
      rpc: async () => ({
        data: null,
        error: { message: 'Simulated network partition failure' },
      }),
    } as unknown as SupabaseClient<Database>;

    const failClosedRes = await checkTokenRateLimit(mockFailingClient, token1.tokenMetadata.id);
    if (failClosedRes.allowed !== false) {
      throw new Error('Fail-closed violation: rate limiter allowed request on database error');
    }
    console.log('   ✓ Rate limiter fail-closed invariant verified on database failure');

    // -------------------------------------------------------------------------
    // PHASE 7: REVOCATION, MEMBERSHIP & EXPIRATION AUTH REJECTION
    // -------------------------------------------------------------------------
    console.log('7. Testing authentication rejection for revoked, non-member, and expired tokens...');

    // 1. Revoke Token 2 and verify auth rejection
    await revokeAiToken(stagingAdminClient, wsAId, token2.tokenMetadata.id, userAId);
    const authRevoked = await authenticateAiToken(token2.token, { adminClient: stagingAdminClient });
    if (authRevoked.success || authRevoked.status !== 401 || authRevoked.error.code !== 'UNAUTHORIZED') {
      throw new Error(`Revoked token not rejected with 401 UNAUTHORIZED: ${JSON.stringify(authRevoked)}`);
    }
    console.log('   ✓ Revoked token rejected with 401 Unauthorized');

    // 2. Remove User B from Workspace A and verify auth rejection
    const { error: removeMemberErr } = await stagingAdminClient
      .from('workspace_members')
      .delete()
      .eq('workspace_id', wsAId)
      .eq('user_id', userBId);

    if (removeMemberErr) {
      throw new Error(`Failed to remove User B from Workspace A: ${removeMemberErr.message}`);
    }

    const authNonMember = await authenticateAiToken(token3.token, { adminClient: stagingAdminClient });
    if (authNonMember.success || authNonMember.status !== 403 || authNonMember.error.code !== 'FORBIDDEN') {
      throw new Error(`Deactivated member token not rejected with 403 FORBIDDEN: ${JSON.stringify(authNonMember)}`);
    }
    console.log('   ✓ Removed workspace member token rejected with 403 Forbidden');

    // 3. Test deterministic expiration using supported referenceTime
    const futureTime = new Date(Date.now() + 365 * 86400 * 1000); // 1 year in future
    const authExpired = await authenticateAiToken(token1.token, {
      adminClient: stagingAdminClient,
      referenceTime: futureTime,
    });
    if (authExpired.success || authExpired.status !== 401 || authExpired.error.code !== 'UNAUTHORIZED') {
      throw new Error(`Expired token not rejected with 401 UNAUTHORIZED: ${JSON.stringify(authExpired)}`);
    }
    console.log('   ✓ Expired token rejected deterministically with 401 Unauthorized');

    // 4. Test unknown token format
    const unknownToken = 'ctc_live_' + '0'.repeat(64);
    const authUnknown = await authenticateAiToken(unknownToken, { adminClient: stagingAdminClient });
    if (authUnknown.success || authUnknown.status !== 401) {
      throw new Error(`Unknown token not rejected with 401: ${JSON.stringify(authUnknown)}`);
    }

    // 5. Test malformed token string (fails fast before DB query)
    const authMalformed = await authenticateAiToken('ctc_live_invalid', { adminClient: stagingAdminClient });
    if (authMalformed.success || authMalformed.status !== 401) {
      throw new Error(`Malformed token not rejected with 401: ${JSON.stringify(authMalformed)}`);
    }
    console.log('   ✓ Unknown and malformed tokens rejected with 401 Unauthorized');
  } catch (err) {
    testError = err;
    console.error('\n❌ TEST RUN FAILED:', err);
  } finally {
    // -------------------------------------------------------------------------
    // PHASE 8: RESILIENT SCOPED TEARDOWN
    // -------------------------------------------------------------------------
    console.log('\n--- Initiating Scoped Teardown (Reverse Dependency Order) ---');

    // Step 1: Clean up created tasks
    for (const taskId of [...createdTaskIds]) {
      try {
        const { error } = await stagingAdminClient.from('tasks').delete().eq('id', taskId);
        if (error) {
          cleanupErrors.push(new Error(`Failed to delete task ${taskId}: ${error.message}`));
        } else {
          const idx = createdTaskIds.indexOf(taskId);
          if (idx !== -1) createdTaskIds.splice(idx, 1);
        }
      } catch (err: unknown) {
        cleanupErrors.push(new Error(`Exception deleting task ${taskId}: ${err instanceof Error ? err.message : String(err)}`));
      }
    }

    // Attempt recovery of workspace IDs if partial failure occurred during setup
    if (userAId && !wsAId) {
      const { data: recWsA } = await stagingAdminClient.from('workspaces').select('id').eq('owner_id', userAId).maybeSingle();
      if (recWsA?.id) {
        wsAId = recWsA.id;
        if (!createdWorkspaceIds.includes(recWsA.id)) createdWorkspaceIds.push(recWsA.id);
      }
    }
    if (userBId && !wsBId) {
      const { data: recWsB } = await stagingAdminClient.from('workspaces').select('id').eq('owner_id', userBId).maybeSingle();
      if (recWsB?.id) {
        wsBId = recWsB.id;
        if (!createdWorkspaceIds.includes(recWsB.id)) createdWorkspaceIds.push(recWsB.id);
      }
    }

    const successfullyDeletedWorkspaceIds = new Set<string>();

    // Step 2: Clean up workspaces (cascades to tokens, rate limits, workspace members)
    for (const wsId of [...createdWorkspaceIds]) {
      try {
        const { data: deletedRows, error: deleteErr } = await stagingAdminClient
          .from('workspaces')
          .delete()
          .eq('id', wsId)
          .select('id');

        if (deleteErr) {
          cleanupErrors.push(new Error(`Failed to delete workspace ${wsId}: ${deleteErr.message}`));
          continue;
        }

        const rowsAffected = deletedRows ? deletedRows.length : 0;
        if (rowsAffected > 0) {
          // Confirm absence from database to ensure row was truly removed
          const { data: lingeringRow, error: checkErr } = await stagingAdminClient
            .from('workspaces')
            .select('id')
            .eq('id', wsId)
            .maybeSingle();

          if (checkErr) {
            cleanupErrors.push(new Error(`Error confirming absence of workspace ${wsId}: ${checkErr.message}`));
          } else if (lingeringRow) {
            cleanupErrors.push(new Error(`Workspace ${wsId} reported deleted (${rowsAffected} rows) but remains present in database`));
          } else {
            successfullyDeletedWorkspaceIds.add(wsId);
            const idx = createdWorkspaceIds.indexOf(wsId);
            if (idx !== -1) createdWorkspaceIds.splice(idx, 1);
          }
        } else {
          // Zero rows affected by delete statement; check if workspace was already absent
          const { data: existingRow, error: probeErr } = await stagingAdminClient
            .from('workspaces')
            .select('id')
            .eq('id', wsId)
            .maybeSingle();

          if (probeErr) {
            cleanupErrors.push(new Error(`Error checking workspace ${wsId} presence after 0 rows affected: ${probeErr.message}`));
          } else if (existingRow) {
            cleanupErrors.push(new Error(`Workspace ${wsId} was not deleted (0 rows affected) and remains present in database`));
          } else {
            console.log(`   ℹ Workspace ${wsId} was already absent from database; confirmed absent for audit disassociation verification`);
            successfullyDeletedWorkspaceIds.add(wsId);
            const idx = createdWorkspaceIds.indexOf(wsId);
            if (idx !== -1) createdWorkspaceIds.splice(idx, 1);
          }
        }
      } catch (err: unknown) {
        cleanupErrors.push(new Error(`Exception deleting workspace ${wsId}: ${err instanceof Error ? err.message : String(err)}`));
      }
    }

    // Step 3: Clean up auth users (cascades to profiles; succeeds now that workspaces are gone)
    for (const userId of [...createdUserIds]) {
      try {
        const { error } = await stagingAdminClient.auth.admin.deleteUser(userId);
        if (error) {
          cleanupErrors.push(new Error(`Failed to delete user ${userId}: ${error.message}`));
        } else {
          const idx = createdUserIds.indexOf(userId);
          if (idx !== -1) createdUserIds.splice(idx, 1);
        }
      } catch (err: unknown) {
        cleanupErrors.push(new Error(`Exception deleting user ${userId}: ${err instanceof Error ? err.message : String(err)}`));
      }
    }

    // Report remaining untorn resources
    if (createdTaskIds.length > 0) console.error(`⚠️ Tasks remaining uncleaned: ${createdTaskIds.join(', ')}`);
    if (createdWorkspaceIds.length > 0) console.error(`⚠️ Workspaces remaining uncleaned: ${createdWorkspaceIds.join(', ')}`);
    if (createdUserIds.length > 0) console.error(`⚠️ Users remaining uncleaned: ${createdUserIds.join(', ')}`);

    if (cleanupErrors.length > 0) {
      console.error('\n❌ Teardown encountered errors:');
      cleanupErrors.forEach((e) => console.error(` - ${e.message}`));
    } else {
      console.log('✅ Teardown completed: all tracked ephemeral fixtures removed.');
    }

    // -------------------------------------------------------------------------
    // PHASE 9: AUDIT LEDGER IMMUTABILITY & DISASSOCIATION VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n9. Verifying audit ledger immutability and workspace disassociation...');

    // Select target IDs matching both entity_id and entity_type derived from schema and code
    const targetWorkspaceIds = [wsAId, wsBId].filter(
      (id): id is string => typeof id === 'string' && id.length > 0 && successfullyDeletedWorkspaceIds.has(id)
    );
    const targetTokenIds = (wsAId && successfullyDeletedWorkspaceIds.has(wsAId) ? [token1Id, token2Id, token3Id] : []).filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    );

    if (targetWorkspaceIds.length === 0 && targetTokenIds.length === 0) {
      console.log('   ℹ Audit check skipped: no captured workspaces were successfully deleted.');
    } else {
      try {
        const persistedAudits: Array<{
          id: string;
          workspace_id: string | null;
          event_type: string;
          entity_type: string;
          entity_id: string | null;
        }> = [];

        // 1. Query workspace audit records (derived from schema: entity_type = 'workspace')
        if (targetWorkspaceIds.length > 0) {
          const { data: wsAudits, error: wsAuditErr } = await stagingAdminClient
            .from('audit_events')
            .select('id, workspace_id, event_type, entity_type, entity_id')
            .in('entity_id', targetWorkspaceIds)
            .eq('entity_type', 'workspace');

          if (wsAuditErr) {
            const err = new Error(`Workspace audit query failed (inconclusive): ${wsAuditErr.message}`);
            console.error(`   ❌ ${err.message}`);
            auditVerificationErrors.push(err);
          } else if (wsAudits) {
            persistedAudits.push(...wsAudits);
            console.log(`   ✓ Workspace audit query succeeded (${wsAudits.length} record(s) discovered)`);
          }
        }

        // 2. Query AI token audit records (derived from token service: entity_type = 'ai_api_token')
        if (targetTokenIds.length > 0) {
          const { data: tokenAudits, error: tokenAuditErr } = await stagingAdminClient
            .from('audit_events')
            .select('id, workspace_id, event_type, entity_type, entity_id')
            .in('entity_id', targetTokenIds)
            .eq('entity_type', 'ai_api_token');

          if (tokenAuditErr) {
            const err = new Error(`AI token audit query failed (inconclusive): ${tokenAuditErr.message}`);
            console.error(`   ❌ ${err.message}`);
            auditVerificationErrors.push(err);
          } else if (tokenAudits) {
            persistedAudits.push(...tokenAudits);
            console.log(`   ✓ AI token audit query succeeded (${tokenAudits.length} record(s) discovered)`);
          }
        }

        // 3. Verify disassociation on all successfully queried audit records
        if (persistedAudits.length > 0) {
          for (const record of persistedAudits) {
            if (record.workspace_id !== null) {
              const err = new Error(
                `Audit record ${record.id} for entity ${record.entity_id} (${record.entity_type}:${record.event_type}) ` +
                `retains non-null workspace_id (${record.workspace_id}) after workspace deletion`
              );
              console.error(`   ❌ ${err.message}`);
              auditVerificationErrors.push(err);
            }
          }
        }

        // 4. Summarize Phase 9 outcome
        if (auditVerificationErrors.length > 0) {
          console.error(
            `   ❌ Audit verification incomplete or failed with ${auditVerificationErrors.length} error(s); disassociation verification inconclusive.`
          );
        } else if (persistedAudits.length > 0) {
          console.log(
            `   ✓ Found ${persistedAudits.length} identifiable audit records matching entity_id and entity_type; verified workspace_id=NULL disassociation`
          );
        } else {
          console.log('   ✓ Audit ledger checked: no residual audit records found for targeted test entities');
        }
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        const connErr = new Error(`Database connection unusable during audit verification (inconclusive): ${reason}`);
        console.error(`   ❌ ${connErr.message}`);
        auditVerificationErrors.push(connErr);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // PROCESS EXIT STATUS
  // ---------------------------------------------------------------------------
  const totalFailures = (testError ? 1 : 0) + cleanupErrors.length + auditVerificationErrors.length;

  if (totalFailures > 0) {
    process.exitCode = 1;
    console.error('\n================================================================');
    console.error('   Live Staging Verification Completed with Failures');
    if (testError) {
      console.error(` - Main MCP test suite failed: ${testError instanceof Error ? testError.message : String(testError)}`);
    }
    if (cleanupErrors.length > 0) {
      console.error(` - Teardown encountered ${cleanupErrors.length} error(s):`);
      cleanupErrors.forEach((e) => console.error(`     * ${e.message}`));
    }
    if (auditVerificationErrors.length > 0) {
      console.error(` - Audit verification encountered ${auditVerificationErrors.length} failure(s):`);
      auditVerificationErrors.forEach((e) => console.error(`     * ${e.message}`));
    }
    console.error('================================================================\n');

    if (testError) {
      throw testError;
    } else if (cleanupErrors.length > 0) {
      throw new Error(`Integration test passed assertions, but teardown failed with ${cleanupErrors.length} error(s).`);
    } else {
      throw new Error(`Integration test and teardown passed, but Phase 9 audit verification failed with ${auditVerificationErrors.length} error(s).`);
    }
  }

  console.log('\n================================================================');
  console.log('   All MCP Live Staging Verification Checks Passed Successfully');
  console.log('================================================================\n');
}

// Auto-run if executed as main CLI entry point
if (process.argv[1]?.endsWith('test-mcp-integration.ts')) {
  runLiveMcpVerification(process.env).catch((err) => {
    console.error('\nExecution aborted with unhandled error:', err);
    process.exit(1);
  });
}
