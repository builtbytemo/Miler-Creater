# Production Release Plan & Recovery Strategy: Daily Briefing Infrastructure

This document defines the safe, non-destructive release engineering procedures and disaster recovery plan for deploying Daily Briefing infrastructure (Migrations 15, 16, 17) to Miler Production (`zcpdpizrbaaekteurwup`).

---

## 1. Release Scope & Target State

### A. Database Migrations
Pending migrations to be applied sequentially via `npx supabase db push --project-ref zcpdpizrbaaekteurwup`:
1. `20261111000003_daily_briefing_delivery.sql` (Migration 15):
   - Tables: `public.daily_briefing_preferences`, `public.briefing_deliveries`, `public.telegram_link_tokens`.
   - RPC functions: `claim_briefing_deliveries`, `finalize_briefing_delivery`, `create_telegram_link_token`, `consume_telegram_link_token`.
   - Security: Row Level Security enabled on all tables; EXECUTE permissions restricted to `authenticated` and `service_role`.
2. `20261112000001_task_entry_type.sql` (Migration 16):
   - Adds column `tasks.entry_type` (`VARCHAR(20) NOT NULL DEFAULT 'task'`).
   - Safe backfill of existing tasks to `'task'`.
   - Check constraint `tasks_entry_type_check` enforcing valid types (`'task'`, `'content'`, etc.).
3. `20261112000002_harden_completion_rpc_security.sql` (Migration 17):
   - Hardens `public.complete_task_transactional` against anonymous execution.
   - Enforces `auth.uid() IS NOT NULL` authorization guards.
   - Revokes all execution privileges from `PUBLIC` and `anon`.

### B. Dual-Channel Delivery Architecture
- **Channels**: Both **Telegram** and **Email** are supported first-class channels.
- **Email Provider**: **Resend** is the permanent email provider. No fallback to personal SMTP or unverified workarounds.
- **Telegram Provider**: Dedicated production Telegram bot via official Telegram Bot API.
- **Default State**: Delivery is globally disabled (`DAILY_BRIEFING_DELIVERY_ENABLED=false`). Individual user preferences default to disabled.

---

## 2. Safe Recovery Strategy (Non-Destructive)

Destructive rollback procedures (such as `DROP TABLE ... CASCADE`, `ALTER TABLE ... DROP COLUMN`, or deleting rows from `supabase_migrations.schema_migrations`) are **strictly prohibited** in production. They risk dropping production task data, corrupting foreign key dependencies, and breaking migration history provenance.

Instead, the recovery strategy relies on operational kill-switches, fail-closed code guards, and forward-only corrective migrations.

### A. Primary Operational Recovery: Fail-Safe Disablement (Zero Downtime, Zero Data Loss)
If an issue occurs with Daily Briefing after deployment:
1. **Immediate Kill-Switch**:
   - Set `DAILY_BRIEFING_DELIVERY_ENABLED="false"` in Vercel Production environment variables.
   - Set Cloudflare production worker `crons = []` or pause the worker trigger.
2. **Immediate Effect**:
   - The cron endpoint `/api/cron/daily-briefing` immediately returns `200 { enabled: false, enqueued: 0, claimed: 0, sent: 0 }` with zero database writes.
   - Inbound webhook `/api/telegram/webhook` continues handling token linking safely or can be gated via `TELEGRAM_WEBHOOK_SECRET` invalidation.
3. **Data Preservation**:
   - All existing tasks, recurrences, workspaces, and audit events remain 100% intact.
   - Any briefing preferences configured by users remain safely stored for when the issue is resolved.
   - Zero schema changes or table drops occur.

### B. Forward-Only Corrective Migrations
If an adjustment to schema, constraints, indexes, or RPC logic is required post-rollout:
1. Author a new timestamped migration file (e.g. `supabase/migrations/202611..._corrective_patch.sql`).
2. Test and rehearse the migration in an isolated disposable environment.
3. Apply the migration using `npx supabase db push --project-ref zcpdpizrbaaekteurwup`.
4. Never manually delete rows from `supabase_migrations.schema_migrations`.

### C. Security Invariant: Preservation of `complete_task_transactional`
Under all recovery or incident conditions:
- `public.complete_task_transactional` must **never** be reverted to an open or unauthenticated permission state.
- `EXECUTE` privileges remain revoked from `PUBLIC` and `anon`.
- Access is restricted exclusively to `authenticated` and `service_role`.

---

## 3. Verified Disaster Recovery & Backup Plan

Database dumps are retained solely for catastrophic disaster recovery (e.g. storage cluster corruption or accidental database deletion).

