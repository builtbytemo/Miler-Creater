# Miler Daily Briefing - Cloudflare Worker Cron Trigger

Standalone Cloudflare Worker that triggers Miler's Daily Briefing scheduler on the Vercel Preview deployment (`/api/cron/daily-briefing`).

## Architecture & Design

```
+-------------------------------------------------------+
|  Cloudflare Edge (Global Cron Trigger)                |
|  Initial Status: crons = [] (Disabled until approved) |
|  Production Schedule: "*/5 * * * *" (Every 5 minutes)  |
|  Worker: miler-daily-briefing-scheduler               |
+---------------------------+---------------------------+
                            |
                            | HTTPS GET /api/cron/daily-briefing
                            | Headers:
                            |   Authorization: Bearer <CRON_SECRET>
                            |   x-vercel-protection-bypass: <SECRET>
                            |
                            v
+-------------------------------------------------------+
|  Vercel Preview Deployment                            |
|  Host: miler-creater-git-feat-daily-briefin-f2acc6... |
|  Endpoint: /api/cron/daily-briefing                   |
|  Target DB: Staging Supabase (prmgrrzqtnygmitplkhn)   |
|                                                       |
|  1. Authorize Bearer Token (constant-time compare)    |
|  2. Verify Staging Supabase Target (reject prod ref)  |
|  3. Check killswitch DAILY_BRIEFING_DELIVERY_ENABLED  |
|  4. enqueueDueBriefings (idempotent, local midnight)  |
|  5. dispatchDueBriefings (SKIP LOCKED, email/telegram)|
+-------------------------------------------------------+
```

## Cloudflare Free-Tier Limits & Efficiency

- **Request volume:** 288 executions per day (12 ticks/hr * 24 hrs) once cron is active.
  - Cloudflare free-tier limit: **100,000 requests/day** (<0.3% consumed).
- **CPU time:** Pure asynchronous fetch and JSON parse (<1ms per tick).
  - Cloudflare free-tier limit: **10ms CPU time** (>10x safety margin).
- **Zero Production Risk:** The worker targets the Vercel Preview URL directly, keeping Miler production (`zcpdpizrbaaekteurwup`) completely untouched.

## Security & Operational Safeguards

1. **Initial Deployment with Zero Active Crons:** Configured with `crons = []` in `wrangler.toml` so the initial deployment registers zero scheduled triggers.
2. **Strict Host & Path Allowlist:** The Worker strictly allowlists the approved Vercel Preview host (`miler-creater-git-feat-daily-briefin-f2acc6-temo-ctrls-projects.vercel.app`), `https:` protocol, and exact pathname `/api/cron/daily-briefing`. Disallowed hosts, paths, queries, or production Supabase project refs are rejected before any network request is issued.
3. **Endpoint Staging Validation:** The `/api/cron/daily-briefing` endpoint independently verifies that its configured Supabase URL points to staging (`prmgrrzqtnygmitplkhn`) and aborts with HTTP 403 if production (`zcpdpizrbaaekteurwup`) is targeted.
4. **Vercel Protection Bypass:** Passes `x-vercel-protection-bypass` as an HTTP header to bypass Vercel Deployment Protection on preview deployments without exposing secrets in query parameters or URL logs.
5. **Redirect Detection:** Uses `redirect: 'manual'` so any redirect to Vercel SSO (HTTP 302) is detected immediately as an authentication failure rather than silently followed.
6. **Restricted Manual Trigger (`/trigger`):**
   - Strictly enforces `POST` (rejects `GET` with 405 Method Not Allowed).
   - Requires valid `Authorization: Bearer <CRON_SECRET>` checked with constant-time comparison (`timingSafeEqual`).
   - Ignores user-provided URLs; strictly executes against the allowlisted staging target.
   - Can be permanently disabled post-verification by setting `ALLOW_MANUAL_TRIGGER = "false"` in `wrangler.toml`.
