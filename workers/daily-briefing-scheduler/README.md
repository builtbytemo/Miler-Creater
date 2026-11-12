# Miler Daily Briefing - Cloudflare Worker Cron Trigger

Standalone Cloudflare Worker that executes every 5 minutes to trigger Miler's Daily Briefing scheduler on the Vercel Preview deployment (`/api/cron/daily-briefing`).

## Architecture & Design

```
+-------------------------------------------------------+
|  Cloudflare Edge (Global Cron Trigger)                |
|  Schedule: "*/5 * * * *" (Every 5 minutes)            |
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
|  Endpoint: /api/cron/daily-briefing                   |
|  Target DB: Staging Supabase (prmgrrzqtnygmitplkhn)   |
|                                                       |
|  1. Authorize Bearer Token (constant-time compare)    |
|  2. Check killswitch DAILY_BRIEFING_DELIVERY_ENABLED  |
|  3. enqueueDueBriefings (idempotent, local midnight)  |
|  4. dispatchDueBriefings (SKIP LOCKED, email/telegram)|
+-------------------------------------------------------+
```

## Cloudflare Free-Tier Limits & Efficiency

- **Request volume:** 288 executions per day (12 ticks/hr * 24 hrs).
  - Cloudflare free-tier limit: **100,000 requests/day** (<0.3% consumed).
- **CPU time:** Pure asynchronous fetch and JSON parse (<1ms per tick).
  - Cloudflare free-tier limit: **10ms CPU time** (>10x safety margin).
- **Zero Production Risk:** The worker targets the Vercel Preview URL directly, keeping Miler production (`zcpdpizrbaaekteurwup`) completely untouched.

## Security & Operational Safeguards

1. **Vercel Protection Bypass:** Passes `x-vercel-protection-bypass` as an HTTP header to bypass Vercel Deployment Protection on preview deployments without exposing secrets in query parameters or URL logs.
2. **Redirect Detection:** Uses `redirect: 'manual'` so any redirect to Vercel SSO (HTTP 302) is detected immediately as an authentication failure rather than silently followed.
3. **No Automatic Retries:** Network timeouts and 5xx errors are logged cleanly without automatic retries, relying on the next 5-minute schedule tick to prevent duplicate delivery attempts.
4. **No Plaintext Secrets:** Secrets (`CRON_SECRET`, `VERCEL_PROTECTION_BYPASS_SECRET`) are never logged and never stored in git.

## Environment Variables & Secrets

| Variable | Type | Description |
|---|---|---|
| `TARGET_URL` | Plain text (`vars`) | URL to `/api/cron/daily-briefing` on Preview |
| `REQUEST_TIMEOUT_MS` | Plain text (`vars`) | Request timeout in milliseconds (default: `20000`) |
| `CRON_SECRET` | Secret | Shared secret matching Vercel's `CRON_SECRET` |
| `VERCEL_PROTECTION_BYPASS_SECRET` | Secret | Secret generated in Vercel Deployment Protection settings |

## Setup & Deployment Instructions

### Step 1: Install Wrangler CLI (if not already installed)
```bash
npm install -g wrangler
# or use npx wrangler
```

### Step 2: Authenticate with Cloudflare
```bash
wrangler login
```

### Step 3: Configure Cloudflare Secrets
From this directory (`workers/daily-briefing-scheduler`):
```bash
npx wrangler secret put CRON_SECRET
# Enter the value matching CRON_SECRET in Vercel Preview environment variables

npx wrangler secret put VERCEL_PROTECTION_BYPASS_SECRET
# Enter the value generated in Vercel: Project Settings -> Deployment Protection -> Protection Bypass for Automation
```

### Step 4: Verify Target Preview URL
In `wrangler.toml`:
```toml
[vars]
TARGET_URL = "https://miler-creater-git-feat-daily-briefin-f2acc6-temo-ctrls-projects.vercel.app/api/cron/daily-briefing"
```

### Step 5: Deploy the Worker
```bash
npx wrangler deploy
```

### Step 6: Test Connectivity with Kill Switch Inactive
Before activating delivery, call the manual trigger or health check:
```bash
# Health check
curl -s https://miler-daily-briefing-scheduler.<your-subdomain>.workers.dev/health | jq

# Test manual trigger (with DAILY_BRIEFING_DELIVERY_ENABLED=false on Vercel)
curl -s -X POST https://miler-daily-briefing-scheduler.<your-subdomain>.workers.dev/trigger \
  -H "Authorization: Bearer <CRON_SECRET>" | jq
```
Expected response:
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

### Step 7: Live Real-Time Logs
To monitor scheduler ticks in real-time:
```bash
npx wrangler tail
```
