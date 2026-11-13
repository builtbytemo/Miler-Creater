# Self-Hosting Daily Briefing Personal Email Mode

Personal Email Mode lets an independent or self-hosted Zahi instance deliver automated Daily Briefings to **one explicitly authorized Supabase user and email address** using Resend, alongside Telegram.

## Important `onboarding@resend.dev` Limitation

- Resend's built-in testing sender (`onboarding@resend.dev` or `Zahi <onboarding@resend.dev>`) **only delivers to recipients permitted by your own Resend account** (typically the verified email address registered as the Resend account owner; Resend rejects other recipients with HTTP `403`).
- `onboarding@resend.dev` is suitable for personal single-user delivery when your Resend account owner email matches your Zahi account email. It **does not support public or multi-user SaaS email**.
- To send briefings from a custom domain, verify a sending domain you own in Resend (SPF/DKIM DNS records) and set `EMAIL_FROM` accordingly.

## Security Defaults (Fail-Closed Everywhere)

- **Default restricted mode:** Email delivery defaults to fail-closed `single_user` mode across **all** hosting environments — including Vercel Production, third-party Vercel Preview deployments, Docker/VPS, Fly.io, Railway, and local development.
- **No implicit preview bypass:** Independent Vercel Preview deployments never inherit unrestricted email access from `VERCEL_ENV=preview`.
- **Enforcement layers:** If any required variable is missing or malformed, email is disabled in the Settings UI (`service.emailConfigured = false`), rejected in server actions, ignored during scheduler enqueueing (without affecting Telegram), skipped before briefing generation in the dispatcher, and blocked before any HTTP call in the Resend adapter.
- **Identity & consent:** Delivery requires both explicit `DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID` (UUID) and `DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT` (verified account email), plus the user's opt-in email toggle and recorded `email_consent_at` timestamp in Settings. Telegram delivery remains independent for users with active Telegram links.

## Setup Steps for an Independent Instance

1. **Create and migrate your Supabase project**
   - Point `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` at your own Supabase project.
   - Apply all migrations in `supabase/migrations/`.

2. **Create and verify your Zahi user account**
   - Sign up and verify your login email address (`email_confirmed_at` must be populated in Supabase Auth).
   - Copy your user UUID (`auth.users.id`) and note your verified email address.

3. **Configure Resend credentials**
   - In [Resend](https://resend.com), create an API key for your account (`RESEND_API_KEY`).
   - Confirm that the email address receiving briefings is permitted by your Resend account if you set `EMAIL_FROM="Zahi <onboarding@resend.dev>"`, or use a sender address on your own verified domain.

4. **Set server environment variables** (use `.env.example` as a template; never commit secrets):

   ```bash
   NEXT_PUBLIC_SUPABASE_URL="https://your-project-ref.supabase.co"
   NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-public-key"
   SUPABASE_SERVICE_ROLE_KEY="your-service-role-secret-key"
   NEXT_PUBLIC_SITE_URL="https://your-app-domain.example"

   # Cron auth + strict target host guard (works on both Vercel and non-Vercel hosts)
   CRON_SECRET="your-secure-random-cron-secret-token"
   DAILY_BRIEFING_EXPECTED_SUPABASE_HOST="your-project-ref.supabase.co"
   DAILY_BRIEFING_DELIVERY_ENABLED="true"

   # Personal Email Mode (all four values required)
   RESEND_API_KEY="your-resend-api-key"
   EMAIL_FROM="Zahi <onboarding@resend.dev>"
   DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID="00000000-0000-4000-8000-000000000000"
   DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT="owner@example.com"
   ```

   - Never prefix `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, or allowlist variables with `NEXT_PUBLIC_`.
   - `DAILY_BRIEFING_EXPECTED_SUPABASE_HOST` must match the hostname of `NEXT_PUBLIC_SUPABASE_URL` exactly; `/api/cron/daily-briefing` fails closed with HTTP `403` if mismatched or missing outside recognized host configurations.

5. **Schedule the cron endpoint**
   - Call `GET` or `POST` `/api/cron/daily-briefing` every ~5 minutes with header:
     `Authorization: Bearer <CRON_SECRET>`
   - Repeated/concurrent ticks are idempotent (`briefing_deliveries` unique constraint + per-delivery Resend `Idempotency-Key`).

6. **Enable and verify in Settings**
   - Open **Settings -> Notifications** while signed in as `DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID`.
   - Enable **Daily Briefing**, turn on **Email** (which records timestamped consent), and click **Send test email** to confirm end-to-end delivery.
   - If the UI reports a recipient mismatch warning, confirm that your Supabase verified login email, `DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT`, and Resend-permitted recipient all match exactly.