7. **No Automatic Retries:** Network timeouts and 5xx errors are logged cleanly without automatic retries, relying on the next 5-minute schedule tick to prevent duplicate delivery attempts.
8. **No Plaintext Secrets:** Secrets (`CRON_SECRET`, `VERCEL_PROTECTION_BYPASS_SECRET`) are never logged and never stored in git.

## Scaling Constraints & Architectural Boundaries

- **User Pagination Cap:** `enqueueDueBriefings` uses keyset pagination with `PAGE_SIZE = 500` and `MAX_PAGES = 20`. This bounds the scheduler loop to at most **10,000 active users** per run, ensuring bounded runtime and memory within Vercel execution limits.
- **Delivery Batch Limit:** `dispatchDueBriefings` claims at most **25 deliveries per tick** (configurable up to 100 in the PostgreSQL RPC `claim_briefing_deliveries`). Deliveries beyond 25 are claimed on subsequent 5-minute ticks, preventing database connection exhaustion and third-party rate limiting (Telegram Bot API and Resend).

## Environment Variables & Secrets

| Variable | Type | Description |
|---|---|---|
| `TARGET_URL` | Plain text (`vars`) | Strict Preview URL: `https://miler-creater-git-feat-daily-briefin-f2acc6-temo-ctrls-projects.vercel.app/api/cron/daily-briefing` |
| `REQUEST_TIMEOUT_MS` | Plain text (`vars`) | Request timeout in milliseconds (default: `20000`) |
| `ALLOW_MANUAL_TRIGGER` | Plain text (`vars`) | `true` during connectivity testing; set to `false` after testing |
| `CRON_SECRET` | Secret | Shared secret matching Vercel's `CRON_SECRET` |
| `VERCEL_PROTECTION_BYPASS_SECRET` | Secret | Secret generated in Vercel Deployment Protection settings |

## Setup & Deployment Instructions

### Step 1: Install Wrangler CLI
```bash
npm install -g wrangler
# or run via npx without global install:
# npx wrangler ...
```

### Step 2: Authenticate with Cloudflare
```bash
npx wrangler login
```
*A browser window will open to authorize Wrangler with your Cloudflare account. Do not share API tokens or passwords in chat.*

### Step 3: Configure Cloudflare Secrets
From this directory (`workers/daily-briefing-scheduler`):
```bash
npx wrangler secret put CRON_SECRET
# Paste the matching CRON_SECRET configured in Vercel Preview environment variables

npx wrangler secret put VERCEL_PROTECTION_BYPASS_SECRET
# Paste the bypass secret from Vercel: Project Settings -> Deployment Protection -> Protection Bypass for Automation
```

### Step 4: Deploy the Worker (Without Active Crons)
Confirm `crons = []` in `wrangler.toml`, then deploy:
```bash
npx wrangler deploy
```

### Step 5: Test Edge Connectivity with Delivery Disabled
Ensure `DAILY_BRIEFING_DELIVERY_ENABLED` is `false` in Vercel Preview environment variables.

```bash
# 1. Health check (no secrets required)
curl -s "https://miler-daily-briefing-scheduler.<your-subdomain>.workers.dev/health" | jq

# 2. Authenticated test trigger (verifies Cloudflare-to-Vercel connectivity)
curl -s -X POST "https://miler-daily-briefing-scheduler.<your-subdomain>.workers.dev/trigger" \
  -H "Authorization: Bearer <YOUR_CRON_SECRET>" | jq
```

Expected Response:
```json
{
  "ok": true,
  "statusCode": 200,
  "statusText": "OK",
  "body": {
    "success": true,
    "enabled": false,
    "message": "Daily Briefing delivery is disabled"
  }
}
```

### Step 6: Post-Verification Cleanup (Optional)
To disable manual execution after verification:
Set `ALLOW_MANUAL_TRIGGER = "false"` in `wrangler.toml` and run `npx wrangler deploy`.
