export type BriefingChannel = 'email' | 'telegram';

/** Typed message payload produced by a content generator and consumed by channel adapters. */
export interface BriefingMessage {
  channel: BriefingChannel;
  subject?: string;
  text: string;
  html?: string;
  /**
   * Telegram only: ordered messages (each within Telegram's limit) sent in sequence with
   * `parseMode`. When absent the single `text` is sent as plain text.
   */
  parts?: string[];
  parseMode?: 'HTML';
}

export interface BriefingContentRequest {
  userId: string;
  /** User-local briefing date, YYYY-MM-DD. */
  localDate: string;
  channel: BriefingChannel;
}

export type BriefingContentResult =
  | { status: 'ready'; message: BriefingMessage }
  | { status: 'not_configured'; reason: string };

/** Content-generation contract (implemented separately in a later phase). */
export interface BriefingContentGenerator {
  generate(request: BriefingContentRequest): Promise<BriefingContentResult>;
}

export type DeliveryFailureKind =
  | 'transient' // safe to retry
  | 'rate_limited' // retry after delay
  | 'permanent' // never retry
  | 'blocked' // recipient blocked bot / chat unreachable
  | 'ambiguous' // provider may have delivered; do not auto-retry
  | 'not_configured';

export type DeliveryResult =
  | { ok: true; providerMessageId?: string }
  | { ok: false; kind: DeliveryFailureKind; code: string; retryAfterSeconds?: number };

export interface ChannelAdapter<Destination> {
  send(destination: Destination, message: BriefingMessage, opts?: { idempotencyKey?: string }): Promise<DeliveryResult>;
}
