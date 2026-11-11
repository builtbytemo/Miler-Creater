import { describe, it, expect } from 'vitest';
import { evaluateDue, getLocalDate, isValidTimeZone, localDateTimeToInstant } from '../src/lib/briefing/timezone';

const CAIRO = 'Africa/Cairo';

describe('Daily Briefing timezone handling (Africa/Cairo)', () => {
  it('validates IANA zones', () => {
    expect(isValidTimeZone(CAIRO)).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('winter midnight is 22:00Z the previous day (UTC+2)', () => {
    expect(localDateTimeToInstant('2026-01-15', '00:00', CAIRO).toISOString()).toBe('2026-01-14T22:00:00.000Z');
  });

  it('summer midnight is 21:00Z the previous day (UTC+3), not a fixed offset', () => {
    expect(localDateTimeToInstant('2026-07-15', '00:00', CAIRO).toISOString()).toBe('2026-07-14T21:00:00.000Z');
  });

  it('handles the spring-forward day where local midnight does not exist (2026-04-24)', () => {
    const at = localDateTimeToInstant('2026-04-24', '00:00', CAIRO);
    expect(getLocalDate(at, CAIRO)).toBe('2026-04-24');
    expect(at.toISOString()).toBe('2026-04-23T22:00:00.000Z');
  });

  it('handles the fall-back transition (2026-10-29/30) with one local date per day', () => {
    const d30 = localDateTimeToInstant('2026-10-30', '00:00', CAIRO);
    expect(d30.toISOString()).toBe('2026-10-29T22:00:00.000Z');
    expect(getLocalDate(new Date('2026-10-30T21:59:00Z'), CAIRO)).toBe('2026-10-30');
  });

  it('is not due before local midnight and due right after', () => {
    expect(evaluateDue(new Date('2026-01-14T21:59:00Z'), CAIRO, '00:00')).toMatchObject({ due: true, localDate: '2026-01-14' });
    const after = evaluateDue(new Date('2026-01-14T22:00:00Z'), CAIRO, '00:00');
    expect(after).toMatchObject({ due: true, localDate: '2026-01-15' });
  });

  it('late runs resolve to the current local date (catch-up, no back-fill)', () => {
    const late = evaluateDue(new Date('2026-01-15T09:30:00Z'), CAIRO, '00:00');
    expect(late.due).toBe(true);
    expect(late.localDate).toBe('2026-01-15');
  });

  it('later configured time is not due early', () => {
    expect(evaluateDue(new Date('2026-01-15T05:00:00Z'), CAIRO, '08:00').due).toBe(false);
    expect(evaluateDue(new Date('2026-01-15T06:00:00Z'), CAIRO, '08:00').due).toBe(true);
  });

  it('supports other zones per user', () => {
    expect(localDateTimeToInstant('2026-01-15', '00:00', 'America/New_York').toISOString()).toBe('2026-01-15T05:00:00.000Z');
  });
});
