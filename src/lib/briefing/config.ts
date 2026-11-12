import { isBriefingContentConfigured } from './content';

/** Booleans only; never returns secret values. */
export interface DeliveryServiceStatus {
  schedulerEnabled: boolean;
  telegramConfigured: boolean;
  emailConfigured: boolean;
  contentConfigured: boolean;
}

export function getTelegramBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

export function getTelegramBotUsername(): string | null {
  const u = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '');
  return u && /^[A-Za-z0-9_]{3,64}$/.test(u) ? u : null;
}

export function getDeliveryServiceStatus(): DeliveryServiceStatus {
  return {
    schedulerEnabled: process.env.DAILY_BRIEFING_DELIVERY_ENABLED === 'true',
    telegramConfigured: Boolean(
      getTelegramBotToken() && getTelegramBotUsername() && process.env.TELEGRAM_WEBHOOK_SECRET
    ),
    emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    contentConfigured: isBriefingContentConfigured(),
  };
}
