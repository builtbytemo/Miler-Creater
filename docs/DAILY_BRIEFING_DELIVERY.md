# Daily Briefing Delivery Infrastructure

Infrastructure only. No briefing content exists yet; production delivery is **off** by default.

## Architecture
- **Scheduler** (`src/lib/briefing/scheduler.ts`): per-user IANA timezone via `Intl` (no fixed offsets). Inserts one `briefing_deliveries` row per user/channel/local date; unique constraint makes repeat/concurrent runs idempotent. Late runs catch up within the same local day; past days are not back-filled.
- **Content generator** (`src/lib/briefing/daily/*`, contract in `types.ts`): `generate({userId, localDate, channel}) -> ready | not_configured`. Pipeline: `source.ts` (retrieval + workspace authorization) -> `build.ts` (date matching, eligibility, dedupe, sort -> shared snapshot) -> `render-email.ts` / `render-telegram.ts`. Email shows Tasks, Content, Day Finder; Telegram shows Tasks, Content with full details and is split into ordered HTML messages under Telegram's 4096-char limit. Calendar-origin entries (`created_from = 'calendar'`) are Day Finder blocks, not tasks/content. Delivery still only happens when the cron is enabled (`DAILY_BRIEFING_DELIVERY_ENABLED=true`).
- **Delivery** (`dispatcher.ts`, `channels/*`): claims rows with `claim_briefing_deliveries` (`FOR UPDATE SKIP LOCKED`, 5‑min lease), re-checks preferences/consent/verified destination, sends, finalizes via `finalize_briefing_delivery` (claim-token guarded; late or duplicate finalizations are no-ops).
- Retries: exponential backoff 1→60 min, honoring provider retry-after, max 5 attempts. Expired leases and Telegram timeouts become `ambiguous` and are **not** auto-retried (the message may have been delivered). Email uses an `Idempotency-Key`.
- Cron entry: `GET|POST /api/cron/daily-briefing` with `Authorization: Bearer $CRON_SECRET`; no-op unless `DAILY_BRIEFING_DELIVERY_ENABLED=true`. Call it every 5 minutes from your external scheduler (same pattern as `/api/cron/reminders`; the repo has no scheduler config).
- Existing `notification_preferences` / `notifications` / reminders are untouched.

## Endpoints
- `POST /api/telegram/webhook` – validates `X-Telegram-Bot-Api-Secret-Token`, dedupes `update_id`.
- `/api/cron/daily-briefing` – new, bearer protected.
- Server actions in `src/lib/actions/daily-briefing-actions.ts`; UI in Settings → Notifications.

## Environment variables
`DAILY_BRIEFING_DELIVERY_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, plus existing `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.

## Telegram setup (manual)
1. In Telegram, message @BotFather → `/newbot`, choose name/username; copy the token.
2. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` (without @), and a long random `TELEGRAM_WEBHOOK_SECRET` (A–Z a–z 0–9 _ -) in server env.
3. Deploy, then register the webhook (run locally, token from your env):
   `curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -d "url=https://<your-domain>/api/telegram/webhook" -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" -d 'allowed_updates=["message","my_chat_member"]'`
4. In Miler → Settings → Notifications, press Connect Telegram, open the link, press Start.

## Email setup (manual)
No email provider existed in the repo (only Supabase Auth's own mail). A Resend adapter is included.
1. Create a Resend account (free tier available) and verify a sending domain.
2. Create an API key; set `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `Miler <briefing@your-domain>`).
Alternative provider: implement `ChannelAdapter<EmailDestination>` in `channels/email.ts`.

## Verification
- `npm test` (new `tests/daily-briefing-*.test.ts`), `npx tsc --noEmit`, `npm run lint`.
- With providers configured, use the "Send test" buttons in settings (user-triggered, 1/min, own destination only).
- Apply migration `20261111000003_daily_briefing_delivery.sql` to a staging DB first.

## Activation checklist
1. Apply migration. 2. Configure Telegram and/or email. 3. Implement and register a content generator (`registerBriefingContentGenerator`). 4. Schedule the cron every 5 min. 5. Set `DAILY_BRIEFING_DELIVERY_ENABLED=true`. 6. Users opt in via settings.
