import type { BriefingMessage, ChannelAdapter, DeliveryResult } from '../types';
import { getTelegramBotToken } from '../config';

type FetchLike = typeof fetch;

export interface TelegramDestination {
  chatId: number | string;
}

const TIMEOUT_MS = 10_000;


async function sendOne(
  fetchImpl: FetchLike,
  token: string,
  chatId: number | string,
  text: string,
  parseMode?: 'HTML'
): Promise<DeliveryResult> {
  let res: Response;
  try {
    res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Request may have reached Telegram: outcome unknown. Never auto-retry (no idempotency key).
    return { ok: false, kind: 'ambiguous', code: 'telegram_timeout_or_network' };
  }

  let body: { ok?: boolean; result?: { message_id?: number }; description?: string; parameters?: { retry_after?: number } } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }

  if (res.ok && body.ok) {
    return { ok: true, providerMessageId: body.result?.message_id?.toString() };
  }
  if (res.status === 429) {
    return { ok: false, kind: 'rate_limited', code: 'telegram_rate_limited', retryAfterSeconds: body.parameters?.retry_after ?? 30 };
  }
  if (res.status === 403) {
    return { ok: false, kind: 'blocked', code: 'telegram_bot_blocked' };
  }
  if (res.status === 400 && /chat not found|PEER_ID_INVALID|chat_id is empty/i.test(body.description ?? '')) {
    return { ok: false, kind: 'blocked', code: 'telegram_invalid_chat' };
  }
  if (res.status === 401 || res.status === 404) {
    return { ok: false, kind: 'not_configured', code: 'telegram_bad_credentials' };
  }
  if (res.status >= 500) {
    return { ok: false, kind: 'transient', code: `telegram_http_${res.status}` };
  }
  return { ok: false, kind: 'permanent', code: `telegram_http_${res.status}` };
}

/**
 * Telegram Bot API sendMessage adapter. The bot token is read server-side only and is never
 * included in errors or logs. Single messages are sent as plain text; multi-part HTML briefings use parse_mode=HTML.
 */
export function createTelegramAdapter(fetchImpl: FetchLike = fetch): ChannelAdapter<TelegramDestination> {
  return {
    async send(destination, message: BriefingMessage): Promise<DeliveryResult> {
      const token = getTelegramBotToken();
      if (!token) return { ok: false, kind: 'not_configured', code: 'telegram_not_configured' };

      const parts = message.parts && message.parts.length > 0 ? message.parts : null;
      const texts = parts ?? [message.text.slice(0, 4096)];
      let lastId: string | undefined;

      for (let i = 0; i < texts.length; i++) {
        const outcome = await sendOne(fetchImpl, token, destination.chatId, texts[i], parts ? message.parseMode : undefined);
        if (!outcome.ok) {
          // Some parts already delivered: a retry would duplicate them, so never auto-retry.
          if (i > 0) return { ok: false, kind: 'ambiguous', code: 'telegram_partial_delivery' };
          return outcome;
        }
        lastId = outcome.providerMessageId;
      }
      return { ok: true, providerMessageId: lastId };
    },
  };
}
