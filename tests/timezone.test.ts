import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TIMEZONE,
  APPROVED_REQUIREMENT_ALIAS,
  normalizeTimeZone,
  isValidTimeZone,
  formatInTimeZone,
  getTimeZoneOffsetMinutes,
} from '../src/lib/temporal/timezone';

describe('Timezone & Temporal Scheduling Verification', () => {
  it('reconciles approved Asia/Cairo requirement with canonical Africa/Cairo', () => {
    expect(APPROVED_REQUIREMENT_ALIAS).toBe('Asia/Cairo');
    expect(DEFAULT_TIMEZONE).toBe('Africa/Cairo');
    expect(normalizeTimeZone('Asia/Cairo')).toBe('Africa/Cairo');
    expect(isValidTimeZone('Asia/Cairo')).toBe(true);
    expect(isValidTimeZone('Africa/Cairo')).toBe(true);
  });

  it('validates standard IANA timezones', () => {
    expect(isValidTimeZone('Africa/Cairo')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('Invalid/Timezone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('formats UTC ISO timestamp into Cairo wall-clock representation correctly', () => {
    // 2026-01-15T12:00:00Z (Winter Standard Time in Cairo is UTC+2)
    const winterUtc = '2026-01-15T12:00:00Z';
    // Format using both canonical and requirement alias
    const winterFormatted1 = formatInTimeZone(winterUtc, 'Africa/Cairo');
    const winterFormatted2 = formatInTimeZone(winterUtc, 'Asia/Cairo');

    // 12:00 UTC should be 02:00 PM Cairo time
    expect(winterFormatted1).toContain('02:00 PM');
    expect(winterFormatted1).toContain('Jan 15, 2026');
    expect(winterFormatted2).toBe(winterFormatted1);
  });

  it('handles Egypt Daylight Saving Time (DST) offset transitions', () => {
    // In Egypt, Winter Standard Time is UTC+2 (+120 min)
    // Summer Daylight Saving Time (May-September) is UTC+3 (+180 min)
    const winterDate = new Date('2026-01-15T12:00:00Z');
    const summerDate = new Date('2026-07-15T12:00:00Z');

    const winterOffset = getTimeZoneOffsetMinutes(winterDate, 'Asia/Cairo');
    const summerOffset = getTimeZoneOffsetMinutes(summerDate, 'Asia/Cairo');

    expect(winterOffset).toBe(120); // UTC+2
    expect(summerOffset).toBe(180); // UTC+3

    // 12:00 UTC in summer should display as 03:00 PM in Cairo
    const summerFormatted = formatInTimeZone(summerDate, 'Asia/Cairo');
    expect(summerFormatted).toContain('03:00 PM');
  });

  it('rejects invalid date inputs gracefully', () => {
    expect(() => formatInTimeZone('invalid-date')).toThrow(/Invalid date/);
  });
});