### A. Pre-Migration Backups (Read-Only)
Before executing `supabase db push`, capture immutable point-in-time snapshots of the production database:

```bash
# 1. Capture public schema and migration history table definitions
npx supabase db dump --project-ref zcpdpizrbaaekteurwup \
  --schema public,supabase_migrations \
  -f /tmp/prod_pre_briefing_schema_backup.sql

# 2. Capture public table data
npx supabase db dump --project-ref zcpdpizrbaaekteurwup \
  --data-only --schema public \
  -f /tmp/prod_pre_briefing_data_backup.sql
```

### B. Explicit Recovery Limitations of Supabase CLI Backups
Teams executing recovery must understand the boundary of CLI SQL dumps:
1. **Managed Authentication Schema (`auth`)**:
   - User password hashes, TOTP secrets, session tokens, and identity mappings are managed by GoTrue and reside in `auth`.
   - Standard CLI database dumps do not back up internal GoTrue auth credentials.
2. **Object Storage Binaries (`storage`)**:
   - File assets and uploads reside in S3/R2 storage buckets. Database dumps contain only table metadata, not the binary payloads.
3. **Platform Secrets & Configuration (`vault` / Control Plane)**:
   - Supabase Vault secrets, OAuth application secrets, custom SMTP configs, and Edge Function code are not part of user table dumps.
4. **Recovery Point Objective (RPO) Gap on Full Restore**:
   - Restoring a full data dump rolls the database back to the exact snapshot timestamp. Any tasks, subtasks, or status changes created by users between the dump and the restore would be lost.
   - For this reason, full database restores are strictly reserved for catastrophic infrastructure loss, **never for rolling back an application feature**.

---

## 4. Dual-Channel Rollout & Sending Domain Policy

### A. Telegram Channel Readiness
1. **Dedicated Bot**: A dedicated production Telegram bot must be created via `@BotFather`.
2. **Environment Variables**:
   - `TELEGRAM_BOT_TOKEN`: Production bot API token.
   - `TELEGRAM_BOT_USERNAME`: Production bot username without `@`.
   - `TELEGRAM_WEBHOOK_SECRET`: Secure 32-byte hexadecimal secret generated via `openssl rand -hex 32`.
3. **Webhook Registration**:
   Registered only after Vercel production deployment is live:
   ```bash
   curl -s -X POST "https://api.telegram.org/bot<PROD_BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://miler-creater.vercel.app/api/telegram/webhook",
       "secret_token": "<PROD_WEBHOOK_SECRET>",
       "allowed_updates": ["message"]
     }'
   ```

### B. Email Channel Policy & Resend Configuration
1. **Provider Invariant**: **Resend** is the confirmed email provider. Personal Gmail SMTP and undocumented workarounds are rejected.
2. **Sending Domain Requirement**:
   - Sending domains must be verifiably owned with full DNS record control (DKIM, SPF, DMARC) and validated in Resend.
   - Domains without verifiable ownership (e.g. unowned domains or unverified dynamic DNS) will not be used.
3. **Fail-Safe Operation Without Verified Domain**:
   - If `RESEND_API_KEY` or `EMAIL_FROM` is missing or unverified at initial launch:
     - The UI automatically disables the email briefing toggle with the label: *"Email delivery is not configured on this server."*
     - Server action `updateDailyBriefingPreferencesAction` rejects any request to enable email.
     - Telegram briefing operates with full autonomy and zero degradation.
   - Once a verified sending domain is established in Resend and environment variables are added to Vercel Production, email delivery immediately unlocks with zero code changes required.

---

## 5. Deployment Checklist & Invariants

| Step | Action | Safeguard |
|---|---|---|
| 1 | Staging Unattended Verification | Verify November 13, 00:00 Cairo delivery tick on Staging |
| 2 | Bot Provisioning | User creates dedicated Production Telegram Bot in `@BotFather` |
| 3 | Pre-Migration Backup | Execute schema & data dumps of production `zcpdpizrbaaekteurwup` |
| 4 | Database Migration | Run `npx supabase db push --project-ref zcpdpizrbaaekteurwup` |
| 5 | Post-Migration Verification | Verify permissions, table constraints, and `complete_task_transactional` |
| 6 | Vercel Production Env | Configure production Telegram secrets; leave `DAILY_BRIEFING_DELIVERY_ENABLED=false` |
| 7 | Vercel Deployment | Deploy production release |
| 8 | Telegram Webhook | Register production webhook with `secret_token` |
| 9 | Cloudflare Scheduler | Deploy production scheduler worker with `crons = []` |
| 10 | Explicit Activation | Set `DAILY_BRIEFING_DELIVERY_ENABLED=true` after smoke testing |
