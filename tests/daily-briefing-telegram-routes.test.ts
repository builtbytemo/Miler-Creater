/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeAdmin } from './helpers-briefing-fake-db';
import { generateLinkToken, hashLinkToken, handleTelegramUpdate, verifyWebhookSecret, buildDeepLink } from '../src/lib/briefing/telegram-linking';

const fake: { db: any } = { db: null };
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => createFakeAdmin(fake.db) }));
vi.mock('@/lib/briefing/channels/telegram', () => ({ createTelegramAdapter: () => ({ send: vi.fn(async () => ({ ok: true })) }) }));
import { POST as webhook } from '../src/app/api/telegram/webhook/route';
import { GET as cron } from '../src/app/api/cron/daily-briefing/route';

const env = { ...process.env };
const req = (secret: string | null, body: any) =>
  new NextRequest('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {},
    body: JSON.stringify(body),
  });

/** Models consume_telegram_link_token semantics. */
function linkDb() {
  const tokens = new Map<string, { user: string; used: boolean; expired: boolean }>();
  const db: any = {
    tables: {},
    rpcs: {
      consume_telegram_link_token: ({ p_token_hash, p_chat_id }: any) => {
        const t = tokens.get(p_token_hash);
        if (!t || t.used || t.expired) return 'invalid';
        t.used = true;
        db.linked = { user: t.user, chat: p_chat_id };
        return 'linked';
      },
    },
  };
  return { db, tokens };
}

beforeEach(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = 'whsec';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://prmgrrzqtnygmitplkhn.supabase.co';
  process.env.VERCEL_ENV = 'preview';
});
afterEach(() => { process.env = { ...env }; });

describe('Telegram webhook security', () => {
  it('rejects requests without or with a wrong secret', async () => {
    fake.db = linkDb().db;
    expect((await webhook(req(null, { update_id: 1 }))).status).toBe(401);
    expect((await webhook(req('wrong', { update_id: 1 }))).status).toBe(401);
  });
  it('fails closed when the secret is not configured', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect((await webhook(req('anything', { update_id: 1 }))).status).toBe(503);
  });
  it('constant-time compare helper rejects empty values', () => {
    expect(verifyWebhookSecret('', 'x')).toBe(false);
    expect(verifyWebhookSecret('x', undefined)).toBe(false);
    expect(verifyWebhookSecret('x', 'x')).toBe(true);
  });
});

describe('Telegram account linking', () => {
  const start = (id: number, token: string, chatId = 500, type = 'private') => ({
    update_id: id, message: { text: `/start ${token}`, chat: { id: chatId, type }, from: { username: 'bob' } },
  });
  const tg: any = { send: async () => ({ ok: true }) };

  it('links with a valid token, and replay of the token fails', async () => {
    const { db, tokens } = linkDb();
    const token = generateLinkToken();
    tokens.set(hashLinkToken(token), { user: 'u1', used: false, expired: false });
    const admin = createFakeAdmin(db);
    expect(await handleTelegramUpdate(admin, start(1, token), tg)).toBe('linked');
    expect(db.linked).toEqual({ user: 'u1', chat: 500 });
    expect(await handleTelegramUpdate(admin, start(2, token, 999), tg)).toBe('invalid_token');
    expect(db.linked.chat).toBe(500);
  });

  it('duplicate webhook updates are no-ops', async () => {
    const { db, tokens } = linkDb();
    const token = generateLinkToken();
    tokens.set(hashLinkToken(token), { user: 'u1', used: false, expired: false });
    const admin = createFakeAdmin(db);
    expect(await handleTelegramUpdate(admin, start(7, token), tg)).toBe('linked');
    expect(await handleTelegramUpdate(admin, start(7, token), tg)).toBe('duplicate');
  });

  it('rejects expired, malformed and group-chat tokens', async () => {
    const { db, tokens } = linkDb();
    const token = generateLinkToken();
    tokens.set(hashLinkToken(token), { user: 'u1', used: false, expired: true });
    const admin = createFakeAdmin(db);
    expect(await handleTelegramUpdate(admin, start(1, token), tg)).toBe('invalid_token');
    expect(await handleTelegramUpdate(admin, start(2, 'short'), tg)).toBe('invalid_token');
    const fresh = generateLinkToken();
    tokens.set(hashLinkToken(fresh), { user: 'u1', used: false, expired: false });
    expect(await handleTelegramUpdate(admin, start(3, fresh, 1, 'group'), tg)).toBe('ignored');
    expect(db.linked).toBeUndefined();
  });

  it('tokens are url-safe, 43 chars, unique, and only the hash is stored form', () => {
    const a = generateLinkToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(generateLinkToken());
    expect(hashLinkToken(a)).not.toContain(a);
    expect(buildDeepLink('MilerBot', a)).toBe(`https://t.me/MilerBot?start=${a}`);
  });
});

describe('Daily Briefing cron endpoint', () => {
  const c = (h?: string) => new NextRequest('http://localhost/api/cron/daily-briefing', { headers: h ? { authorization: h } : {} });
  it('requires the bearer secret', async () => {
    process.env.CRON_SECRET = 's3';
    expect((await cron(c())).status).toBe(401);
    expect((await cron(c('Bearer nope'))).status).toBe(401);
  });
  it('fails closed without CRON_SECRET', async () => {
    delete process.env.CRON_SECRET;
    expect((await cron(c('Bearer x'))).status).toBe(500);
  });
  it('is a no-op while the kill switch is off', async () => {
    process.env.CRON_SECRET = 's3';
    delete process.env.DAILY_BRIEFING_DELIVERY_ENABLED;
    const res = await cron(c('Bearer s3'));
    expect(await res.json()).toMatchObject({ enabled: false });
  });
});
