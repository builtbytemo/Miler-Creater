import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelAdapter } from './types';
import type { TelegramDestination } from './channels/telegram';

export const LINK_TOKEN_TTL_SECONDS = 600;

/** 32 random bytes -> 43 url-safe chars (fits Telegram's 64-char start payload limit). */
export function generateLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isWellFormedLinkToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function buildDeepLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${token}`;
}

/** Constant-time webhook secret verification. Fails closed if no secret is configured. */
export function verifyWebhookSecret(provided: string | null, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

interface TelegramUpdate {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number; type?: string };
    from?: { username?: string };
  };
  my_chat_member?: { chat?: { id?: number }; new_chat_member?: { status?: string } };
}

export type WebhookOutcome = 'duplicate' | 'linked' | 'invalid_token' | 'chat_in_use' | 'ignored' | 'bot_blocked' | 'malformed';

const REPLIES: Record<string, string> = {
  linked: 'Zahi is now connected to this chat. You can manage delivery in Zahi settings.',
  invalid_token: 'This connection link is invalid, expired or already used. Please generate a new one in Zahi settings.',
  chat_in_use: 'This Telegram chat is already connected to another Zahi account.',
  help: 'To connect Zahi, open Zahi settings and choose "Connect Telegram".',
};

/**
 * Processes one Telegram update. Replay-safe: update_id is recorded first, duplicates are no-ops.
 * Only private chats can be linked, and only via a valid, unexpired, unconsumed token.
 */
export async function handleTelegramUpdate(
  admin: SupabaseClient,
  update: TelegramUpdate,
  telegram: ChannelAdapter<TelegramDestination>
): Promise<WebhookOutcome> {
  if (typeof update?.update_id !== 'number') return 'malformed';

  const { error: dupErr } = await admin.from('telegram_webhook_updates').insert({ update_id: update.update_id });
  if (dupErr) return dupErr.code === '23505' ? 'duplicate' : 'malformed';

  // Bot blocked/stopped by user: mark connection so no further sends are attempted.
  const mcm = update.my_chat_member;
  if (mcm?.chat?.id && (mcm.new_chat_member?.status === 'kicked' || mcm.new_chat_member?.status === 'left')) {
    await admin
      .from('telegram_connections')
      .update({ status: 'blocked', status_changed_at: new Date().toISOString() })
      .eq('chat_id', mcm.chat.id);
    return 'bot_blocked';
  }

  const msg = update.message;
  const chatId = msg?.chat?.id;
  const text = msg?.text?.trim();
  if (!msg || typeof chatId !== 'number' || !text || msg.chat?.type !== 'private') return 'ignored';

  const match = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text);
  if (!match) return 'ignored';
  const token = match[1];
  const reply = (key: string) => telegram.send({ chatId }, { channel: 'telegram', text: REPLIES[key] }).catch(() => undefined);

  if (!token || !isWellFormedLinkToken(token)) {
    await reply(token ? 'invalid_token' : 'help');
    return token ? 'invalid_token' : 'ignored';
  }

  const { data, error } = await admin.rpc('consume_telegram_link_token', {
    p_token_hash: hashLinkToken(token),
    p_chat_id: chatId,
    p_username: msg.from?.username ?? null,
  });
  const result = error ? 'invalid' : (data as string);
  if (result === 'linked') {
    await reply('linked');
    return 'linked';
  }
  if (result === 'chat_in_use') {
    await reply('chat_in_use');
    return 'chat_in_use';
  }
  await reply('invalid_token');
  return 'invalid_token';
}
