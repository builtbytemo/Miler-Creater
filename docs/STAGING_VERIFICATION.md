# Staging Database Integration Verification Guide

This guide describes how to safely execute the integration test script ([scripts/test-reminder-integration.ts](../scripts/test-reminder-integration.ts)) against an isolated, disposable Supabase database.

---

## 1. Safety Guard Architecture

The reminder integration script implements a strict, multi-layered fail-closed security barrier to prevent accidental execution against production or developer databases.

This barrier is implemented by `validateStagingEnvironment()`, exported from [`scripts/test-reminder-integration.ts`](../scripts/test-reminder-integration.ts) and shared across all staging integration scripts (including [`scripts/test-database-rls.ts`](../scripts/test-database-rls.ts)).

*(Note: There is no standalone `scripts/test-staging-target-validation.ts` script file; the guard logic resides in `scripts/test-reminder-integration.ts`, and its offline unit test suite is located at `tests/staging-target-validation.test.ts`.)*

1. **Explicit Target Isolation**:
   - Refuses to read credentials from `.env.local` or `NEXT_PUBLIC_SUPABASE_URL`.
   - Requires dedicated environment variables: `STAGING_SUPABASE_URL`, `STAGING_SERVICE_ROLE_KEY`, and `STAGING_ANON_KEY` (used exclusively for low-privilege authenticated user clients in RLS verification).
2. **Explicit Opt-In Flag**:
   - Requires `CONFIRM_DISPOSABLE_DATABASE="true"`.
3. **Supabase Hostname Validation**:
   - Rejects `localhost`, `127.0.0.1`, local IP addresses, and placeholder values.
   - Enforces the pattern `^([a-z0-9]{20})\.supabase\.co$`.
4. **Project Ref Parity Guard**:
   - Extracts the 20-character project reference from the URL hostname and compares it with `EXPECTED_STAGING_PROJECT_REF`.
   - If there is any discrepancy, the script aborts immediately before creating a Supabase client or sending a network request.

---

## 2. Setting Up a Disposable Staging Database

To run the integration verification safely:

