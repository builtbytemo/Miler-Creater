import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createTelegramAdapter } from '@/lib/briefing/channels/telegram';
import { handleTelegramUpdate, verifyWebhookSecret } from '@/lib/briefing/telegram-linking';

/**
 * Telegram webhook. Authenticated solely by the X-Telegram-Bot-Api-Secret-Token header
 * (set via setWebhook secret_token). Fails closed (503) when the secret is not configured.
 * Always answers 200 for authentic updates so Telegram does not endlessly redeliver.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }
  if (!verifyWebhookSecret(request.headers.get('x-telegram-bot-api-secret-token'), expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true, result: 'malformed' });
  }

  try {
    const result = await handleTelegramUpdate(createAdminClient(), update as never, createTelegramAdapter());
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error('[Telegram Webhook] processing error:', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ ok: true, result: 'error' });
  }
}
