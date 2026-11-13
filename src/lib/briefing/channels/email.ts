import { authorizeEmailDestination, getResendCredentials } from '../config';
import type { BriefingMessage, ChannelAdapter, DeliveryResult } from '../types';

type FetchLike = typeof fetch;

export interface EmailDestination {
  /** Must be an address verified by Supabase Auth (email_confirmed_at). */
  to: string;
}

const TIMEOUT_MS = 10_000;

/**
 * Transactional email via the Resend HTTP API (no SDK dependency). No email provider existed
 * in the repository. The Idempotency-Key header lets timed-out sends be retried safely.
 */
export function createEmailAdapter(fetchImpl: FetchLike = fetch): ChannelAdapter<EmailDestination> {
  return {
    async send(destination, message: BriefingMessage, opts): Promise<DeliveryResult> {
      const creds = getResendCredentials();
      if (!creds) return { ok: false, kind: 'not_configured', code: 'email_not_configured' };

      const destAuth = authorizeEmailDestination(destination.to);
      if (!destAuth.allowed) {
        return { ok: false, kind: destAuth.kind, code: destAuth.code };
      }

      let res: Response;
      try {
        res = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${creds.apiKey}`,
            'content-type': 'application/json',
            ...(opts?.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
          },
          body: JSON.stringify({
            from: creds.from,
            to: [destAuth.normalizedTo],
            subject: message.subject ?? 'Zahi',
            text: message.text,
            ...(message.html ? { html: message.html } : {}),
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        return { ok: false, kind: 'transient', code: 'email_timeout_or_network' };
      }

      let body: { id?: string } = {};
      try {
        body = await res.json();
      } catch {
        /* ignore */
      }

      if (res.ok) return { ok: true, providerMessageId: body.id };
      if (res.status === 429) {
        const retry = Number(res.headers.get('retry-after'));
        return { ok: false, kind: 'rate_limited', code: 'email_rate_limited', retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : 60 };
      }
      if (res.status === 401 || res.status === 403) return { ok: false, kind: 'not_configured', code: 'email_bad_credentials' };
      if (res.status === 408 || res.status >= 500) return { ok: false, kind: 'transient', code: `email_http_${res.status}` };
      return { ok: false, kind: 'permanent', code: `email_http_${res.status}` };
    },
  };
}