1. **Create a Free Disposable Project**:
   - Go to [Supabase](https://supabase.com) and create a brand new, empty project (e.g. `command-center-staging`).
2. **Apply Migrations in Sequence**:
   - In the Supabase SQL Editor on the staging project, apply the 6 repository migrations:
     1. `supabase/migrations/20261028000001_initial_schema.sql`
     2. `supabase/migrations/20261028000002_task_engine_enhancements.sql`
     3. `supabase/migrations/20261028000003_fix_workspace_owner_provisioning.sql`
     4. `supabase/migrations/20261028000004_fix_audit_event_lifecycle.sql`
     5. `supabase/migrations/20261029000001_notification_system_enhancements.sql`
     6. `supabase/migrations/20261029000002_fix_workspace_cascade_deletion.sql`
3. **Configure Environment File**:
   - Copy `.env.staging.example` to `.env.staging.local`:
     ```bash
     cp .env.staging.example .env.staging.local
     ```
   - Fill in your staging project's URL, Service Role Key, Anon Key, and matching project ref:
     ```bash
     STAGING_SUPABASE_URL="https://abcdefghijklmnopqrst.supabase.co"
     STAGING_SERVICE_ROLE_KEY="your-staging-service-role-key"
     STAGING_ANON_KEY="your-staging-anon-key"
     EXPECTED_STAGING_PROJECT_REF="abcdefghijklmnopqrst"
     CONFIRM_DISPOSABLE_DATABASE="true"
     ```

---

## 3. Running the Integration Tests

### Pre-Flight: Offline Target Validation Unit Tests
Before running tests against a live database, verify the fail-closed validation guards using the offline mock test suite (which tests `validateStagingEnvironment` from `scripts/test-reminder-integration.ts` without network or database access):
```bash
npm test tests/staging-target-validation.test.ts
```

### Live Staging Execution
Run the integration scripts by providing the staging environment file explicitly:

### A. Reminder Engine Staging Verification
```bash
tsx --env-file=.env.staging.local scripts/test-reminder-integration.ts
```

### B. Multi-Tenant RLS & Audit Lifecycle Verification
```bash
tsx --env-file=.env.staging.local scripts/test-database-rls.ts
```

### C. Model Context Protocol (MCP) Streamable HTTP Verification
```bash
tsx --env-file=.env.staging.local scripts/test-mcp-integration.ts
```
*(or `npm run test:mcp:db`)*

All staging integration scripts enforce identical fail-closed target guards:
- Verify all fail-closed target guards before connecting or constructing clients.
- Enforce `CONFIRM_DISPOSABLE_DATABASE="true"`.
- Never fall back to `.env.local` or production environment variables.
- Run checks in isolated, ephemeral test workspaces.
- Execute scoped teardown of all tracked test tasks, notifications, preferences, workspaces, and test users by exact captured IDs.

---

## 4. Resolution of Workspace Cascade Teardown

In `supabase/migrations/20261028000003_fix_workspace_owner_provisioning.sql`, the function `protect_workspace_members()` previously evaluated owner protection in a `BEFORE DELETE` trigger on `workspace_members`. Because foreign-key cascades execute while the parent row still exists in the transaction snapshot, direct workspace deletions (`DELETE FROM workspaces`) were previously rejected by the trigger.

Migration [`supabase/migrations/20261029000002_fix_workspace_cascade_deletion.sql`](../supabase/migrations/20261029000002_fix_workspace_cascade_deletion.sql) resolved this schema blocker by delegating deletion protection to a dedicated deferred constraint trigger (`AFTER DELETE ... DEFERRABLE INITIALLY DEFERRED`):
- When an individual member deletion is executed while the workspace still exists in `public.workspaces`, the constraint trigger rejects the deletion if the member is the workspace owner.
- When an authorized workspace deletion occurs, `public.workspaces` no longer contains the workspace at transaction check time, allowing the cascade cleanup to complete cleanly.
- The staging integration script's teardown stage can now remove tracked test workspaces cleanly without trigger errors.

---

## 5. Model Context Protocol (MCP) Staging Verification

The MCP staging integration script ([`scripts/test-mcp-integration.ts`](../scripts/test-mcp-integration.ts)) tests the end-to-end AI Gateway over the official Model Context Protocol (MCP) Streamable HTTP transport (2026-07-28 specification) against the disposable staging database.

### Verified Architecture & Coverage
1. **Target Isolation & Client Assertion**:
   - Purges ambient environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
   - Validates dedicated staging parameters and asserts that `createAdminClient()` targets the validated staging URL.
2. **Read-Only Schema Artifact Verification**:
   - Probes M7–M10 schema objects (`public.ai_api_tokens`, `public.ai_token_rate_limits`, `public.ai_api_tokens_safe`) using non-mutating `SELECT ... LIMIT 0`.
   - Probes the RPC `check_and_increment_ai_token_rate_limit` via the PostgREST root OpenAPI schema and HTTP `OPTIONS` without invoking the underlying function body.
3. **Token Lifecycle & Column-Grant Alignment**:
   - Issues full-scope, read-only, and member tokens via `createAiToken()`.
   - Verifies 73-character token format (`ctc_live_...`), SHA-256 hash storage, and omitted `revoked_at` in insert payloads.
   - Tests active token authentication, token revocation, active workspace membership re-verification, and deterministic expiration (`referenceTime`).
4. **Isolated Rate-Limiter Verification**:
   - Verifies atomic quota enforcement and counter increments on live staging on an isolated time window.
   - Tests fail-closed behavior using simulated database failures without damaging staging state.
5. **Real MCP Protocol & Tool Execution**:
   - Connects official `@modelcontextprotocol/client` SDK `Client` and `StreamableHTTPClientTransport` to the Next.js Route Handler `POST(req)`.
   - Confirms discovery of all 14 registered MCP tools.
   - Executes write tool (`create_task`) and read tool (`search_tasks`) against the ephemeral workspace.
   - Enforces read-only scope boundaries and identity tamper-proofing (overriding caller-supplied foreign `workspace_id`).
   - Validates Host header syntax and Origin security boundaries (403 Forbidden on violations).
6. **Scoped Reverse-Dependency Teardown**:
   - Cleans up created tasks, auto-provisioned workspaces (Workspace A and Workspace B), and test auth users in reverse dependency order.
   - Handles partial fixture setup failures safely (recovers workspace IDs before user deletion to avoid `ON DELETE RESTRICT` foreign-key errors).
   - Accumulates cleanup errors and reports uncleaned resource IDs without calling `process.exit(1)` inside `finally`.
7. **Audit Ledger Immutability & Workspace Disassociation**:
   - Accounts for immutable audit records emitted during test execution. Never attempts to delete or alter audit rows.
   - Queries all 5 test fixture entity IDs (Workspace A, Workspace B, Token 1, Token 2, Token 3) and verifies that every persisted matching audit record has `workspace_id = NULL` after workspace deletion via PostgreSQL foreign-key `ON DELETE SET NULL`.
