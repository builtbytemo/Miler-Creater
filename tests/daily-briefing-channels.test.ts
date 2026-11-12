/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTelegramAdapter } from '../src/lib/briefing/channels/telegram';
import { createEmailAdapter } from '../src/lib/briefing/channels/email';

const msg = { channel: 'telegram' as const, text: 'hello' };
const resp = (status: number, body: any = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const env = { ...process.env };

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'SECRET_TOKEN_VALUE';
  process.env.RESEND_API_KEY = 're_secret';
  process.env.EMAIL_FROM = 'Miler <m@example.com>';
});
afterEach(() => { process.env = { ...env }; });

describe('Telegram adapter', () => {
  const send = (r: Response | Error) => createTelegramAdapter(vi.fn(async () => { if (r instanceof Error) throw r; return r; }) as any).send({ chatId: 1 }, msg);

  it('succeeds', async () => expect(await send(resp(200, { ok: true, result: { message_id: 9 } }))).toEqual({ ok: true, providerMessageId: '9' }));
  it('maps 429 to rate_limited with retry_after', async () =>
    expect(await send(resp(429, { parameters: { retry_after: 12 } }))).toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 12 }));
  it('maps 403 to blocked', async () => expect(await send(resp(403))).toMatchObject({ kind: 'blocked', code: 'telegram_bot_blocked' }));
  it('maps chat not found to blocked', async () =>
    expect(await send(resp(400, { description: 'Bad Request: chat not found' }))).toMatchObject({ code: 'telegram_invalid_chat' }));
  it('maps 5xx to transient', async () => expect(await send(resp(502))).toMatchObject({ kind: 'transient' }));
  it('maps timeouts to ambiguous', async () => expect(await send(new Error('timeout'))).toMatchObject({ kind: 'ambiguous' }));
  it('reports not_configured without a token and never calls the network', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const f = vi.fn();
    expect(await createTelegramAdapter(f as any).send({ chatId: 1 }, msg)).toMatchObject({ kind: 'not_configured' });
    expect(f).not.toHaveBeenCalled();
  });
  it('never leaks the bot token in results', async () => {
    expect(JSON.stringify(await send(resp(500)))).not.toContain('SECRET_TOKEN_VALUE');
  });
});

describe('Email adapter', () => {
  const send = (r: Response | Error) => createEmailAdapter(vi.fn(async () => { if (r instanceof Error) throw r; return r; }) as any).send({ to: 'a@b.c' }, msg, { idempotencyKey: 'k' });

  it('succeeds', async () => expect(await send(resp(200, { id: 'e1' }))).toEqual({ ok: true, providerMessageId: 'e1' }));
  it('retries on 5xx and network errors', async () => {
    expect(await send(resp(503))).toMatchObject({ kind: 'transient' });
    expect(await send(new Error('net'))).toMatchObject({ kind: 'transient' });
  });
  it('rate limited honors retry-after', async () =>
    expect(await send(resp(429, {}, { 'retry-after': '90' }))).toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 90 }));
  it('permanent on 422, not_configured on 401', async () => {
    expect(await send(resp(422))).toMatchObject({ kind: 'permanent' });
    expect(await send(resp(401))).toMatchObject({ kind: 'not_configured' });
  });
  it('missing credentials never calls the network', async () => {
    delete process.env.RESEND_API_KEY;
    const f = vi.fn();
    expect(await createEmailAdapter(f as any).send({ to: 'a@b.c' }, msg)).toMatchObject({ kind: 'not_configured' });
    expect(f).not.toHaveBeenCalled();
  });
});
