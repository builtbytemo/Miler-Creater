/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { enqueueDueBriefings } from '../src/lib/briefing/scheduler';
import { createFakeAdmin } from './helpers-briefing-fake-db';

const prefs = (over: Record<string, any> = {}) => ({
  user_id: 'u1', enabled: true, email_enabled: true, telegram_enabled: true,
  timezone: 'Africa/Cairo', delivery_local_time: '00:00:00', ...over,
});
const NOW = new Date('2026-01-14T22:05:00Z'); // 00:05 Cairo on 2026-01-15

describe('Daily Briefing scheduler', () => {
  it('enqueues one row per enabled channel at local midnight', async () => {
    const db: any = { tables: { daily_briefing_preferences: [prefs()] }, rpcs: {} };
    const s = await enqueueDueBriefings(createFakeAdmin(db), NOW);
    expect(s.enqueued).toBe(2);
    expect(db.tables.briefing_deliveries.map((r: any) => r.local_date)).toEqual(['2026-01-15', '2026-01-15']);
  });

  it('is idempotent and safe under concurrent invocations', async () => {
    const db: any = { tables: { daily_briefing_preferences: [prefs()] }, rpcs: {} };
    await Promise.all([1, 2, 3].map(() => enqueueDueBriefings(createFakeAdmin(db), NOW)));
    await enqueueDueBriefings(createFakeAdmin(db), new Date(NOW.getTime() + 3600_000));
    expect(db.tables.briefing_deliveries).toHaveLength(2);
  });

  it('skips disabled channels', async () => {
    const db: any = { tables: { daily_briefing_preferences: [prefs({ email_enabled: false })] }, rpcs: {} };
    await enqueueDueBriefings(createFakeAdmin(db), NOW);
    expect(db.tables.briefing_deliveries.map((r: any) => r.channel)).toEqual(['telegram']);
  });

  it('does nothing when no preference exists or master switch is off (disabled by default)', async () => {
    const db: any = { tables: { daily_briefing_preferences: [prefs({ enabled: false })] }, rpcs: {} };
    const s = await enqueueDueBriefings(createFakeAdmin(db), NOW);
    expect(s.enqueued).toBe(0);
    expect(db.tables.briefing_deliveries ?? []).toHaveLength(0);
  });

  it('does not enqueue before the user-local time', async () => {
    const db: any = { tables: { daily_briefing_preferences: [prefs({ delivery_local_time: '08:00:00' })] }, rpcs: {} };
    const s = await enqueueDueBriefings(createFakeAdmin(db), NOW);
    expect(s.notDue).toBe(1);
    expect(db.tables.briefing_deliveries ?? []).toHaveLength(0);
  });

  it('isolates users: each gets only their own rows', async () => {
    const db: any = { tables: { daily_briefing_preferences: [prefs(), prefs({ user_id: 'u2', telegram_enabled: false })] }, rpcs: {} };
    await enqueueDueBriefings(createFakeAdmin(db), NOW);
    const by = (u: string) => db.tables.briefing_deliveries.filter((r: any) => r.user_id === u).length;
    expect([by('u1'), by('u2')]).toEqual([2, 1]);
  });
});
